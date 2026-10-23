# CAP.AI

CAP.AI is an early frontend preview for an AI creative studio concept.

## What is in this repository

- `index.html` — the public-facing homepage and interactive Prompt Lab.
- `.nojekyll` — tells GitHub Pages not to run Jekyll processing on the static site.
- `archive/Codes-original.html` — preserved copy of the original single-file draft.
- `LICENSE` — repository license.

## What works in this preview

- Responsive landing-page layout with navigation, showcase style selectors, roadmap, and FAQ.
- Prompt Lab: enter an idea, choose image or video, choose a visual style, build a structured prompt, and copy it.
- Internal section links and smooth scrolling.

## What is not connected yet

This preview does **not** generate images or videos. It does not yet include image uploads/editing, user accounts, a database, subscriptions, payment processing, or production AI model APIs. The showcase tiles are design mockups, not generated results. Items marked planned/coming soon are not functional features.

## Run locally

Open `index.html` in a browser. The page loads Tailwind CSS and fonts from external CDNs, so those visual styles need an internet connection.

## GitHub Pages

The static homepage file is placed in the repository root. To publish it, open **Settings → Pages** and configure the source as `main` / `/(root)` under **Deploy from a branch**, or use the repository's configured Pages deployment method. Confirm the latest Pages deployment has succeeded before treating the website as live.
