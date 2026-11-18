# CAP.AI platform setup checklist

This guide configures the customer-account backend added to CAP.AI. Code and developer credentials are separate: Meta, Google, TikTok and Stripe each require the owner to create an app/account, provide credentials and complete any applicable reviews. Never commit credentials.

## Backend and encryption

The API is hosted at:

- API: https://cap-ai-generation-api.onrender.com
- Customer workspace: https://davidguindo73-pixel.github.io/CAP.AI/workspace.html
- OAuth callback base: https://cap-ai-generation-api.onrender.com/api/integrations/

In Render → cap-ai-generation-api → Environment, keep the existing DATABASE_URL and add:

- CAP_FRONTEND_URL = https://davidguindo73-pixel.github.io/CAP.AI
- CAP_TOKEN_ENCRYPTION_KEY = output of `openssl rand -hex 32`
- OPENAI_API_KEY = an OpenAI API key enabled for the configured model, for campaign strategy.
- CAP_ADS_ACCESS_TOKEN = retain the generated private-beta token for owner-only fallback access.

CAP_TOKEN_ENCRYPTION_KEY is the application-level AES-256-GCM key for customer advertising credentials. Save a secure backup outside GitHub. If it is lost, the existing encrypted provider tokens cannot be decrypted. Do not rotate it without a migration that re-encrypts saved tokens.

The customer database schema is created automatically on first use. PostgreSQL is required for registration, login, customer sessions, business profiles, connected accounts and billing. Do not rely on the temporary in-memory campaign store for customers.

## CAP.AI Image Generator

The Create AI page defaults to image generation through OpenAI's GPT Image API. In Render, configure `OPENAI_API_KEY` with an API key from a project that has access to GPT Image models. CAP.AI uses `gpt-image-2.5-flare` as the fast default and `gpt-image-2.5-sunburst` for more detail. The app sends image requests from the backend, keeps the key server-side, and returns the generated image to the signed-in or private-beta user. OpenAI may require organization verification before GPT Image models are available. The Create AI page uses the deployed Render API URL automatically.

The private-beta image route accepts a valid CAP.AI customer session or a configured beta/server access token. Keep the generated Render token private. Image requests are rate-limited to 12 per hour per IP in this preview; usage costs are billed to the OpenAI API project attached to `OPENAI_API_KEY`.

## Customer authentication and business profiles

Open the Customer Workspace, create an account with a password of at least 12 characters, then save the business profile. Authenticated campaign requests use a short-lived session token held in the current browser tab's session storage; users must sign in again after the tab session ends. Password reset, email verification and account deletion workflows still need to be added before a public launch.

## Meta · Facebook and Instagram

Create a Meta developer app and configure Facebook Login / Marketing API access. Add this exact Valid OAuth Redirect URI:

`https://cap-ai-generation-api.onrender.com/api/integrations/meta/callback`

Set these Render variables:

- META_APP_ID
- META_APP_SECRET
- META_REDIRECT_URI (the exact callback above)
- META_GRAPH_API_VERSION = v27.0 (or another version currently supported by your app)
- META_OAUTH_SCOPES = ads_read,ads_management,business_management,pages_show_list,pages_read_engagement,pages_manage_ads

Request only the permissions needed for the product and complete Meta App Review / Marketing API access requirements. The account owner must grant CAP.AI access to the relevant ad account and Facebook Page, including the Page's ADVERTISE task. The Workspace includes Page discovery and validates that task before publishing.

Once connected, CAP.AI can list accessible Meta ad accounts and request last-30-day campaign insights. For publishing, the campaign must be marked approved in Ad Studio. The paused-campaign builder also requires an ad account ID, Facebook Page ID, public HTTPS image URL, landing page URL, country code and daily budget. It creates the campaign, ad set, creative and ad in PAUSED state. Nothing spends until the user explicitly activates it and re-enters the exact daily budget.

## Google Ads

Create a Google Cloud OAuth web application and enable the Google Ads API for its project. Add this exact authorized redirect URI:

`https://cap-ai-generation-api.onrender.com/api/integrations/google/callback`

Set:

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI (the exact callback above)
- GOOGLE_ADS_DEVELOPER_TOKEN
- GOOGLE_ADS_API_VERSION = v26
- GOOGLE_ADS_LOGIN_CUSTOMER_ID only when the connected customer is accessed through a manager account.

The OAuth flow requests offline access to the Google Ads scope so the backend can refresh access tokens. Google Ads API requests also require the developer token and may be subject to API access-level restrictions and review. Connect a Google account that can access the customer accounts to manage.

For publishing, approve the campaign first. Supply the accessible 10-digit customer ID, public HTTPS landing page, country code and daily budget in that account's currency. CAP.AI resolves the actual account currency and adds the country as a campaign location target. CAP.AI creates the budget, Search campaign, ad group, keywords and responsive search ad in PAUSED state. To enable it, the user must separately confirm the exact daily budget. Review the finished campaign in Google Ads before enabling spend.

## TikTok For Business

Create and submit a TikTok For Business developer app for the Marketing API. Add this exact callback URL to the app:

`https://cap-ai-generation-api.onrender.com/api/integrations/tiktok/callback`

Set:

- TIKTOK_APP_ID
- TIKTOK_APP_SECRET
- TIKTOK_REDIRECT_URI (the exact callback above)
- TIKTOK_ADVERTISER_AUTH_URL (the advertiser authorization URL generated in the TikTok Business API app portal)
- TIKTOK_API_VERSION = v2.0

TikTok Marketing API authorization is advertiser-specific. The app must request the necessary scopes and pass TikTok's review. Connect an advertiser account that has granted access to the CAP.AI developer app. The current backend stores the authorization securely and exposes the approved advertiser IDs. Reporting is wired to the reporting endpoint when the app has reporting permission.

TikTok campaign publishing is not enabled in this release. Do not assume that a TikTok OAuth connection means CAP.AI can create or launch TikTok ads yet.

## Stripe subscriptions

Create Stripe products and recurring Prices in test mode first. Set:

- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- STRIPE_PRICE_ID_STARTER
- STRIPE_PRICE_ID_PRO

Register this webhook endpoint:

`https://cap-ai-generation-api.onrender.com/api/billing/webhook`

Subscribe it to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. The Workspace checkout and billing-portal buttons remain disabled by the API until the matching credentials and price IDs are configured. Test the complete subscription lifecycle before switching from Stripe test keys to live keys.

## API routes delivered

- POST /api/auth/register and POST /api/auth/login — create customer sessions.
- GET /api/auth/me and POST /api/auth/logout — inspect and revoke the current session.
- GET /api/business-profile and PUT /api/business-profile — per-customer brand profile.
- GET /api/integrations — connection state without returning credentials.
- GET /api/integrations/:platform/connect and callback — OAuth / advertiser authorization.
- GET /api/integrations/:platform/accounts and DELETE /api/integrations/:platform — account discovery and local disconnect.
- GET /api/analytics/:platform?accountId=... — last-30-day platform reporting.
- GET /api/billing/plans, POST /api/billing/checkout, POST /api/billing/portal, GET /api/billing/status, POST /api/billing/webhook.
- POST /api/publish/meta/:campaignId and POST /api/publish/google/:campaignId — create paused campaigns from approved Ad Studio drafts.
- POST /api/publish/:platform/:publicationId/activate — activate a paused Meta/Google campaign only after explicit spend confirmation.
- GET /api/publish/:campaignId — list platform publications for an owned campaign.

## Before public launch

This is a substantial private-beta foundation, not yet a fully audited public SaaS. Complete email verification, password reset, account deletion/export, customer support and privacy/terms review; add production monitoring and security testing; verify provider app review and all API request schemas against test ad accounts; add TikTok campaign creation; add persistent media-job/asset storage and retention controls; add quotas and usage metering; and add idempotent publishing, rollback/reconciliation and full end-to-end tests. New ads are intentionally created paused; CAP.AI should never activate a budget without a separate, explicit customer confirmation.
