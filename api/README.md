# CAP.AI Generation API (prototype)

This is the server-side generation gateway for the CAP.AI static frontend. It calls the documented Higgsfield API for **text-to-image**, **text-to-video**, **image/video reference-to-video**, **product-ad image/video**, **Kling 3.0 Standard/Pro/4K multi-shot video**, **Kling 3.0 Turbo video**, **Kling image-to-video**, and **Kling O3 video edits**. It is not a locally trained foundation model; media is rendered by the selected provider model and returned to CAP.AI.

## Deploy this backend

1. Create a private API key at [Higgsfield API keys](https://open.higgsfield.ai/api-keys) and check current model access, pricing and account credits.
2. Deploy this folder as a **Node web service** (for example, on Render). Set the service root directory to `api`, build command to `npm install`, and start command to `npm start`. Use Node 20 or newer.
3. Add environment variables from `.env.example`. Set `CORS_ORIGINS` to your exact website origin(s). Do not put a real provider key in this repository.
4. Choose a credential mode:
   - **Bring your own key (default):** leave `HF_API_KEY` and `CAP_API_ACCESS_TOKEN` unset. Each person enters their own provider key into the Create AI page for that browser session; CAP.AI does not save it in localStorage. The key is sent only over HTTPS to your API and is not logged or persisted by this server.
   - **Single-owner preview:** set `HF_API_KEY` and a long random `CAP_API_ACCESS_TOKEN` on the server. The private app token must be entered in Studio when generating. Do not publish it or use this shared-key mode for a public website.
5. Set the API base URL in the CAP.AI Create AI page to the deployed service origin, for example `https://your-service.onrender.com` (no trailing `/api` path).
6. Check `GET /api/health` returns `ok: true`.

## Included routes

- `GET /api/health` — readiness and credential-mode check.
- `POST /api/uploads/signed-url` — get provider-signed uploads for reference images/videos.
- `POST /api/generate` — start an image/video generation job. Current routing selects Marketing Studio Image for images; Seedance 2.0, Kling 3.0 Standard/Pro/4K or Kling 3.0 Turbo for text-to-video; Wan 3.0 or Kling 3.0 for image-to-video; Wan 3.0 for reference-guided video workflows; and Kling O3 video-edit for reference video editing. Model account access and accepted parameters must be verified on the provider account.
- `GET /api/jobs/:jobId` — poll job state and receive generated media URLs.
- `POST /api/jobs/:jobId/cancel` — ask the provider to cancel a queued job.

The frontend supplies `X-CAP-Client-ID` plus either `X-HF-API-Key` (BYOK mode) or `X-CAP-Access-Token` (single-owner preview mode). The Create AI interface lets the user choose Seedance 2.0 or Kling 3.0 for text-to-video; choosing multi-shot automatically selects Kling. Reference video editing is sent to Kling O3. Do not log these request headers.

## Current limitations

This is a first integration slice, not a production SaaS deployment. Jobs are kept in memory for up to 24 hours and reset on server restarts. Before public launch, add authenticated accounts, persistent database/job ownership, quota and billing enforcement, provider spend caps, abuse prevention, asset storage/retention rules, user deletion/export, observability with secret redaction, and a stronger moderation/reporting process. Never accept a shared provider key in an unauthenticated public service.
