# CAP.AI

CAP.AI is an early-stage creative platform for turning ideas into prompts and AI-generated media. The website is hosted as a static GitHub Pages frontend. A separate Node API service connects it to a remote image/video generation provider.

## Website

- Home: https://davidguindo73-pixel.github.io/CAP.AI/
- Create AI: https://davidguindo73-pixel.github.io/CAP.AI/create.html
- Examples: https://davidguindo73-pixel.github.io/CAP.AI/examples.html
- Prompt Lab: https://davidguindo73-pixel.github.io/CAP.AI/studio.html

## Feature slice added

- Text-to-image generation through a campaign-image model.
- Text-to-video generation through a video model with duration, aspect ratio, resolution and audio options.
- Reference image/video upload using provider-signed uploads and supported image/video-guided generation.
- Product-ad image and product-ad video modes.
- Style direction, camera/motion guidance, aspect-ratio controls and avoid lists.
- Live job status polling, result previews and a cancel request.
- Server-side credential handling, origin allowlisting, request validation and basic rate limiting.

The real rendering is executed by a connected external model provider. **CAP.AI does not currently train or own a foundation image/video model.** Provider API access, supported models, output quality, availability and credits are controlled by that provider.

## Deploy the generation backend

The GitHub Pages workflow only deploys static files. It does not run Node server code.

1. Open the repository in Render and deploy from the included render.yaml blueprint (or create a Node web service with root directory api, build command npm install, start command npm start).
2. Wait for Render to provide the service URL.
3. Check that https://YOUR-SERVICE/api/health returns JSON with ok: true.
4. Visit the Create AI page, paste the backend service URL into **CAP.AI API base URL**, and choose a credential mode.
5. For the initial personal prototype, use the Bring Your Own Key (BYOK) flow: create a provider key at https://open.higgsfield.ai/api-keys and paste it into the password field when using Create AI. It stays in page memory only and is not saved by CAP.AI to browser storage.
6. If you instead configure a shared provider key on the server, also set a strong CAP_API_ACCESS_TOKEN backend environment variable. Never run a shared-key endpoint for a public audience without real authentication, quotas and abuse protection.

Detailed backend settings are in api/README.md; a safe template is in api/.env.example.

## Important launch limitations

This is not production SaaS yet. It does not include login, user accounts, persistent project cloud storage, billing/credits, multi-user quota enforcement, background queue persistence or a trained custom model. The API's prototype job ownership map is in memory and resets if the service restarts. Before a public launch, implement authenticated accounts, database-backed job ownership, secure file retention/deletion, spend limits, robust moderation, audit logs with secret redaction, monitoring and reviewed privacy/terms policies.

## Privacy and secrets

- Never commit an actual provider API key or shared CAP.AI access token.
- Never place provider credentials in HTML, JavaScript assets, GitHub Pages settings or public examples.
- Reference files are uploaded to the configured generation provider if you request generation with a reference.
- Read the provider terms and pricing before processing commercial or sensitive material.

## GitHub Pages

The workflow deploys the HTML pages and static assets. In Settings → Pages, choose GitHub Actions as the source, then check the latest deployment workflow.
