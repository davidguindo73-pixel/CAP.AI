# CAP.AI API

CAP.AI runs a Node 20+ Express API on Render. It currently groups four backend areas:

1. Customer accounts and business profiles.
2. Advertising account integrations, encrypted credential storage and reporting.
3. Campaign strategy, private-beta campaign workspaces and paused Meta/Google publishing.
4. Media generation through the configured Higgsfield gateway.

## Deployment

The Render service runs from this directory with `npm install` and `npm start`. The service health check is `GET /api/health`.

PostgreSQL is required for customer registration, sessions, business profiles, OAuth states, connected accounts, subscription state and publishing records. The schema is initialized on first use through `api/db.js`.

## Environment

See [PLATFORM_SETUP.md](./PLATFORM_SETUP.md) for exact provider callback URLs and configuration steps. The key-free template is [`.env.example`](./.env.example).

Core settings:
- `DATABASE_URL` — persistent Render PostgreSQL connection.
- `CAP_TOKEN_ENCRYPTION_KEY` — 32-byte AES-256 key (hex or base64) used to encrypt provider tokens at rest.
- `CAP_FRONTEND_URL` and `CORS_ORIGINS` — customer UI origin.
- `OPENAI_API_KEY` / `OPENAI_AD_MODEL` — campaign-strategy generation.
- `CAP_ADS_ACCESS_TOKEN` — optional owner-only private-beta fallback.
- Meta, Google Ads and TikTok app credentials and callback variables.
- Stripe secret, webhook secret and recurring Price IDs.
- Existing Higgsfield BYOK or server-key settings for image/video generation.

Never commit actual credentials, and never put provider keys into browser JavaScript.

## Customer API

Authentication uses a 12-hour server-side session. The browser sends the returned token as `Authorization: Bearer ...`. Session token hashes are stored in PostgreSQL; the raw token is returned only at login/register.

- `POST /api/auth/register` — create account (name, email, password; password minimum 12 characters).
- `POST /api/auth/login` — sign in.
- `GET /api/auth/me` — current authenticated user.
- `POST /api/auth/logout` — revoke current session.
- `GET /api/business-profile`, `PUT /api/business-profile` — per-customer profile.

## Advertising account integrations

- `GET /api/integrations` — connected platform list and configuration readiness.
- `GET /api/integrations/:platform/connect` — begin Meta, Google or TikTok authorization.
- `GET /api/integrations/:platform/callback` — OAuth/advertiser callback.
- `GET /api/integrations/:platform/accounts` — accessible account discovery.\n- `GET /api/integrations/meta/pages` — connected Facebook Pages and Page-level advertising task status.
- `DELETE /api/integrations/:platform` — remove locally stored connection.
- `GET /api/analytics/:platform?accountId=...` — last-30-day report.

Customer provider access/refresh tokens are stored encrypted using AES-256-GCM. The raw tokens are not returned to the client. If the encryption key is missing or invalid, the API refuses to store new provider credentials.

## Campaigns and publishing

The existing Ad Studio endpoints remain available:
- `GET /api/ads/capabilities`
- `POST /api/ads/brief`
- `GET /api/ads/campaigns`
- `GET /api/ads/campaigns/:id`
- `PATCH /api/ads/campaigns/:id`
- `DELETE /api/ads/campaigns/:id`

An authenticated customer owns an isolated campaign workspace. The private-beta token remains available as an owner-only fallback.

Publishing requires the campaign status to be `approved` in Ad Studio and a connected provider account:
- `POST /api/publish/meta/:campaignId` — create Meta campaign/ad set/creative/ad in PAUSED state. Requires account ID, Page ID, HTTPS image URL, HTTPS destination URL, country code and daily budget.
- `POST /api/publish/google/:campaignId` — create a Google Search budget, campaign, ad group, keywords and responsive search ad in PAUSED state. Requires customer ID, HTTPS destination URL, country code and daily budget in the account currency.
- `GET /api/publish/:campaignId` — list platform publications.
- `POST /api/publish/:platform/:publicationId/activate` — activate a paused Meta/Google campaign only when the user sets `confirmSpend: true` and supplies the exact saved `dailyBudgetConfirmed`.

All initial platform objects are created paused. The user must review the campaign inside the platform and explicitly activate it; activation can spend the customer's advertising budget. TikTok publishing is not enabled in this release.

## Billing

- `GET /api/billing/plans`
- `POST /api/billing/checkout`
- `POST /api/billing/portal`
- `GET /api/billing/status`
- `POST /api/billing/webhook`

Stripe Checkout and the customer portal remain unavailable until the owner configures secret keys, the webhook signing secret and the recurring Price IDs. The webhook validates the Stripe signature before updating subscription state.

## Media generation API

- `GET /api/health`
- `POST /api/uploads/signed-url`
- `POST /api/generate`
- `GET /api/jobs/:jobId`
- `POST /api/jobs/:jobId/cancel`

The media gateway currently keeps job ownership in process memory. A persistent queue, durable result metadata and secure asset retention/deletion are required before public production use.

## Production readiness

The system is a private-beta foundation and must not be represented as fully audited production SaaS yet. Email verification, password reset, account deletion/export, quotas and usage metering, customer billing enforcement, persistent media jobs, TikTok campaign publishing, idempotent publish reconciliation, test-account verification, monitoring, incident response and privacy/terms review remain to be completed. Complete provider app reviews and test every API path using dedicated sandbox/test ad accounts before enabling live customer traffic.
