# CAP.AI

CAP.AI is an early frontend preview for an AI creative studio concept.

## Pages
- `index.html`: homepage and showcase.
- `studio.html`: seven prompt workflows, local reference preview, copy/download and browser-local saved drafts.
- `account.html`: local profile only; not secure authentication.
- `about.html`, `blog.html`, `changelog.html`, `contact.html`, `press-kit.html`.
- `privacy.html`, `terms.html`, `safety.html`, `ethics.html`: interim policy pages; legal copy needs professional review.
- `assets/site.css`, `assets/site.js`, `assets/cap-ai-mark.svg`, `assets/cap-ai-wordmark.svg`.
- `archive/Codes-original.html`: preserved original landing draft.

## Implemented in preview
Responsive homepage, showcase selectors, workflow-based prompt builder, local media preview, copy/download prompt text, local saved drafts, browser-local profile, information pages, and a contact form that opens a prefilled issue draft.

## Not yet built
Actual AI media generation/editing, secure authentication/recovery, cloud project sync, payments/credits, production upload handling, automated moderation and private support. Policy pages are interim drafts.

## Data note
Profile and prompt drafts are saved to local storage. Reference files are previewed locally and are not sent by this static preview. Do not store sensitive information.

## GitHub Pages
Use **Settings → Pages → Source: GitHub Actions** and verify the workflow succeeds. API keys must stay server-side, never in browser code.
