import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import rateLimit from "express-rate-limit";
import { pool, ensureSaasSchema } from "./db.js";

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const FRONTEND = (process.env.CAP_FRONTEND_URL || "https://davidguindo73-pixel.github.io/CAP.AI").replace(/\/$/, "");
const PLATFORM_NAMES = ["meta", "google", "tiktok"];

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
function token() {
  return crypto.randomBytes(32).toString("base64url");
}
function encryptionKey() {
  const raw = String(process.env.CAP_TOKEN_ENCRYPTION_KEY || "");
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, "hex");
  else {
    try { key = Buffer.from(raw, "base64"); } catch { key = null; }
  }
  if (!key || key.length !== 32) {
    throw fail(503, "Secure account connections are unavailable. Configure CAP_TOKEN_ENCRYPTION_KEY with a 32-byte key.");
  }
  return key;
}
function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decrypt(value) {
  if (!value) return null;
  const [ivPart, tagPart, dataPart] = String(value).split(".");
  if (!ivPart || !tagPart || !dataPart) throw fail(500, "A saved provider credential could not be read.");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw fail(500, "A saved provider credential could not be decrypted. Check the token encryption key.");
  }
}
export async function resolveUserFromRequest(req) {
  const header = String(req.get("Authorization") || "");
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{32,})$/i);
  if (!match) return null;
  if (!pool) throw fail(503, "Customer accounts require the CAP.AI PostgreSQL database.");
  await ensureSaasSchema();
  const result = await pool.query(
    "SELECT u.id, u.email, u.name FROM cap_users u JOIN cap_sessions s ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > NOW()",
    [hash(match[1])]
  );
  if (!result.rowCount) return null;
  return result.rows[0];
}
async function requireUser(req, _res, next) {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) throw fail(401, "Sign in to continue.");
    req.capUser = user;
    next();
  } catch (error) { next(error); }
}
async function issueSession(userId) {
  const raw = token();
  await pool.query(
    "INSERT INTO cap_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '12 hours')",
    [userId, hash(raw)]
  );
  return raw;
}
function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name };
}
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Wait 15 minutes and try again." }
});

router.get("/platform/status", async (_req, res, next) => {
  try {
    res.json({
      database: Boolean(pool),
      auth: Boolean(pool),
      businessProfiles: Boolean(pool),
      tokenVault: Boolean(process.env.CAP_TOKEN_ENCRYPTION_KEY),
      integrations: {
        meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI && (process.env.META_GRAPH_API_VERSION || "v27.0")),
        google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI && process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
        tiktok: Boolean(process.env.TIKTOK_APP_ID && process.env.TIKTOK_APP_SECRET && process.env.TIKTOK_ADVERTISER_AUTH_URL && process.env.TIKTOK_REDIRECT_URI)
      },
      billing: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PRICE_ID_STARTER),
      note: "Provider apps, permissions, reviews and billing prices must be configured by the CAP.AI owner."
    });
  } catch (error) { next(error); }
});

router.post("/auth/register", authLimiter, async (req, res, next) => {
  try {
    if (!pool) throw fail(503, "Customer registration requires PostgreSQL. Configure DATABASE_URL in Render.");
    await ensureSaasSchema();
    const name = String(req.body?.name || "").trim().slice(0, 100);
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!name) throw fail(400, "Enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw fail(400, "Enter a valid email address.");
    if (password.length < 12 || password.length > 200) throw fail(400, "Use a password between 12 and 200 characters.");
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = Buffer.from(await scrypt(password, salt, 64)).toString("hex");
    const result = await pool.query(
      "INSERT INTO cap_users (email, name, password_salt, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name",
      [email, name, salt, passwordHash]
    );
    const sessionToken = await issueSession(result.rows[0].id);
    res.status(201).json({ user: publicUser(result.rows[0]), token: sessionToken, expiresIn: 43200 });
  } catch (error) {
    if (error.code === "23505") return next(fail(409, "An account with this email already exists. Sign in instead."));
    next(error);
  }
});
router.post("/auth/login", authLimiter, async (req, res, next) => {
  try {
    if (!pool) throw fail(503, "Customer login requires PostgreSQL. Configure DATABASE_URL in Render.");
    await ensureSaasSchema();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const result = await pool.query(
      "SELECT id, email, name, password_salt, password_hash FROM cap_users WHERE email = $1",
      [email]
    );
    if (!result.rowCount) throw fail(401, "Email or password is incorrect.");
    const user = result.rows[0];
    const candidate = Buffer.from(await scrypt(password, user.password_salt, 64));
    const expected = Buffer.from(user.password_hash, "hex");
    if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
      throw fail(401, "Email or password is incorrect.");
    }
    const sessionToken = await issueSession(user.id);
    res.json({ user: publicUser(user), token: sessionToken, expiresIn: 43200 });
  } catch (error) { next(error); }
});
router.get("/auth/me", requireUser, (req, res) => res.json({ user: publicUser(req.capUser) }));
router.post("/auth/logout", requireUser, async (req, res, next) => {
  try {
    const header = String(req.get("Authorization") || "");
    const raw = header.replace(/^Bearer\s+/i, "");
    await pool.query("DELETE FROM cap_sessions WHERE token_hash = $1", [hash(raw)]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get("/business-profile", requireUser, async (req, res, next) => {
  try {
    await ensureSaasSchema();
    const result = await pool.query("SELECT profile FROM cap_business_profiles WHERE user_id = $1", [req.capUser.id]);
    res.json({ profile: result.rows[0]?.profile || null });
  } catch (error) { next(error); }
});
router.put("/business-profile", requireUser, async (req, res, next) => {
  try {
    await ensureSaasSchema();
    const body = req.body || {};
    const profile = {
      businessName: String(body.businessName || "").trim().slice(0, 120),
      website: String(body.website || "").trim().slice(0, 300),
      industry: String(body.industry || "").trim().slice(0, 100),
      location: String(body.location || "").trim().slice(0, 160),
      description: String(body.description || "").trim().slice(0, 1500),
      products: Array.isArray(body.products) ? body.products.slice(0, 20).map((v) => String(v).slice(0, 200)) : [],
      logoUrl: String(body.logoUrl || "").trim().slice(0, 1000),
      brandColor: /^#[0-9a-f]{6}$/i.test(String(body.brandColor || "")) ? body.brandColor : "#111111",
      brandVoice: String(body.brandVoice || "").trim().slice(0, 300),
      updatedAt: new Date().toISOString()
    };
    if (!profile.businessName) throw fail(400, "Business name is required.");
    if (profile.website && !/^https:\/\//i.test(profile.website)) throw fail(400, "Business website must start with https://.");
    const result = await pool.query(
      "INSERT INTO cap_business_profiles (user_id, profile) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW() RETURNING profile",
      [req.capUser.id, JSON.stringify(profile)]
    );
    res.json({ profile: result.rows[0].profile });
  } catch (error) { next(error); }
});

async function createOAuthState(userId, platform, redirectUri) {
  const raw = token();
  await pool.query(
    "INSERT INTO cap_oauth_states (state_hash, user_id, platform, redirect_uri, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')",
    [hash(raw), userId, platform, redirectUri]
  );
  return raw;
}
async function consumeOAuthState(raw, platform) {
  if (!raw || String(raw).length > 200) throw fail(400, "OAuth state is missing or invalid.");
  const result = await pool.query(
    "DELETE FROM cap_oauth_states WHERE state_hash = $1 AND platform = $2 AND expires_at > NOW() RETURNING user_id, redirect_uri",
    [hash(raw), platform]
  );
  if (!result.rowCount) throw fail(400, "This connection link expired or was already used. Start the connection again.");
  return result.rows[0];
}
function providerReady(platform) {
  if (platform === "meta") return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI && (process.env.META_GRAPH_API_VERSION || "v27.0"));
  if (platform === "google") return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
  if (platform === "tiktok") return Boolean(process.env.TIKTOK_APP_ID && process.env.TIKTOK_APP_SECRET && process.env.TIKTOK_ADVERTISER_AUTH_URL && process.env.TIKTOK_REDIRECT_URI);
  return false;
}
function connectionRedirect(query) {
  const url = new URL(FRONTEND + "/workspace.html");
  for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, String(value));
  return url.toString();
}
async function saveConnection({ userId, platform, remoteUserId, accountName, accessToken, refreshToken, expiresIn, scopes, metadata }) {
  const accessTokenEnc = encrypt(accessToken);
  const refreshTokenEnc = encrypt(refreshToken);
  await pool.query(
    `INSERT INTO cap_connected_accounts
      (user_id, platform, remote_user_id, account_name, access_token_enc, refresh_token_enc, access_token_expires_at, scopes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (user_id, platform, remote_user_id) DO UPDATE SET
       account_name=EXCLUDED.account_name, access_token_enc=EXCLUDED.access_token_enc,
       refresh_token_enc=COALESCE(EXCLUDED.refresh_token_enc, cap_connected_accounts.refresh_token_enc),
       access_token_expires_at=EXCLUDED.access_token_expires_at, scopes=EXCLUDED.scopes,
       metadata=EXCLUDED.metadata, updated_at=NOW()`,
    [userId, platform, remoteUserId, accountName || platform, accessTokenEnc, refreshTokenEnc,
      expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString() : null,
      scopes || [], JSON.stringify(metadata || {})]
  );
}
async function remoteJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw fail(502, "An advertising platform returned unreadable data."); }
  if (!response.ok || data?.error || data?.code && Number(data.code) !== 0) {
    const detail = data?.error?.message || data?.message || data?.error_description || "The advertising platform rejected the request.";
    throw fail(502, String(detail).slice(0, 350));
  }
  return data;
}
async function finishOAuth(platform, code, state) {
  const stateData = await consumeOAuthState(state, platform);
  const userId = stateData.user_id;
  if (platform === "meta") {
    const version = (process.env.META_GRAPH_API_VERSION || "v27.0");
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: stateData.redirect_uri,
      code
    });
    const shortToken = await remoteJson("https://graph.facebook.com/" + version + "/oauth/access_token?" + params.toString());
    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: shortToken.access_token
    });
    let tokenData = shortToken;
    try { tokenData = await remoteJson("https://graph.facebook.com/" + version + "/oauth/access_token?" + longParams.toString()); } catch { /* short token can still be saved for testing */ }
    const identity = await remoteJson("https://graph.facebook.com/" + version + "/me?fields=id,name&access_token=" + encodeURIComponent(tokenData.access_token));
    await saveConnection({ userId, platform, remoteUserId: String(identity.id), accountName: identity.name || "Meta account", accessToken: tokenData.access_token, expiresIn: tokenData.expires_in, scopes: ["ads_read", "ads_management", "business_management"], metadata: { connectedAt: new Date().toISOString() } });
  } else if (platform === "google") {
    const tokenData = await remoteJson("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: stateData.redirect_uri, grant_type: "authorization_code"
      })
    });
    if (!tokenData.refresh_token && !tokenData.access_token) throw fail(502, "Google did not return an authorization token. Reconnect and approve offline access.");
    await saveConnection({ userId, platform, remoteUserId: "google-ads", accountName: "Google Ads connection", accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token, expiresIn: tokenData.expires_in, scopes: ["https://www.googleapis.com/auth/adwords"], metadata: { tokenType: tokenData.token_type } });
  } else if (platform === "tiktok") {
    const codeParams = new URLSearchParams({
      app_id: process.env.TIKTOK_APP_ID,
      secret: process.env.TIKTOK_APP_SECRET,
      auth_code: code
    });
    const tokenData = await remoteJson("https://business-api.tiktok.com/open_api/" + (process.env.TIKTOK_API_VERSION || "v2.0") + "/oauth2/access_token/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        app_id: process.env.TIKTOK_APP_ID,
        secret: process.env.TIKTOK_APP_SECRET,
        auth_code: code
      })
    });
    const data = tokenData.data || tokenData;
    const accessToken = data.access_token;
    if (!accessToken) throw fail(502, "TikTok did not return an advertiser access token.");
    await saveConnection({ userId, platform, remoteUserId: String(data.advertiser_id || "tiktok-advertiser"), accountName: "TikTok For Business", accessToken, refreshToken: data.refresh_token, expiresIn: null, scopes: ["advertiser_management", "reporting"], metadata: { advertiserIds: data.advertiser_ids || (data.advertiser_id ? [data.advertiser_id] : []) } });
  }
}
router.get("/integrations", requireUser, async (req, res, next) => {
  try {
    await ensureSaasSchema();
    const result = await pool.query(
      "SELECT platform, remote_user_id, account_name, scopes, access_token_expires_at, updated_at FROM cap_connected_accounts WHERE user_id = $1 ORDER BY platform",
      [req.capUser.id]
    );
    res.json({
      connections: result.rows.map((row) => ({
        platform: row.platform, remoteUserId: row.remote_user_id, accountName: row.account_name,
        scopes: row.scopes, expiresAt: row.access_token_expires_at, updatedAt: row.updated_at
      })),
      available: Object.fromEntries(PLATFORM_NAMES.map((name) => [name, providerReady(name)]))
    });
  } catch (error) { next(error); }
});
router.get("/integrations/:platform/connect", requireUser, async (req, res, next) => {
  try {
    const platform = String(req.params.platform || "").toLowerCase();
    if (!PLATFORM_NAMES.includes(platform)) throw fail(404, "Unknown advertising platform.");
    if (!providerReady(platform)) throw fail(503, "This provider is not configured yet. Add its app credentials and callback URL in Render.");
    const redirectUri = platform === "meta" ? process.env.META_REDIRECT_URI : platform === "google" ? process.env.GOOGLE_REDIRECT_URI : process.env.TIKTOK_REDIRECT_URI;
    const state = await createOAuthState(req.capUser.id, platform, redirectUri);
    let target;
    if (platform === "meta") {
      const params = new URLSearchParams({
        client_id: process.env.META_APP_ID, redirect_uri: redirectUri, state,
        response_type: "code", scope: process.env.META_OAUTH_SCOPES || "ads_read,ads_management,business_management,pages_show_list,pages_read_engagement"
      });
      target = "https://www.facebook.com/" + (process.env.META_GRAPH_API_VERSION || "v27.0") + "/dialog/oauth?" + params.toString();
    } else if (platform === "google") {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code",
        scope: "openid email https://www.googleapis.com/auth/adwords", access_type: "offline", prompt: "consent", state
      });
      target = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
    } else {
      target = new URL(process.env.TIKTOK_ADVERTISER_AUTH_URL);
      target.searchParams.set("state", state);
      target.searchParams.set("redirect_uri", redirectUri);
      target = target.toString();
    }
    res.redirect(302, target);
  } catch (error) { next(error); }
});
for (const platform of PLATFORM_NAMES) {
  router.get("/integrations/" + platform + "/callback", async (req, res) => {
    try {
      if (req.query.error) throw fail(400, "The advertising account connection was cancelled or denied.");
      const code = String(req.query.auth_code || req.query.code || "");
      const state = String(req.query.state || "");
      if (!code) throw fail(400, "The advertising platform did not return an authorization code.");
      await finishOAuth(platform, code, state);
      res.redirect(connectionRedirect({ connected: platform }));
    } catch (error) {
      res.redirect(connectionRedirect({ connect_error: error.message || "Connection failed", platform }));
    }
  });
}
async function getConnection(userId, platform) {
  const result = await pool.query(
    "SELECT * FROM cap_connected_accounts WHERE user_id=$1 AND platform=$2 ORDER BY updated_at DESC LIMIT 1",
    [userId, platform]
  );
  if (!result.rowCount) throw fail(404, "Connect this advertising account first.");
  return result.rows[0];
}
async function accessTokenFor(row, platform) {
  let accessToken = decrypt(row.access_token_enc);
  const expiring = row.access_token_expires_at && new Date(row.access_token_expires_at).getTime() < Date.now() + 60_000;
  if (platform === "google" && expiring) {
    const refreshToken = decrypt(row.refresh_token_enc);
    if (!refreshToken) throw fail(401, "Google authorization expired. Reconnect the account.");
    const renewed = await remoteJson("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" })
    });
    accessToken = renewed.access_token;
    await pool.query(
      "UPDATE cap_connected_accounts SET access_token_enc=$1, access_token_expires_at=$2, updated_at=NOW() WHERE id=$3",
      [encrypt(accessToken), new Date(Date.now() + Number(renewed.expires_in || 3600) * 1000).toISOString(), row.id]
    );
  } else if (expiring) {
    throw fail(401, "This provider authorization may have expired. Reconnect the account.");
  }
  return accessToken;
}
router.get("/integrations/:platform/accounts", requireUser, async (req, res, next) => {
  try {
    const platform = String(req.params.platform || "").toLowerCase();
    if (!PLATFORM_NAMES.includes(platform)) throw fail(404, "Unknown advertising platform.");
    const connection = await getConnection(req.capUser.id, platform);
    const accessToken = await accessTokenFor(connection, platform);
    let accounts = [];
    if (platform === "meta") {
      const data = await remoteJson("https://graph.facebook.com/" + (process.env.META_GRAPH_API_VERSION || "v27.0") + "/me/adaccounts?fields=id,name,account_status,currency,timezone_name&limit=100&access_token=" + encodeURIComponent(accessToken));
      accounts = (data.data || []).map((item) => ({ id: item.id, name: item.name, status: item.account_status, currency: item.currency, timezone: item.timezone_name }));
    } else if (platform === "google") {
      if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) throw fail(503, "Add GOOGLE_ADS_DEVELOPER_TOKEN to use Google Ads account discovery.");
      const headers = { Authorization: "Bearer " + accessToken, "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN };
      const data = await remoteJson("https://googleads.googleapis.com/" + (process.env.GOOGLE_ADS_API_VERSION || "v26") + "/customers:listAccessibleCustomers", { headers });
      accounts = (data.resourceNames || []).map((name) => ({ id: name.split("/").pop(), name: "Google Ads " + name.split("/").pop() }));
    } else {
      const ids = connection.metadata?.advertiserIds || [];
      accounts = ids.map((id) => ({ id: String(id), name: "TikTok advertiser " + id }));
    }
    res.json({ platform, accounts });
  } catch (error) { next(error); }
});
router.get("/integrations/meta/pages", requireUser, async (req, res, next) => {
  try {
    await ensureSaasSchema();
    const connection = await getConnection(req.capUser.id, "meta");
    const accessToken = await accessTokenFor(connection, "meta");
    const version = (process.env.META_GRAPH_API_VERSION || "v27.0");
    const data = await remoteJson("https://graph.facebook.com/" + version + "/me/accounts?fields=id,name,access_token,tasks&limit=100&access_token=" + encodeURIComponent(accessToken));
    const pages = (data.data || []).map((page) => ({
      id: String(page.id),
      name: String(page.name || "Facebook Page"),
      accessTokenEnc: page.access_token ? encrypt(page.access_token) : null,
      tasks: Array.isArray(page.tasks) ? page.tasks : []
    }));
    await pool.query(
      "UPDATE cap_connected_accounts SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pages', $1::jsonb), updated_at=NOW() WHERE id=$2",
      [JSON.stringify(pages), connection.id]
    );
    res.json({ pages: pages.map(({ id, name, tasks }) => ({ id, name, tasks })) });
  } catch (error) { next(error); }
});
router.delete("/integrations/:platform", requireUser, async (req, res, next) => {
  try {
    const platform = String(req.params.platform || "").toLowerCase();
    if (!PLATFORM_NAMES.includes(platform)) throw fail(404, "Unknown advertising platform.");
    await pool.query("DELETE FROM cap_connected_accounts WHERE user_id=$1 AND platform=$2", [req.capUser.id, platform]);
    res.json({ ok: true, message: "Connection removed from CAP.AI. Revoke the app in the provider's security settings as well." });
  } catch (error) { next(error); }
});
router.get("/analytics/:platform", requireUser, async (req, res, next) => {
  try {
    const platform = String(req.params.platform || "").toLowerCase();
    const accountId = String(req.query.accountId || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!PLATFORM_NAMES.includes(platform)) throw fail(404, "Unknown advertising platform.");
    if (!accountId) throw fail(400, "Choose an advertising account.");
    const connection = await getConnection(req.capUser.id, platform);
    const accessToken = await accessTokenFor(connection, platform);
    let report;
    if (platform === "meta") {
      const id = accountId.startsWith("act_") ? accountId : "act_" + accountId;
      report = await remoteJson("https://graph.facebook.com/" + (process.env.META_GRAPH_API_VERSION || "v27.0") + "/" + id + "/insights?fields=campaign_name,impressions,clicks,spend,reach,ctr,cpc,actions&date_preset=last_30d&level=campaign&access_token=" + encodeURIComponent(accessToken));
    } else if (platform === "google") {
      if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) throw fail(503, "Google Ads API developer token is not configured.");
      const query = "SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.impressions DESC";
      report = await remoteJson("https://googleads.googleapis.com/" + (process.env.GOOGLE_ADS_API_VERSION || "v26") + "/customers/" + accountId + "/googleAds:searchStream", {
        method: "POST", headers: { Authorization: "Bearer " + accessToken, "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ query })
      });
    } else {
      report = await remoteJson("https://business-api.tiktok.com/open_api/" + (process.env.TIKTOK_API_VERSION || "v2.0") + "/report/integrated/get/", {
        method: "POST", headers: { "Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ advertiser_id: accountId, report_type: "BASIC", data_level: "AUCTION_ADVERTISER", dimensions: ["stat_time_day"], metrics: ["spend", "impressions", "clicks", "conversion"], start_date: new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10), end_date: new Date().toISOString().slice(0,10), page: 1, page_size: 100 })
      });
    }
    res.json({ platform, accountId, period: "last_30_days", report });
  } catch (error) { next(error); }
});


async function ownedCampaign(userId, campaignId) {
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw fail(400, "Campaign ID is invalid.");
  const ownerHash = hash("user:" + userId);
  const result = await pool.query(
    "SELECT id, title, status, brief, deliverables FROM cap_ad_campaigns WHERE id=$1 AND owner_hash=$2",
    [campaignId, ownerHash]
  );
  if (!result.rowCount) throw fail(404, "Campaign not found in this customer workspace.");
  if (result.rows[0].status !== "approved") throw fail(409, "Approve this campaign in Ad Studio before preparing a platform draft.");
  return result.rows[0];
}
function validateLaunchInput(body) {
  const accountId = String(body?.accountId || "").replace(/^act_/, "").replace(/-/g, "");
  const dailyBudget = Number(body?.dailyBudget);
  const destinationUrl = String(body?.destinationUrl || "").trim();
  const countryCode = String(body?.countryCode || "US").trim().toUpperCase();
  if (!/^\d{10}$/.test(accountId)) throw fail(400, "Google Ads customer IDs must contain exactly 10 digits.");
  if (!Number.isFinite(dailyBudget) || dailyBudget < 1 || dailyBudget > 5000) throw fail(400, "Set a daily budget between 1 and 5,000 in the account currency.");
  if (!/^https:\/\//i.test(destinationUrl)) throw fail(400, "Enter a public HTTPS destination URL.");
  if (!/^[A-Z]{2}$/.test(countryCode)) throw fail(400, "Enter a two-letter country code for campaign targeting.");
  return { accountId, dailyBudget, destinationUrl, countryCode };
}
async function googleSearch(customerId, accessToken, query) {
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) throw fail(503, "Google Ads API developer token is not configured.");
  const headers = {
    Authorization: "Bearer " + accessToken,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    "Content-Type": "application/json"
  };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "");
  const data = await remoteJson(
    "https://googleads.googleapis.com/" + (process.env.GOOGLE_ADS_API_VERSION || "v26") + "/customers/" + customerId + "/googleAds:search",
    { method: "POST", headers, body: JSON.stringify({ query }) }
  );
  return data.results || [];
}
async function googleMutate(customerId, resource, accessToken, operations) {
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) throw fail(503, "Google Ads API developer token is not configured.");
  const headers = {
    Authorization: "Bearer " + accessToken,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    "Content-Type": "application/json"
  };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "");
  const data = await remoteJson(
    "https://googleads.googleapis.com/" + (process.env.GOOGLE_ADS_API_VERSION || "v26") + "/customers/" + customerId + "/" + resource + ":mutate",
    { method: "POST", headers, body: JSON.stringify({ operations }) }
  );
  const name = data.results?.[0]?.resourceName;
  if (!name) throw fail(502, "Google Ads did not return a resource ID for the prepared campaign.");
  return name;
}
router.post("/publish/:platform/:campaignId", requireUser, async (req, res, next) => {
  try {
    const platform = String(req.params.platform || "").toLowerCase();
    if (!["meta", "google"].includes(platform)) throw fail(501, "CAP.AI's paused campaign builder is not enabled for this platform yet.");
    await ensureSaasSchema();
    const campaign = await ownedCampaign(req.capUser.id, req.params.campaignId);
    const input = validateLaunchInput(req.body || {});
    const connection = await getConnection(req.capUser.id, platform);
    const accessToken = await accessTokenFor(connection, platform);
    let campaignResource, adsetResource, adResource, creativeResource = null, publicationCurrency = "USD";
    const brief = campaign.brief || {};
    const deliverables = campaign.deliverables || {};
    if (platform === "meta") {
      const version = (process.env.META_GRAPH_API_VERSION || "v27.0");
      const accounts = await remoteJson("https://graph.facebook.com/" + version + "/me/adaccounts?fields=id,currency&limit=100&access_token=" + encodeURIComponent(accessToken));
      const chosen = (accounts.data || []).find((item) => String(item.id).replace(/^act_/, "") === input.accountId);
      if (!chosen) throw fail(403, "That Meta ad account is not accessible through the connected account.");
      const pageId = String(req.body?.pageId || "").replace(/[^0-9]/g, "");
      const selectedPage = (connection.metadata?.pages || []).find((page) => String(page.id) === pageId);
      if (!pageId || !selectedPage) throw fail(400, "Load your Facebook Pages in Workspace and select one before creating a Meta ad.");
      const pageAccessToken = decrypt(selectedPage.accessTokenEnc) || accessToken;
      const imageUrl = String(req.body?.imageUrl || "").trim();
      if (!/^https:\/\//i.test(imageUrl)) throw fail(400, "Meta campaigns require a public HTTPS image URL for the ad creative.");
      const metaCopy = deliverables.adCopies?.meta || {};
      const suffix = Date.now().toString();
      const accountPath = "act_" + input.accountId;
      const form = async (path, payload, credential = accessToken) => remoteJson("https://graph.facebook.com/" + version + "/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...payload, access_token: credential })
      });
      const campaignResult = await form(accountPath + "/campaigns", {
        name: (campaign.title || brief.businessName || "CAP.AI campaign").slice(0, 180) + " " + suffix,
        objective: "OUTCOME_TRAFFIC",
        status: "PAUSED",
        special_ad_categories: "[]",
        buying_type: "AUCTION"
      });
      campaignResource = campaignResult.id;
      publicationCurrency = chosen.currency || req.body.currency || "USD";
      const targeting = {
        geo_locations: { countries: [input.countryCode] },
        publisher_platforms: ["facebook", "instagram"]
      };
      const adsetResult = await form(accountPath + "/adsets", {
        name: "CAP.AI traffic ad set " + suffix,
        campaign_id: campaignResource,
        daily_budget: String(Math.round(input.dailyBudget * 100)),
        billing_event: "IMPRESSIONS",
        optimization_goal: "LINK_CLICKS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: JSON.stringify(targeting),
        status: "PAUSED"
      });
      adsetResource = adsetResult.id;
      const story = {
        page_id: pageId,
        link_data: {
          link: input.destinationUrl,
          picture: imageUrl,
          message: String(metaCopy.primaryText || brief.businessDescription || "").slice(0, 2000),
          name: String(metaCopy.headline || campaign.title || "Learn more").slice(0, 255),
          description: String(metaCopy.description || "").slice(0, 255),
          call_to_action: { type: "LEARN_MORE", value: { link: input.destinationUrl } }
        }
      };
      const creativeResult = await form(accountPath + "/adcreatives", {
        name: "CAP.AI creative " + suffix,
        object_story_spec: JSON.stringify(story)
      }, pageAccessToken);
      creativeResource = creativeResult.id;
      const adResult = await form(accountPath + "/ads", {
        name: (campaign.title || "CAP.AI ad").slice(0, 180) + " " + suffix,
        adset_id: adsetResource,
        creative: JSON.stringify({ creative_id: creativeResource }),
        status: "PAUSED"
      });
      adResource = adResult.id;
    } else {
      const customerId = input.accountId;
      const customerRows = await googleSearch(customerId, accessToken, "SELECT customer.currency_code FROM customer LIMIT 1");
      publicationCurrency = customerRows[0]?.customer?.currencyCode || "USD";
      const locationRows = await googleSearch(
        customerId,
        accessToken,
        "SELECT geo_target_constant.resource_name, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.country_code = '" + input.countryCode + "' AND geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED' LIMIT 1"
      );
      const countryTarget = locationRows[0]?.geoTargetConstant?.resourceName;
      if (!countryTarget) throw fail(400, "Google Ads could not find an enabled country target for " + input.countryCode + ".");
      const googleCopy = deliverables.adCopies?.googleSearch || {};
      const headlines = [...new Set([...(googleCopy.headlines || []), campaign.title || brief.businessName || "Learn more"])]
        .map((value) => String(value).trim().slice(0, 30)).filter(Boolean).slice(0, 15);
      const descriptions = [...new Set([...(googleCopy.descriptions || []), brief.businessDescription || "Learn more about our products and services."])]
        .map((value) => String(value).trim().slice(0, 90)).filter(Boolean).slice(0, 4);
      while (headlines.length < 3) headlines.push(String(brief.businessName || "Explore our services").slice(0, 30));
      while (descriptions.length < 2) descriptions.push("Visit our website to learn more.");
      const budgetResource = await googleMutate(customerId, "campaignBudgets", accessToken, [{
        create: {
          name: "CAP.AI budget " + Date.now(),
          amountMicros: String(Math.round(input.dailyBudget * 1000000)),
          deliveryMethod: "STANDARD",
          explicitlyShared: false
        }
      }]);
      campaignResource = await googleMutate(customerId, "campaigns", accessToken, [{
        create: {
          name: String(campaign.title || brief.businessName || "CAP.AI campaign").slice(0, 128) + " " + Date.now(),
          advertisingChannelType: "SEARCH",
          status: "PAUSED",
          campaignBudget: budgetResource,
          manualCpc: {},
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false
          }
        }
      }]);
      await googleMutate(customerId, "campaignCriteria", accessToken, [{
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: countryTarget }
        }
      }]);
      adsetResource = await googleMutate(customerId, "adGroups", accessToken, [{
        create: {
          name: "CAP.AI search ad group",
          campaign: campaignResource,
          status: "PAUSED",
          type: "SEARCH_STANDARD",
          cpcBidMicros: "1000000"
        }
      }]);
      const keywordIdeas = [...new Set((googleCopy.keywordIdeas || []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 10);
      if (keywordIdeas.length) {
        const keywordOperations = keywordIdeas.map((word) => ({
          create: { adGroup: adsetResource, status: "ENABLED", keyword: { text: word.slice(0, 80), matchType: "BROAD" } }
        }));
        await googleMutate(customerId, "adGroupCriteria", accessToken, keywordOperations);
      }
      adResource = await googleMutate(customerId, "adGroupAds", accessToken, [{
        create: {
          adGroup: adsetResource,
          status: "PAUSED",
          ad: {
            finalUrls: [input.destinationUrl],
            responsiveSearchAd: {
              headlines: headlines.map((text) => ({ text })),
              descriptions: descriptions.map((text) => ({ text }))
            }
          }
        }
      }]);
    }
    const publication = await pool.query(
      "INSERT INTO cap_platform_publications (user_id,campaign_id,platform,external_campaign_id,external_adset_id,external_ad_id,status,budget_amount,currency,destination_url,provider_response) VALUES ($1,$2,$3,$4,$5,$6,'paused',$7,$8,$9,$10::jsonb) RETURNING id,status,external_campaign_id,external_adset_id,external_ad_id,budget_amount,currency",
      [req.capUser.id, campaign.id, platform, campaignResource, adsetResource, adResource, input.dailyBudget, publicationCurrency, input.destinationUrl, JSON.stringify({ creativeId: creativeResource })]
    );
    res.status(201).json({
      publication: publication.rows[0],
      message: "The platform campaign, ad group and ad were created paused. They cannot spend until you explicitly activate them with the exact daily budget confirmation."
    });
  } catch (error) { next(error); }
});
router.post("/publish/:platform/:publicationId/activate", requireUser, async (req, res, next) => {
  try {
    const platform = String(req.params.platform || "").toLowerCase();
    if (!["meta", "google"].includes(platform)) throw fail(501, "Campaign activation is not enabled for this platform yet.");
    if (req.body?.confirmSpend !== true) throw fail(400, "Explicitly confirm that you want this campaign to start spending.");
    const result = await pool.query(
      "SELECT * FROM cap_platform_publications WHERE id=$1 AND user_id=$2 AND platform=$3",
      [req.params.publicationId, req.capUser.id, platform]
    );
    if (!result.rowCount) throw fail(404, "Paused campaign not found.");
    const publication = result.rows[0];
    if (publication.status === "active") throw fail(409, "This campaign is already active.");
    if (Number(req.body?.dailyBudgetConfirmed) !== Number(publication.budget_amount)) {
      throw fail(400, "The confirmed daily budget must exactly match the paused campaign budget (" + publication.budget_amount + " " + publication.currency + ").");
    }
    const connection = await getConnection(req.capUser.id, platform);
    const accessToken = await accessTokenFor(connection, platform);
    if (platform === "meta") {
      const version = (process.env.META_GRAPH_API_VERSION || "v27.0");
      const postStatus = async (id) => remoteJson("https://graph.facebook.com/" + version + "/" + id, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status: "ACTIVE", access_token: accessToken })
      });
      await postStatus(publication.external_ad_id);
      await postStatus(publication.external_adset_id);
      await postStatus(publication.external_campaign_id);
    } else {
      const customerId = publication.external_campaign_id.split("/")[1];
      const update = async (resource, resourceName) => googleMutate(customerId, resource, accessToken, [{
        update: { resourceName, status: "ENABLED" }, updateMask: "status"
      }]);
      await update("adGroupAds", publication.external_ad_id);
      await update("adGroups", publication.external_adset_id);
      await update("campaigns", publication.external_campaign_id);
    }
    await pool.query("UPDATE cap_platform_publications SET status='active',updated_at=NOW() WHERE id=$1 AND user_id=$2", [publication.id, req.capUser.id]);
    res.json({ ok: true, status: "active", message: "The campaign was activated in the connected advertising account." });
  } catch (error) { next(error); }
});
router.get("/publish/:campaignId", requireUser, async (req, res, next) => {
  try {
    const campaign = await ownedCampaign(req.capUser.id, req.params.campaignId);
    const result = await pool.query(
      "SELECT id,platform,external_campaign_id,status,budget_amount,currency,destination_url,created_at FROM cap_platform_publications WHERE user_id=$1 AND campaign_id=$2 ORDER BY created_at DESC",
      [req.capUser.id, campaign.id]
    );
    res.json({ publications: result.rows });
  } catch (error) { next(error); }
});

router.get("/billing/plans", (_req, res) => {
  res.json({ plans: [
    { id: "starter", name: "Starter", configured: Boolean(process.env.STRIPE_PRICE_ID_STARTER) },
    { id: "pro", name: "Pro", configured: Boolean(process.env.STRIPE_PRICE_ID_PRO) }
  ] });
});
router.post("/billing/checkout", requireUser, async (req, res, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw fail(503, "CAP.AI subscriptions are not configured yet.");
    const plan = String(req.body?.plan || "starter").toLowerCase();
    const priceId = plan === "pro" ? process.env.STRIPE_PRICE_ID_PRO : plan === "starter" ? process.env.STRIPE_PRICE_ID_STARTER : "";
    if (!priceId) throw fail(400, "This subscription plan is not configured.");
    const existing = await pool.query("SELECT stripe_customer_id FROM cap_billing_accounts WHERE user_id=$1", [req.capUser.id]);
    let customerId = existing.rows[0]?.stripe_customer_id;
    if (!customerId) {
      const body = new URLSearchParams({ email: req.capUser.email, name: req.capUser.name, "metadata[userId]": req.capUser.id });
      const customer = await remoteJson("https://api.stripe.com/v1/customers", { method: "POST", headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body });
      customerId = customer.id;
      await pool.query("INSERT INTO cap_billing_accounts (user_id, stripe_customer_id) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id=EXCLUDED.stripe_customer_id", [req.capUser.id, customerId]);
    }
    const body = new URLSearchParams({
      mode: "subscription", customer: customerId, "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
      success_url: FRONTEND + "/workspace.html?billing=success", cancel_url: FRONTEND + "/workspace.html?billing=cancelled",
      "metadata[userId]": req.capUser.id, "subscription_data[metadata][userId]": req.capUser.id
    });
    const session = await remoteJson("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST", headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": crypto.randomUUID() }, body
    });
    res.json({ url: session.url });
  } catch (error) { next(error); }
});
router.post("/billing/portal", requireUser, async (req, res, next) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw fail(503, "CAP.AI billing is not configured yet.");
    const account = await pool.query("SELECT stripe_customer_id FROM cap_billing_accounts WHERE user_id=$1", [req.capUser.id]);
    if (!account.rowCount) throw fail(404, "No billing customer exists yet. Choose a subscription first.");
    const portal = await remoteJson("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST", headers: { Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer: account.rows[0].stripe_customer_id, return_url: FRONTEND + "/workspace.html" })
    });
    res.json({ url: portal.url });
  } catch (error) { next(error); }
});
router.get("/billing/status", requireUser, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT plan, subscription_status, current_period_end FROM cap_billing_accounts WHERE user_id=$1", [req.capUser.id]);
    res.json({ billing: result.rows[0] || { plan: "free", subscription_status: "inactive" } });
  } catch (error) { next(error); }
});

function verifyStripeSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const parts = Object.fromEntries(signature.split(",").map((piece) => piece.split("=", 2)));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(String(timestamp) + ".").update(rawBody).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(parts.v1);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
router.post("/billing/webhook", async (req, res) => {
  try {
    if (!verifyStripeSignature(req.rawBody, req.get("Stripe-Signature"), process.env.STRIPE_WEBHOOK_SECRET)) {
      return res.status(400).json({ error: "Invalid Stripe webhook signature." });
    }
    const event = JSON.parse(req.rawBody.toString("utf8"));
    const object = event.data?.object || {};
    if (event.type === "checkout.session.completed") {
      const userId = object.metadata?.userId || object.client_reference_id;
      if (userId && object.customer) {
        await pool.query(
          "INSERT INTO cap_billing_accounts (user_id, stripe_customer_id, stripe_subscription_id, subscription_status, plan) VALUES ($1,$2,$3,'checkout_complete',$4) ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id=EXCLUDED.stripe_customer_id, stripe_subscription_id=EXCLUDED.stripe_subscription_id, subscription_status='checkout_complete', plan=EXCLUDED.plan, updated_at=NOW()",
          [userId, object.customer, object.subscription || null, object.metadata?.plan || "paid"]
        );
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const customerId = object.customer;
      const userId = object.metadata?.userId;
      const priceId = object.items?.data?.[0]?.price?.id || "";
      const plan = priceId && priceId === process.env.STRIPE_PRICE_ID_PRO ? "pro" : "starter";
      const update = await pool.query(
        "UPDATE cap_billing_accounts SET stripe_subscription_id=$1, subscription_status=$2, current_period_end=to_timestamp($3), plan=$4, updated_at=NOW() WHERE stripe_customer_id=$5 OR ($6::uuid IS NOT NULL AND user_id=$6)",
        [object.id, object.status || "unknown", object.current_period_end || null, plan, customerId, userId || null]
      );
    }
    res.json({ received: true });
  } catch {
    res.status(400).json({ error: "Webhook processing failed." });
  }
});

export default router;
