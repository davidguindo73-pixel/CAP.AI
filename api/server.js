import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const PROVIDER_BASE = "https://api.higgsfield.ai";
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || "https://davidguindo73-pixel.github.io,http://localhost:5500,http://127.0.0.1:5500")
    .split(",").map((value) => value.trim()).filter(Boolean)
);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    return callback(new Error("This website origin is not allowed by CAP.AI API CORS settings."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-HF-API-Key", "X-CAP-Access-Token", "X-CAP-Client-ID"],
  maxAge: 600
}));
app.use(express.json({ limit: "1mb" }));
app.use(rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." }
}));

// This map stores only request metadata and a one-way owner hash, never a provider API key.
// It is intentionally in-memory for the prototype; deploy a database + authenticated accounts for production.
const jobs = new Map();
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
}, 15 * 60 * 1000).unref();

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
function getCredential(req) {
  const clientId = String(req.get("X-CAP-Client-ID") || "");
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(clientId)) {
    const error = new Error("A browser session ID is missing. Refresh CAP.AI and try again.");
    error.status = 400;
    throw error;
  }
  let apiKey;
  if (process.env.HF_API_KEY) {
    if (!process.env.CAP_API_ACCESS_TOKEN) {
      const error = new Error("Backend configuration incomplete: set CAP_API_ACCESS_TOKEN when using a shared provider key.");
      error.status = 503;
      throw error;
    }
    if (!safeEqual(req.get("X-CAP-Access-Token"), process.env.CAP_API_ACCESS_TOKEN)) {
      const error = new Error("Enter the private CAP.AI access token configured by the site owner.");
      error.status = 401;
      throw error;
    }
    apiKey = process.env.HF_API_KEY;
  } else {
    apiKey = String(req.get("X-HF-API-Key") || "").trim();
    if (apiKey.length < 12 || apiKey.length > 300) {
      const error = new Error("Enter a valid Higgsfield API key for this session.");
      error.status = 401;
      throw error;
    }
  }
  const ownerHash = crypto.createHash("sha256").update(clientId + ":" + apiKey).digest("hex");
  return { apiKey, ownerHash };
}
async function providerFetch(path, apiKey, options = {}) {
  const response = await fetch(PROVIDER_BASE + path, {
    ...options,
    headers: {
      Authorization: "Key " + apiKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: "Provider returned an unreadable response." }; }
  if (!response.ok) {
    // Do not echo provider request headers or credentials into a browser response.
    const detail = typeof data?.detail === "string" ? data.detail
      : typeof data?.message === "string" ? data.message
      : "The generation provider rejected the request.";
    const error = new Error(detail.slice(0, 500));
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  return data;
}
function cleanAspectRatio(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
function readInput(body) {
  const mode = String(body?.mode || "");
  const prompt = String(body?.prompt || "").trim();
  if (!["image", "video", "image-to-video", "video-restyle", "ad-image", "ad-video"].includes(mode)) {
    const error = new Error("Choose a supported generation workflow.");
    error.status = 400;
    throw error;
  }
  if (!prompt || prompt.length > 6000) {
    const error = new Error("Prompt must be between 1 and 6,000 characters.");
    error.status = 400;
    throw error;
  }
  const refs = Array.isArray(body.referenceUrls) ? body.referenceUrls.slice(0, 5) : [];
  const referenceKind = String(body.referenceKind || "image");
  if (refs.some((url) => typeof url !== "string" || !url.startsWith("https://"))) {
    const error = new Error("Reference URLs must be HTTPS URLs from a successful upload.");
    error.status = 400;
    throw error;
  }
  if (["image-to-video", "video-restyle"].includes(mode) && refs.length === 0) {
    const error = new Error("This workflow requires a reference image or video.");
    error.status = 400;
    throw error;
  }
  if (mode === "image-to-video" && refs.length && referenceKind !== "image") {
    const error = new Error("Image-to-video needs an image reference. Choose Reference Video / Restyle for a video file.");
    error.status = 400;
    throw error;
  }
  if (mode === "video-restyle" && refs.length && referenceKind !== "video") {
    const error = new Error("Reference Video / Restyle needs a video reference.");
    error.status = 400;
    throw error;
  }
  if (["image", "ad-image"].includes(mode) && referenceKind === "video" && refs.length) {
    const error = new Error("Image workflows accept image references only.");
    error.status = 400;
    throw error;
  }
  const isVideo = ["video", "image-to-video", "video-restyle", "ad-video"].includes(mode);
  const imageRatio = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"];
  const videoRatio = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
  let ratio = cleanAspectRatio(body.aspectRatio, isVideo ? videoRatio : imageRatio, isVideo ? "9:16" : "auto");
  if (mode === "image-to-video" && !["16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"].includes(ratio)) ratio = "adaptive";
  const resolution = isVideo
    ? (["480p", "720p", "1080p", "4k"].includes(body.resolution) ? body.resolution : "720p")
    : (["1k", "2k", "4k"].includes(body.resolution) ? body.resolution : "2k");
  const duration = Math.min(15, Math.max(4, Number.parseInt(body.duration, 10) || 5));
  const multiShots = body.multiShots === true;
  const videoModel = multiShots ? "kling" : (["seedance", "kling"].includes(body.videoModel) ? body.videoModel : "seedance");
  return { mode, prompt, refs, ratio, resolution, duration, isVideo, referenceKind, videoModel, multiShots };
}
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "CAP.AI generation gateway",
    provider: "Higgsfield API",
    credentialMode: process.env.HF_API_KEY ? "server-key" : "bring-your-own-key",
    generationReady: !process.env.HF_API_KEY || Boolean(process.env.CAP_API_ACCESS_TOKEN),
    modes: ["image", "video", "image-to-video", "video-restyle", "ad-image", "ad-video"],
    note: "Provider account, model access and credits are required. This prototype does not include user accounts or billing."
  });
});

app.post("/api/uploads/signed-url", async (req, res, next) => {
  try {
    const { apiKey } = getCredential(req);
    const contentType = String(req.body?.contentType || "");
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm", "video/quicktime"]);
    if (!allowed.has(contentType)) return res.status(400).json({ error: "Supported references: JPG, PNG, WEBP, AVIF, MP4, WEBM or MOV." });
    const signed = await providerFetch("/files/generate-upload-url", apiKey, {
      method: "POST",
      body: JSON.stringify({ content_type: contentType })
    });
    if (!signed.upload_url || !signed.public_url) return res.status(502).json({ error: "The provider did not return an upload URL." });
    // Signed URLs are returned only to the current browser and are never logged.
    res.json({ uploadUrl: signed.upload_url, uploadHeaders: signed.upload_headers || {}, publicUrl: signed.public_url });
  } catch (error) { next(error); }
});

app.post("/api/generate", async (req, res, next) => {
  try {
    const { apiKey, ownerHash } = getCredential(req);
    const input = readInput(req.body);
    let path;
    let payload;

    if (input.mode === "image" || input.mode === "ad-image") {
      path = "/marketing-studio/image";
      payload = {
        prompt: input.prompt,
        resolution: input.resolution,
        aspect_ratio: input.ratio,
        quality: ["low", "medium", "high", "xhigh", "max"].includes(req.body.quality) ? req.body.quality : "high",
        enhance_prompt: false,
        moderation: "auto",
        ...(input.refs.length ? { image_urls: input.refs.filter((_, index) => index < 4) } : {})
      };
    } else if (input.mode === "video-restyle") {
      path = "/kling-video/o3/video-edit";
      payload = {
        prompt: input.prompt,
        video_urls: input.refs,
        mode: input.resolution === "4k" ? "4k" : (["480p", "720p"].includes(input.resolution) ? "std" : "pro")
      };
    } else if (input.mode === "image-to-video" || input.refs.length) {
      path = "/alibaba/wan-3.0/reference-to-video";
      payload = {
        prompt: input.prompt,
        duration: Math.min(30, Math.max(2, input.duration)),
        resolution: input.resolution === "4k" ? "1080p" : input.resolution,
        aspect_ratio: input.ratio === "auto" ? "adaptive" : input.ratio,
        generate_audio: req.body.generateAudio !== false,
        enable_thinking: false,
        ...(input.refs.length ? (input.referenceKind === "video" ? { video_urls: input.refs } : { image_urls: input.refs }) : {})
      };
    } else if (input.videoModel === "kling") {
      path = "/kling-video/v3.0/std/text-to-video";
      payload = {
        prompt: input.prompt,
        duration: Math.min(15, Math.max(3, input.duration)),
        sound: req.body.generateAudio === false ? "off" : "on",
        multi_shots: input.multiShots,
        aspect_ratio: ["16:9", "9:16", "1:1"].includes(input.ratio) ? input.ratio : "16:9"
      };
    } else {
      path = "/bytedance/seedance-2.0/text-to-video";
      payload = {
        prompt: input.prompt,
        duration: input.duration,
        resolution: input.resolution,
        aspect_ratio: input.ratio,
        generate_audio: req.body.generateAudio !== false
      };
    }

    const result = await providerFetch(path, apiKey, { method: "POST", body: JSON.stringify(payload) });
    const providerRequestId = result.request_id || result.id;
    if (!providerRequestId) return res.status(502).json({ error: "Provider accepted no recognizable request ID.", providerMessage: result.message || undefined });
    const jobId = crypto.randomUUID();
    jobs.set(jobId, {
      providerRequestId: String(providerRequestId),
      ownerHash,
      mode: input.mode,
      modelPath: path,
      createdAt: Date.now()
    });
    res.status(202).json({ jobId, status: result.status || "queued", mode: input.mode, model: path, message: "Generation submitted. Poll this job for the result." });
  } catch (error) { next(error); }
});

app.get("/api/jobs/:jobId", async (req, res, next) => {
  try {
    const { ownerHash, apiKey } = getCredential(req);
    const job = jobs.get(req.params.jobId);
    if (!job || job.ownerHash !== ownerHash) return res.status(404).json({ error: "This job was not found in this browser session. Jobs reset when the API server restarts." });
    const data = await providerFetch("/requests/" + encodeURIComponent(job.providerRequestId) + "/status", apiKey, { method: "GET", headers: {} });
    const status = String(data.status || data.request?.status || "processing").toLowerCase();
    const imageUrls = Array.isArray(data.images) ? data.images.map((item) => item?.url).filter((url) => typeof url === "string" && url.startsWith("https://")) : [];
    const videoUrl = typeof data.video?.url === "string" && data.video.url.startsWith("https://") ? data.video.url : null;
    const resultUrls = [...imageUrls, ...(videoUrl ? [videoUrl] : [])];
    res.json({
      jobId: req.params.jobId,
      status,
      mode: job.mode,
      media: resultUrls.map((url, index) => ({ url, type: url === videoUrl ? "video" : "image", index })),
      error: ["failed", "nsfw", "canceled"].includes(status) ? (data.error?.message || data.message || "Generation did not complete.") : undefined
    });
  } catch (error) { next(error); }
});

app.post("/api/jobs/:jobId/cancel", async (req, res, next) => {
  try {
    const { ownerHash, apiKey } = getCredential(req);
    const job = jobs.get(req.params.jobId);
    if (!job || job.ownerHash !== ownerHash) return res.status(404).json({ error: "Job not found in this browser session." });
    const result = await providerFetch("/requests/" + encodeURIComponent(job.providerRequestId) + "/cancel", apiKey, { method: "POST", body: "{}" });
    res.json({ ok: true, status: result.status || "cancel_requested" });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error("[CAP.AI API]", error.message);
  res.status(status).json({ error: status === 500 ? "CAP.AI could not complete this request. Check the API configuration and server logs." : error.message });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CAP.AI generation API listening on port ${PORT}; provider keys are never logged.`);
});
