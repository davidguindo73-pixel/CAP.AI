(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const form = $("campaignForm");
  const output = $("campaignOutput");
  const list = $("campaignList");
  const tokenInput = $("adsToken");
  const baseInput = $("apiBase");
  const submitButton = $("generateCampaign");
  const statusLine = $("formStatus");
  const clientKey = "capAiClientIdV1";
  const baseKey = "capAiAdsBaseV1";
  let token = "";
  let campaigns = [];

  let clientId = localStorage.getItem(clientKey);
  if (!clientId) {
    clientId = crypto.randomUUID
      ? crypto.randomUUID()
      : "cap_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    localStorage.setItem(clientKey, clientId);
  }

  baseInput.value = localStorage.getItem(baseKey) || "https://cap-ai-generation-api.onrender.com";

  function apiBase() {
    return baseInput.value.trim().replace(/\/+$/, "");
  }

  function authHeaders() {
    const headers = {
      "Content-Type": "application/json",
      "X-CAP-Client-ID": clientId,
      "X-CAP-Ads-Token": token
    };
    const customerToken = sessionStorage.getItem("capAiAccessTokenV1");
    if (customerToken) headers.Authorization = "Bearer " + customerToken;
    return headers;
  }

  function hasAdsAccess() {
    return Boolean(token || sessionStorage.getItem("capAiAccessTokenV1"));
  }

  function setStatus(message) {
    statusLine.textContent = message;
  }

  function setBadge(id, label, type) {
    const el = $(id);
    el.textContent = label;
    el.className = "ads-status" + (type ? " " + type : "");
  }

  async function request(path, options = {}, authenticated = true) {
    const headers = {
      ...(options.headers || {}),
      ...(authenticated ? authHeaders() : {})
    };
    const response = await fetch(apiBase() + path, {
      ...options,
      headers,
      signal: AbortSignal.timeout(70_000)
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error("CAP.AI returned an unreadable response. Check the API address and service logs."); }
    if (!response.ok) throw new Error(data.error || "The request failed (" + response.status + ").");
    return data;
  }

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function addCard(title, content, parent = output) {
    const card = node("section", "ads-result-card");
    card.append(node("h3", "", title));
    if (typeof content === "string") {
      card.append(node("p", "", content));
    } else if (content instanceof Node) {
      card.append(content);
    }
    parent.append(card);
    return card;
  }

  function makeChips(values) {
    const wrap = node("div", "ads-chips");
    (values || []).forEach((value) => wrap.append(node("span", "ads-chip", value)));
    return wrap;
  }

  function makeCopyCard(label, fields) {
    const card = node("section", "ads-result-card");
    card.append(node("h3", "", label));
    fields.forEach(([heading, value]) => {
      if (!value) return;
      const p = node("p");
      const strong = node("strong", "", heading + ": ");
      p.append(strong, document.createTextNode(Array.isArray(value) ? value.join("\n") : String(value)));
      card.append(p);
    });
    return card;
  }

  function creativeLink(concept, mode, campaign) {
    const params = new URLSearchParams({
      mode,
      idea: mode === "ad-image" ? concept.imagePrompt : concept.videoPrompt,
      productName: campaign?.brief?.productOrService || "",
      targetAudience: campaign?.brief?.targetAudience || "",
      callToAction: campaign?.brief?.callToAction || "Learn more",
      adPlatform: campaign?.brief?.platforms?.[0] || "Instagram",
      brandTone: campaign?.brief?.tone || "Modern and approachable"
    });
    return "create.html?" + params.toString();
  }

  function renderCampaign(campaign) {
    output.replaceChildren();
    const deliverables = campaign?.deliverables || {};
    const strategy = deliverables.strategy || {};

    const overview = node("section", "ads-result-card");
    overview.append(node("h3", "", deliverables.campaignName || campaign.title || "Campaign strategy"));
    overview.append(node("p", "", strategy.summary || "No strategy summary supplied."));
    overview.append(makeChips([
      campaign.status || "draft",
      ...(campaign.brief?.platforms || [])
    ]));
    const brief = node("div", "ads-brief-grid");
    [
      ["Goal", campaign.brief?.campaignGoal],
      ["Audience", strategy.audience || campaign.brief?.targetAudience],
      ["Positioning", strategy.positioning],
      ["Key message", strategy.keyMessage],
      ["Offer framing", strategy.offerFraming]
    ].forEach(([heading, value]) => {
      const item = node("div");
      item.append(node("strong", "", heading), document.createTextNode(value || "Not specified"));
      brief.append(item);
    });
    overview.append(node("div", "ads-divider"), brief);
    output.append(overview);

    (deliverables.creativeConcepts || []).forEach((concept, index) => {
      const card = node("section", "ads-result-card");
      card.append(node("h3", "", "Creative " + (index + 1) + " · " + (concept.name || "Concept")));
      card.append(node("p", "", (concept.angle || "") + (concept.hook ? "\nHook: " + concept.hook : "") + (concept.visualDirection ? "\nVisual direction: " + concept.visualDirection : "")));
      const actions = node("div", "ads-inline");
      [["Generate image", "ad-image"], ["Generate video", "ad-video"]].forEach(([label, mode]) => {
        const link = node("a", "button secondary small", label);
        link.href = creativeLink(concept, mode, campaign);
        actions.append(link);
      });
      const copy = node("button", "button secondary small", "Copy image prompt");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(concept.imagePrompt || "");
          setStatus("Image prompt copied.");
        } catch {
          setStatus("Clipboard unavailable. Open the Create AI page to use the prompt.");
        }
      });
      actions.append(copy);
      card.append(actions);
      output.append(card);
    });

    const copy = deliverables.adCopies || {};
    output.append(makeCopyCard("Meta · Instagram / Facebook", [
      ["Primary text", copy.meta?.primaryText],
      ["Headline", copy.meta?.headline],
      ["Description", copy.meta?.description],
      ["Call to action", copy.meta?.callToAction]
    ]));
    output.append(makeCopyCard("TikTok", [
      ["Video script", copy.tiktok?.script],
      ["Caption", copy.tiktok?.caption],
      ["Call to action", copy.tiktok?.callToAction]
    ]));
    output.append(makeCopyCard("Google Search", [
      ["Headlines", copy.googleSearch?.headlines],
      ["Descriptions", copy.googleSearch?.descriptions],
      ["Keyword ideas", copy.googleSearch?.keywordIdeas]
    ]));
    output.append(makeCopyCard("LinkedIn", [
      ["Intro text", copy.linkedin?.introText],
      ["Headline", copy.linkedin?.headline],
      ["Call to action", copy.linkedin?.callToAction]
    ]));

    const measurement = deliverables.measurement || {};
    const measurementNode = node("div");
    measurementNode.append(node("p", "", "Primary KPI: " + (measurement.primaryKpi || "Not specified")));
    measurementNode.append(makeChips(measurement.secondaryKpis || []));
    (measurement.testPlan || []).forEach((step, i) => {
      measurementNode.append(node("p", "", (i + 1) + ". " + step));
    });
    addCard("Measurement & testing", measurementNode);

    const risks = deliverables.riskChecks || {};
    const riskNode = node("div");
    riskNode.append(node("p", "", "Claims to verify"));
    const claims = risks.claimsToVerify || [];
    if (claims.length) claims.forEach((claim) => riskNode.append(node("p", "", "• " + claim)));
    else riskNode.append(node("p", "muted", "No additional claims flagged."));
    riskNode.append(node("p", "", "Review notes"));
    (risks.reviewNotes || []).forEach((note) => riskNode.append(node("p", "", "• " + note)));
    addCard("Accuracy & review checklist", riskNode);

    const campaignActions = node("div", "ads-inline");
    const statusSelect = node("select");
    statusSelect.setAttribute("aria-label", "Campaign status");
    ["draft", "approved", "archived"].forEach((value) => {
      const option = node("option", "", value);
      option.value = value;
      statusSelect.append(option);
    });
    statusSelect.value = campaign.status || "draft";
    const saveStatus = node("button", "button secondary small", "Save status");
    saveStatus.type = "button";
    saveStatus.addEventListener("click", async () => {
      try {
        await request("/api/ads/campaigns/" + encodeURIComponent(campaign.id), {
          method: "PATCH",
          body: JSON.stringify({ status: statusSelect.value })
        });
        setStatus("Campaign status saved.");
        await loadCampaigns(false);
      } catch (error) { setStatus(error.message); }
    });

    function addPausedPublishControl(platform, label) {
      if (!sessionStorage.getItem("capAiAccessTokenV1")) return;
      const createButton = node("button", "button secondary small", "Create " + label + " paused");
      createButton.type = "button";
      createButton.addEventListener("click", async () => {
        if (statusSelect.value !== "approved") {
          setStatus("Set the campaign status to approved and save it before creating a platform campaign.");
          return;
        }
        const accountId = prompt(platform === "meta" ? "Meta ad account ID (digits only):" : "Google Ads customer ID (digits only):");
        if (!accountId) return;
        const destinationUrl = prompt("Public HTTPS landing page URL:", campaign.brief?.website || "");
        if (!destinationUrl) return;
        const dailyBudget = prompt("Daily budget in the ad account currency (minimum 1):", "10");
        if (!dailyBudget || !Number.isFinite(Number(dailyBudget))) return;
        const countryCode = prompt("Two-letter country code for targeting:", "US");
        if (!countryCode) return;
        const payload = { accountId, destinationUrl, dailyBudget: Number(dailyBudget), countryCode };
        if (platform === "meta") {
          payload.pageId = sessionStorage.getItem("capAiMetaPageId") || prompt("Select a Facebook Page in Workspace first, or enter its Page ID:");
          if (!payload.pageId) return;
          payload.imageUrl = prompt("Public HTTPS URL of the final ad image:");
          if (!payload.imageUrl) return;
        }
        createButton.disabled = true;
        try {
          await request("/api/ads/campaigns/" + encodeURIComponent(campaign.id), {
            method: "PATCH", body: JSON.stringify({ status: "approved" })
          });
          const data = await request("/api/publish/" + platform + "/" + encodeURIComponent(campaign.id), {
            method: "POST", body: JSON.stringify(payload)
          });
          const publication = data.publication;
          setStatus(data.message || "Platform campaign created paused.");
          const activateButton = node("button", "button small", "Activate " + label + " · starts spend");
          activateButton.type = "button";
          activateButton.addEventListener("click", async () => {
            const confirmed = confirm("This will activate the platform campaign and can spend " + publication.budget_amount + " " + publication.currency + " per day. Continue?");
            if (!confirmed) return;
            const typedBudget = prompt("To confirm, type the daily budget exactly: " + publication.budget_amount);
            if (typedBudget !== String(publication.budget_amount)) {
              setStatus("Activation cancelled because the budget confirmation did not match.");
              return;
            }
            activateButton.disabled = true;
            try {
              const activated = await request("/api/publish/" + platform + "/" + encodeURIComponent(publication.id) + "/activate", {
                method: "POST", body: JSON.stringify({ confirmSpend: true, dailyBudgetConfirmed: Number(typedBudget) })
              });
              setStatus(activated.message || "Campaign activated.");
              activateButton.textContent = "Campaign active";
            } catch (error) {
              setStatus(error.message);
              activateButton.disabled = false;
            }
          });
          campaignActions.append(activateButton);
        } catch (error) {
          setStatus(error.message);
        } finally {
          createButton.disabled = false;
        }
      });
      campaignActions.append(createButton);
    }
    addPausedPublishControl("meta", "Meta");
    addPausedPublishControl("google", "Google Search");

    campaignActions.append(statusSelect, saveStatus);
    addCard("Campaign controls · " + campaign.id, campaignActions);
  }

  function renderCampaignList() {
    list.replaceChildren();
    if (!campaigns.length) {
      list.append(node("div", "ads-empty", "No campaigns have been saved in this workspace yet."));
      return;
    }
    campaigns.forEach((campaign) => {
      const row = node("div", "ads-campaign");
      const open = node("button", "", campaign.title || "Untitled campaign");
      open.type = "button";
      open.append(node("small", "", (campaign.status || "draft") + " · " + new Date(campaign.createdAt).toLocaleDateString()));
      open.addEventListener("click", () => renderCampaign(campaign));
      const actions = node("div", "ads-inline");
      const del = node("button", "button secondary small", "Delete");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm("Delete this saved campaign?")) return;
        try {
          await request("/api/ads/campaigns/" + encodeURIComponent(campaign.id), { method: "DELETE" });
          setStatus("Campaign deleted.");
          await loadCampaigns(false);
          if (campaigns.length) renderCampaign(campaigns[0]);
          else output.replaceChildren(node("div", "ads-empty", "Your campaign output will appear here."));
        } catch (error) { setStatus(error.message); }
      });
      actions.append(del);
      row.append(open, actions);
      list.append(row);
    });
  }

  async function loadCampaigns(updateStatus = true) {
    if (!token) {
      if (updateStatus) setStatus("Enter the private beta access token first.");
      return;
    }
    const data = await request("/api/ads/campaigns");
    campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    renderCampaignList();
    if (updateStatus) setStatus("Loaded " + campaigns.length + " saved campaign(s). Storage: " + data.storage + ".");
  }

  async function checkBackend() {
    try {
      const data = await request("/api/ads/capabilities", {}, false);
      setBadge("backendStatus", "Backend online", "ok");
      setBadge("storageStatus", data.campaignStorage === "postgres-configured" ? "PostgreSQL configured" : "Temporary campaign storage", data.campaignStorage === "postgres-configured" ? "ok" : "bad");
      if (!data.strategyReady) setStatus("Backend is online, but advertising strategy credentials are not fully configured.");
      else setStatus("Backend is online. Enter the private beta token to manage campaigns.");
    } catch (error) {
      setBadge("backendStatus", "Backend unavailable", "bad");
      setBadge("storageStatus", "Storage unverified", "bad");
      setStatus(error.message);
    }
  }

  tokenInput.addEventListener("input", () => {
    token = tokenInput.value.trim();
    if (token.length >= 20) {
      loadCampaigns().catch((error) => setStatus(error.message));
    }
  });

  baseInput.addEventListener("change", () => {
    localStorage.setItem(baseKey, apiBase());
    checkBackend();
  });

  $("loadCampaigns").addEventListener("click", () => {
    token = tokenInput.value.trim();
    loadCampaigns().catch((error) => setStatus(error.message));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    token = tokenInput.value.trim();
    if (token.length < 20) {
      setStatus("Enter the private beta access token from the Render Environment page.");
      tokenInput.focus();
      return;
    }
    if (!form.reportValidity()) return;

    const payload = Object.fromEntries(new FormData(form).entries());
    payload.platforms = [...form.querySelectorAll('input[name="platforms"]:checked')].map((el) => el.value);
    if (!payload.platforms.length) {
      setStatus("Choose at least one advertising platform.");
      return;
    }
    if (!payload.website) delete payload.website;
    if (!payload.location) delete payload.location;
    if (!payload.differentiator) delete payload.differentiator;
    if (!payload.offer) delete payload.offer;
    if (!payload.budget) delete payload.budget;

    submitButton.disabled = true;
    submitButton.textContent = "Building campaign…";
    setStatus("CAP.AI is developing the strategy and writing platform-specific ads. This can take a little time.");
    output.replaceChildren(node("div", "ads-empty", "Creating your advertising strategy…"));

    try {
      const data = await request("/api/ads/brief", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      renderCampaign(data.campaign);
      await loadCampaigns(false);
      setStatus("Campaign created and saved. Review the claims and copy before using any creative.");
    } catch (error) {
      setStatus(error.message);
      output.replaceChildren(node("div", "ads-empty", error.message));
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Build advertising campaign";
    }
  });

  async function prefillBusinessProfile() {
    if (!sessionStorage.getItem("capAiAccessTokenV1")) return;
    try {
      const data = await request("/api/business-profile");
      const profile = data.profile;
      if (!profile) return;
      const set = (id, value) => { const field = $(id); if (field && value && !field.value) field.value = value; };
      set("businessName", profile.businessName);
      set("website", profile.website);
      set("businessDescription", profile.description);
      set("location", profile.location);
      set("productOrService", (profile.products || [])[0]);
      set("tone", profile.brandVoice);
      const industry = $("businessType");
      if (industry && profile.industry && [...industry.options].some((option) => option.value === profile.industry || option.text === profile.industry)) industry.value = profile.industry;
      setStatus("Loaded your saved business profile. Adjust the brief for this campaign.");
    } catch { /* Profile prefill is optional; Ad Studio still works with a manual brief. */ }
  }

  checkBackend();
  prefillBusinessProfile();
})();
