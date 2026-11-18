# CAP.AI Advertising + Media API

CAP.AI is moving from a prompt/media prototype toward an AI advertising studio. This backend now has two connected parts:

1. **Advertising strategy** — turns a business brief into campaign positioning, platform-specific ad copy, creative concepts, image/video prompts, measurement ideas and claim-review notes.
2. **Media generation gateway** — keeps the existing Higgsfield image/video generation routes so a reviewed creative prompt can be rendered as an image or video.

CAP.AI does not train its own foundation image/video model. Text strategy is generated through the OpenAI Responses API; media rendering is handled by the configured Higgsfield models.

## Deploy on Render

The repository's `render.yaml` configures a Node web service with `api` as its root directory, `npm install` as the build command, and `npm start` as the start command. Use Node 20 or newer.

Set these secrets in the Render service's Environment panel:

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | For Ads strategy | Server-side API key for ad strategy and copy generation. |
| `CAP_ADS_ACCESS_TOKEN` | For Ads strategy | Long random private beta token protecting the new Ads endpoints. |
| `OPENAI_AD_MODEL` | Optional | Defaults to `gpt-4.1-mini`; set to a model enabled for your API account. |
| `DATABASE_URL` | Recommended | PostgreSQL connection string for persistent campaign workspaces. |
| `DATABASE_SSL` | Optional | Defaults to SSL enabled; set to `false` only for a trusted local database. |
| `HF_API_KEY` | For server-key media mode | Optional server-side Higgsfield key. Never use this shared-key mode on a public site without real user authentication and quotas. |
| `CAP_API_ACCESS_TOKEN` | With `HF_API_KEY` | Required private token when using the server-side Higgsfield key. |
| `CORS_ORIGINS` | Yes | Comma-separated exact origins for the frontend. |

Do not commit real API keys or tokens. Do not put `OPENAI_API_KEY`, `CAP_ADS_ACCESS_TOKEN`, `HF_API_KEY` or `CAP_API_ACCESS_TOKEN` into GitHub Pages HTML or browser JavaScript.

## Advertising API

The private beta requests use both headers:

- `X-CAP-Client-ID`: browser workspace identifier (16–100 letters, numbers, underscores or hyphens).
- `X-CAP-Ads-Token`: the private beta token configured as `CAP_ADS_ACCESS_TOKEN`.

### Check capabilities

`GET /api/ads/capabilities`

Returns whether the strategy engine is configured, whether PostgreSQL is configured, and which platforms are supported. It does not expose secrets.

### Create a campaign brief

`POST /api/ads/brief`

Example JSON body:

```json
{
  "businessName": "Northside Coffee",
  "businessType": "Coffee shop",
  "businessDescription": "Independent neighborhood cafe serving espresso and pastries.",
  "website": "https://example.com",
  "location": "Oakland, California",
  "productOrService": "Coffee, breakfast and pastries",
  "differentiator": "Locally owned neighborhood cafe",
  "offer": "No offer supplied",
  "campaignGoal": "Increase local awareness and in-store visits",
  "targetAudience": "People who live or work nearby",
  "budget": "$300 test budget",
  "tone": "Warm, modern and community-focused",
  "callToAction": "Visit us",
  "platforms": ["Instagram", "Facebook", "TikTok", "Google Search"]
}
```

The route creates a campaign containing:
- Campaign positioning, audience and core message.
- Two or three creative directions.
- Platform-ready Meta, TikTok, Google Search and LinkedIn copy.
- Image and video prompts that can be sent to the existing `POST /api/generate` media endpoint.
- Suggested KPIs and a small testing plan.
- Claims and details that a human should verify before publishing.

The endpoint is rate-limited to five requests per minute per IP. Campaign copy is a draft: review it for accuracy, platform rules and local advertising requirements before use.

### Campaign workspace

- `GET /api/ads/campaigns` — list up to 50 campaigns for this beta browser workspace.
- `GET /api/ads/campaigns/:id` — read a campaign.
- `PATCH /api/ads/campaigns/:id` — change `status` to `draft`, `approved` or `archived`, and/or save internal `notes`.
- `DELETE /api/ads/campaigns/:id` — delete a campaign.

When `DATABASE_URL` is configured, the API creates the `cap_ad_campaigns` table automatically and stores campaigns in PostgreSQL. Without it, campaign data uses temporary process memory and disappears when the server restarts. Use PostgreSQL before relying on saved work.

## Existing media generation API

- `GET /api/health` — basic service health.
- `POST /api/uploads/signed-url` — obtain provider-signed upload URLs for reference images/videos.
- `POST /api/generate` — submit image or video generation.
- `GET /api/jobs/:jobId` — poll job status and media URLs.
- `POST /api/jobs/:jobId/cancel` — request cancellation.

The media gateway retains its current Higgsfield model routing. Check the connected provider account for current model availability, supported parameters, credits and pricing.

## Important: private beta, not public SaaS yet

The Ads endpoints currently use a single private beta access token and a browser-generated workspace ID. That is suitable only for controlled testing. It is **not customer authentication** and does not securely identify paying businesses. Do not publish the beta token in the static website.

Before accepting public customers, add:
- Real user registration/login and server-verified account identity.
- Per-user campaign ownership, quotas, billing and provider spend limits.
- Persistent media/job queue storage and secure asset storage with retention/deletion controls.
- Campaign publishing integrations (Meta, Google, TikTok) with OAuth permissions and explicit user approval.
- Stronger abuse prevention, monitoring, secret-redacted logs, customer support and reviewed privacy/terms policies.

The current backend creates strategy, copy and creative direction; it does not place ad spend, launch live ads or guarantee campaign results.
