# CAP.AI

**Creator:** David Guindo — Creator & Builder; Computer Engineering Student.

CAP.AI is designed around the idea that creative workflows should feel accessible: clear prompts, reference guidance, and advertising briefs in one workspace. Its visual identity uses a restrained black, white, charcoal and silver palette.

CAP.AI is an early-stage creative platform for turning ideas into prompts and AI-generated media. The website is hosted as a static GitHub Pages frontend. A separate Node API service connects it to a remote image/video generation provider.

## Website

- Home: https://davidguindo73-pixel.github.io/CAP.AI/
- Create AI: https://davidguindo73-pixel.github.io/CAP.AI/create.html
- Examples: https://davidguindo73-pixel.github.io/CAP.AI/examples.html
- Prompt Lab: https://davidguindo73-pixel.github.io/CAP.AI/studio.html

## Feature slice added

- AI advertising strategy from a business brief: positioning, target audience, campaign concepts, ad copy for Meta/TikTok/Google Search/LinkedIn, image/video creative prompts, KPIs and claim-review notes.\n- Campaign workspace API with draft/approved/archived states and optional PostgreSQL persistence.\n- Text-to-image generation through a campaign-image model.
- Text-to-video generation with Seedance 2.0, Kling 3.0 Standard/Pro/4K, and Kling 3.0 Turbo options, including duration, aspect ratio, resolution, audio and multi-shot settings.
- Reference image/video upload using provider-signed uploads; Wan 3.0 and Kling 3.0 image-to-video; Kling O3 video edits for an uploaded clip.
- Product-ad image and product-ad video modes with structured product name, audience, key benefit, offer, CTA, placement and brand-tone fields.
- Style direction, camera/motion guidance, aspect-ratio controls and avoid lists.
- Live job status polling, result previews and a cancel request.
- Server-side credential handling, origin allowlisting, request validation and basic rate limiting.

The real rendering is executed by a connected external model provider. **CAP.AI does not currently train or own a foundation image/video model.** Provider API access, supported models, output quality, availability and credits are controlled by that provider.

## Deploy the generation backend

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/davidguindo73-pixel/CAP.AI)

This Blueprint creates the separate Node API service. Render will ask you to review and approve the deployment.

The GitHub Pages workflow only deploys static files. It does not run Node server code.

1. Open the repository in Render and deploy from the included render.yaml blueprint (or create a Node web service with root directory api, build command npm install, start command npm start).
2. Wait for Render to provide the service URL.
3. Check that https://YOUR-SERVICE/api/health returns JSON with ok: true.
4. Visit the Create AI page, paste the backend service URL into **CAP.AI API base URL**, and choose a credential mode.
5. For the initial personal prototype, use the Bring Your Own Key (BYOK) flow: create a provider key at https://open.higgsfield.ai/api-keys and paste it into the password field when using Create AI. It stays in page memory only and is not saved by CAP.AI to browser storage.
6. If you instead configure a shared provider key on the server, also set a strong CAP_API_ACCESS_TOKEN backend environment variable. Never run a shared-key endpoint for a public audience without real authentication, quotas and abuse protection.

For AI advertising strategy, add OPENAI_API_KEY and a separate CAP_ADS_ACCESS_TOKEN in Render. Add DATABASE_URL for persistent campaign records. The Ads API is gated for private beta testing and is not yet connected to public customer login. Detailed endpoint and deployment settings are in api/README.md; a safe template is in api/.env.example.

## Important launch limitations

This is not production SaaS yet. The advertising strategy and campaign endpoints are private-beta features protected by a shared token plus a browser workspace ID, not customer login. Campaign records use PostgreSQL only when DATABASE_URL is configured; otherwise they are temporary memory. Media-generation job ownership is still in memory and resets if the service restarts. Before a public launch, implement real user authentication, per-account ownership, billing/credits, quota and provider spend enforcement, persistent job queues, secure file retention/deletion, stronger moderation, secret-redacted audit logs, monitoring and reviewed privacy/terms policies.

## Privacy and secrets

- Never commit an actual provider API key or shared CAP.AI access token.
- Never place provider credentials in HTML, JavaScript assets, GitHub Pages settings or public examples.
- Reference files are uploaded to the configured generation provider if you request generation with a reference.
- Read the provider terms and pricing before processing commercial or sensitive material.

## GitHub Pages

The workflow deploys the HTML pages and static assets. In Settings → Pages, choose GitHub Actions as the source, then check the latest deployment workflow.
