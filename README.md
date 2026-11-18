# CAP.AI

**Creator:** David Guindo — Creator & Builder; Computer Engineering Student.

CAP.AI is an AI advertising and creative workspace. A business can save its brand profile, create campaign strategy and copy, generate image/video creative through the connected media provider, connect advertising accounts, review reporting and manage a CAP.AI subscription.

## Live preview

- Home: https://davidguindo73-pixel.github.io/CAP.AI/
- Customer Workspace: https://davidguindo73-pixel.github.io/CAP.AI/workspace.html
- Advertising Studio: https://davidguindo73-pixel.github.io/CAP.AI/ads.html
- Create AI: https://davidguindo73-pixel.github.io/CAP.AI/create.html
- Examples: https://davidguindo73-pixel.github.io/CAP.AI/examples.html

## Current product capabilities

- Customer account registration, login and logout using server-side session records.
- Separate business profiles for each authenticated customer.
- Encrypted-at-rest provider tokens using AES-256-GCM.
- OAuth / advertiser authorization flows for Meta, Google Ads and TikTok For Business.
- Account discovery and last-30-day reporting endpoints for connected ad accounts.
- AI campaign strategy, creative concepts and platform copy from a business brief.
- Campaign draft storage in PostgreSQL, with an owner-only private beta fallback.
- Paused campaign creation for Meta and Google Search from approved campaign drafts.
- A second explicit confirmation is required to activate a paused Meta/Google campaign and begin ad spend.
- Stripe Checkout, customer billing portal and subscription webhook foundation.
- Existing Higgsfield image/video generation gateway.

Media generation is performed by the configured external provider; CAP.AI does not train or own its own foundation image/video models.

## Backend

Render web service: https://cap-ai-generation-api.onrender.com

The API runs from the `api` directory with Node 20 or newer. The included Render Blueprint configures the web service and PostgreSQL reference. The customer account and integration features require a live PostgreSQL `DATABASE_URL`.

Detailed owner configuration and platform callback steps are in [api/PLATFORM_SETUP.md](api/PLATFORM_SETUP.md). API route descriptions are in [api/README.md](api/README.md). A key-free environment template is in [api/.env.example](api/.env.example).

## Important setup still required

The source code does not include business platform app credentials. Before a customer can connect Meta, Google or TikTok, the owner must create the corresponding developer apps, add the exact OAuth callback URLs, configure secrets in Render, and complete each platform's required permissions and app review. Secure token storage also requires a persistent `CAP_TOKEN_ENCRYPTION_KEY`.

Campaign strategy requires `OPENAI_API_KEY`. Stripe subscriptions require Stripe secret/webhook keys and configured recurring Price IDs. Google Ads API access also requires its developer token. These settings are intentionally not committed to the repository.

## Launch limitations

This is a private-beta implementation, not yet a fully audited public SaaS. The account foundation does not yet include email verification, password reset, account deletion/export, or full compliance workflows. TikTok OAuth and reporting are implemented, but TikTok campaign publishing is not enabled. Meta and Google publishing creates campaigns, ad groups and ads in PAUSED state; activation is a separate explicit action and requires test-account validation. Media-generation jobs still use in-process ownership state and need a persistent queue/object-storage layer before public scale.

Before charging public customers, run full integration tests in provider test/sandbox accounts, complete platform app reviews, configure monitoring and security alerting, implement spend/usage quotas, verify legal/privacy policies, and perform a security review of the whole system.

## Privacy and secrets

- Never commit actual API keys, OAuth secrets, Stripe secrets or access tokens.
- Never put provider credentials in HTML, JavaScript assets, GitHub Pages settings or browser storage.
- Customer OAuth access and refresh tokens are encrypted before being stored in PostgreSQL.
- The token encryption key must be kept as a Render secret and backed up securely.
- Reference images/videos are uploaded to the connected media provider when the customer requests generation.
