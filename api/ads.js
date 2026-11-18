import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { ensureAdsSchema, pool } from "./db.js";
import { resolveUserFromRequest } from "./platform.js";

const router = express.Router();
const memoryCampaigns = new Map();
const SUPPORTED_PLATFORMS = new Set([
  "Instagram", "Facebook", "TikTok", "YouTube", "Google Search", "LinkedIn"
]);

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["campaignName", "strategy", "creativeConcepts", "adCopies", "measurement", "riskChecks"],
  properties: {
    campaignName: { type: "string" },
    strategy: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "positioning", "keyMessage", "audience", "offerFraming"],
      properties: {
        summary: { type: "string" },
        positioning: { type: "string" },
        keyMessage: { type: "string" },
        audience: { type: "string" },
        offerFraming: { type: "string" }
      }
    },
    creativeConcepts: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "angle", "hook", "visualDirection", "imagePrompt", "videoPrompt"],
        properties: {
          name: { type: "string" },
          angle: { type: "string" },
          hook: { type: "string" },
          visualDirection: { type: "string" },
          imagePrompt: { type: "string" },
          videoPrompt: { type: "string" }
        }
      }
    },
    adCopies: {
      type: "object",
      additionalProperties: false,
      required: ["meta", "tiktok", "googleSearch", "linkedin"],
      properties: {
        meta: {
          type: "object",
          additionalProperties: false,
          required: ["primaryText", "headline", "description", "callToAction"],
          properties: {
            primaryText: { type: "string" },
            headline: { type: "string" },
            description: { type: "string" },
            callToAction: { type: "string" }
          }
        },
        tiktok: {
          type: "object",
          additionalProperties: false,
          required: ["script", "caption", "callToAction"],
          properties: {
            script: { type: "string" },
            caption: { type: "string" },
            callToAction: { type: "string" }
          }
        },
        googleSearch: {
          type: "object",
          additionalProperties: false,
          required: ["headlines", "descriptions", "keywordIdeas"],
          properties: {
            headlines: { type: "array", items: { type: "string" } },
            descriptions: { type: "array", items: { type: "string" } },
            keywordIdeas: { type: "array", items: { type: "string" } }
          }
        },
        linkedin: {
          type: "object",
          additionalProperties: false,
          required: ["introText", "headline", "callToAction"],
          properties: {
            introText: { type: "string" },
            headline: { type: "string" },
            callToAction: { type: "string" }
          }
        }
      }
    },
    measurement: {
      type: "object",
      additionalProperties: false,
      required: ["primaryKpi", "secondaryKpis", "testPlan"],
      properties: {
        primaryKpi: { type: "string" },
        secondaryKpis: { type: "array", items: { type: "string" } },
        testPlan: { type: "array", items: { type: "string" } }
      }
    },
    riskChecks: {
      type: "object",
      additionalProperties: false,
      required: ["claimsToVerify", "reviewNotes"],
      properties: {
        claimsToVerify: { type: "array", items: { type: "string" } },
        reviewNotes: { type: "array", items: { type: "string" } }
      }
    }
  }
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""));
  const right = Buffer.from(String(rightValue || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function requireAdsAccess(req, _res, next) {
  try {
    const user = await resolveUserFromRequest(req);
    if (user) {
      req.capUser = user;
      req.capOwnerHash = crypto.createHash("sha256").update("user:" + user.id).digest("hex");
      return next();
    }

    const expectedToken = process.env.CAP_ADS_ACCESS_TOKEN;
    if (!expectedToken) {
      throw httpError(503, "Sign in to CAP.AI or configure the private beta access token.");
    }
    if (!safeEqual(req.get("X-CAP-Ads-Token"), expectedToken)) {
      throw httpError(401, "Sign in or enter a valid private beta access token.");
    }

    const clientId = String(req.get("X-CAP-Client-ID") || "");
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(clientId)) {
      throw httpError(400, "A valid CAP.AI browser session ID is required.");
    }
    req.capOwnerHash = crypto.createHash("sha256").update(clientId).digest("hex");
    next();
  } catch (error) {
    next(error);
  }
}

function textField(value, label, maxLength, required = false) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (required && !cleaned) throw httpError(400, label + " is required.");
  if (cleaned.length > maxLength) throw httpError(400, label + " must be " + maxLength + " characters or fewer.");
  return cleaned;
}

function readBrief(body = {}) {
  const allowedPlatforms = Array.isArray(body.platforms)
    ? [...new Set(body.platforms.filter((item) => SUPPORTED_PLATFORMS.has(item)))]
    : [];

  return {
    businessName: textField(body.businessName, "Business name", 120, true),
    businessType: textField(body.businessType, "Business type", 100, true),
    businessDescription: textField(body.businessDescription, "Business description", 1200),
    website: textField(body.website, "Website", 300),
    location: textField(body.location, "Location", 160),
    productOrService: textField(body.productOrService, "Product or service", 500, true),
    differentiator: textField(body.differentiator, "Business differentiator", 500),
    offer: textField(body.offer, "Offer", 400),
    campaignGoal: textField(body.campaignGoal, "Campaign goal", 120, true),
    targetAudience: textField(body.targetAudience, "Target audience", 500, true),
    budget: textField(body.budget, "Budget", 100),
    tone: textField(body.tone, "Brand tone", 100),
    callToAction: textField(body.callToAction, "Preferred call to action", 100),
    platforms: allowedPlatforms.length ? allowedPlatforms : ["Instagram", "Facebook", "TikTok"]
  };
}

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const chunks = [];
  for (const item of response.output || []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

async function generateAdStrategy(brief) {
  if (!process.env.OPENAI_API_KEY) {
    throw httpError(503, "AI advertising strategy is not configured. Add OPENAI_API_KEY to the backend environment.");
  }

  const model = process.env.OPENAI_AD_MODEL || "gpt-4.1-mini";
  const instructions = [
    "You are CAP.AI's senior advertising strategist and creative director.",
    "Create a practical, original campaign plan for a real business using only the facts supplied in the brief.",
    "Write clear, persuasive advertising copy that fits the selected platforms and the requested brand tone.",
    "Do not invent prices, discounts, product features, awards, credentials, customer reviews, statistics, guarantees, endorsements, or performance results.",
    "Do not make unsupported health, financial, legal, environmental, safety, or comparative claims.",
    "When a claim needs evidence, put it in riskChecks.claimsToVerify. Never present assumptions as facts.",
    "Make imagePrompt and videoPrompt specific enough to send to a separate media-generation model. Include subject, scene, composition, lighting, brand context, and format guidance.",
    "Avoid suggesting that CAP.AI has launched or published ads. These are draft deliverables for human review.",
    "Return only content that matches the requested JSON schema."
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 5000,
      instructions,
      input: "Build an advertising campaign from this business brief. The requested placements are " +
        brief.platforms.join(", ") + ".\n\nBUSINESS BRIEF:\n" + JSON.stringify(brief, null, 2),
      text: {
        format: {
          type: "json_schema",
          name: "cap_ad_campaign",
          strict: true,
          schema: responseSchema
        }
      }
    }),
    signal: AbortSignal.timeout(65_000)
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw httpError(502, "The AI provider returned an unreadable response.");
  }

  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message.slice(0, 350)
      : "The AI provider could not create the campaign.";
    throw httpError(response.status === 429 ? 429 : 502, message);
  }

  const outputText = extractOutputText(data);
  if (!outputText) {
    throw httpError(502, "The AI provider returned no campaign content. Please retry with a shorter brief.");
  }

  try {
    return { model, deliverables: JSON.parse(outputText) };
  } catch {
    throw httpError(502, "The AI provider returned campaign content that could not be parsed. Please retry.");
  }
}

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    notes: row.notes,
    brief: row.brief,
    deliverables: row.deliverables,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function saveCampaign(ownerHash, brief, deliverables) {
  const id = crypto.randomUUID();
  const title = String(deliverables.campaignName || brief.businessName + " campaign").slice(0, 160);
  const record = {
    id,
    title,
    status: "draft",
    notes: "",
    brief,
    deliverables,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (await ensureAdsSchema()) {
    const result = await pool.query(
      `INSERT INTO cap_ad_campaigns
        (id, owner_hash, title, status, notes, brief, deliverables)
       VALUES ($1, $2, $3, 'draft', '', $4::jsonb, $5::jsonb)
       RETURNING id, title, status, notes, brief, deliverables, created_at, updated_at`,
      [id, ownerHash, title, JSON.stringify(brief), JSON.stringify(deliverables)]
    );
    return { campaign: fromRow(result.rows[0]), storage: "postgres" };
  }

  memoryCampaigns.set(id, { ...record, ownerHash });
  return { campaign: record, storage: "memory" };
}

router.get("/capabilities", (_req, res) => {
  res.json({
    service: "CAP.AI advertising studio",
    strategyReady: Boolean(process.env.OPENAI_API_KEY && process.env.CAP_ADS_ACCESS_TOKEN),
    mediaGatewayAvailable: true,
    campaignStorage: process.env.DATABASE_URL ? "postgres-configured" : "memory-preview",
    supportedPlatforms: [...SUPPORTED_PLATFORMS],
    betaNote: "Account login, billing, campaign publishing and ad-network connections are not included in this backend build."
  });
});

router.use(requireAdsAccess);

const briefLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many campaign requests. Wait a minute before creating another." }
});

router.post("/brief", briefLimiter, async (req, res, next) => {
  try {
    const brief = readBrief(req.body);
    const generated = await generateAdStrategy(brief);
    const saved = await saveCampaign(req.capOwnerHash, brief, generated.deliverables);
    res.status(201).json({
      campaign: saved.campaign,
      model: generated.model,
      storage: saved.storage,
      nextStep: "Review the copy and risk checks. Send one of the creative prompts to POST /api/generate to render an image or video."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/campaigns", async (req, res, next) => {
  try {
    if (await ensureAdsSchema()) {
      const result = await pool.query(
        `SELECT id, title, status, notes, brief, deliverables, created_at, updated_at
           FROM cap_ad_campaigns
          WHERE owner_hash = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [req.capOwnerHash]
      );
      return res.json({ campaigns: result.rows.map(fromRow), storage: "postgres" });
    }

    const campaigns = [...memoryCampaigns.values()]
      .filter((item) => item.ownerHash === req.capOwnerHash)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50)
      .map(({ ownerHash: _ownerHash, ...item }) => item);
    res.json({ campaigns, storage: "memory" });
  } catch (error) {
    next(error);
  }
});

router.get("/campaigns/:id", async (req, res, next) => {
  try {
    if (await ensureAdsSchema()) {
      const result = await pool.query(
        `SELECT id, title, status, notes, brief, deliverables, created_at, updated_at
           FROM cap_ad_campaigns
          WHERE id = $1 AND owner_hash = $2`,
        [req.params.id, req.capOwnerHash]
      );
      if (!result.rowCount) return res.status(404).json({ error: "Campaign not found in this workspace." });
      return res.json({ campaign: fromRow(result.rows[0]), storage: "postgres" });
    }

    const item = memoryCampaigns.get(req.params.id);
    if (!item || item.ownerHash !== req.capOwnerHash) {
      return res.status(404).json({ error: "Campaign not found in this workspace." });
    }
    const { ownerHash: _ownerHash, ...campaign } = item;
    res.json({ campaign, storage: "memory" });
  } catch (error) {
    next(error);
  }
});

router.patch("/campaigns/:id", async (req, res, next) => {
  try {
    const status = req.body?.status;
    const notes = req.body?.notes;
    if (status !== undefined && !["draft", "approved", "archived"].includes(status)) {
      throw httpError(400, "Status must be draft, approved or archived.");
    }
    if (notes !== undefined && (typeof notes !== "string" || notes.length > 2000)) {
      throw httpError(400, "Campaign notes must be a string of 2,000 characters or fewer.");
    }

    if (await ensureAdsSchema()) {
      const result = await pool.query(
        `UPDATE cap_ad_campaigns
            SET status = COALESCE($3, status),
                notes = COALESCE($4, notes),
                updated_at = NOW()
          WHERE id = $1 AND owner_hash = $2
          RETURNING id, title, status, notes, brief, deliverables, created_at, updated_at`,
        [req.params.id, req.capOwnerHash, status ?? null, notes ?? null]
      );
      if (!result.rowCount) return res.status(404).json({ error: "Campaign not found in this workspace." });
      return res.json({ campaign: fromRow(result.rows[0]), storage: "postgres" });
    }

    const item = memoryCampaigns.get(req.params.id);
    if (!item || item.ownerHash !== req.capOwnerHash) {
      return res.status(404).json({ error: "Campaign not found in this workspace." });
    }
    if (status !== undefined) item.status = status;
    if (notes !== undefined) item.notes = notes;
    item.updatedAt = new Date().toISOString();
    const { ownerHash: _ownerHash, ...campaign } = item;
    res.json({ campaign, storage: "memory" });
  } catch (error) {
    next(error);
  }
});

router.delete("/campaigns/:id", async (req, res, next) => {
  try {
    if (await ensureAdsSchema()) {
      const result = await pool.query(
        "DELETE FROM cap_ad_campaigns WHERE id = $1 AND owner_hash = $2",
        [req.params.id, req.capOwnerHash]
      );
      if (!result.rowCount) return res.status(404).json({ error: "Campaign not found in this workspace." });
      return res.json({ ok: true });
    }

    const item = memoryCampaigns.get(req.params.id);
    if (!item || item.ownerHash !== req.capOwnerHash) {
      return res.status(404).json({ error: "Campaign not found in this workspace." });
    }
    memoryCampaigns.delete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
