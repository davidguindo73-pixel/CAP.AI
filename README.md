# CAP.AI

CAP.AI is an early frontend preview for an AI creative studio concept.

## What is in this repository

- `index.html` — the homepage and interactive Prompt Lab.
- `.github/workflows/pages.yml` — publishes the homepage to GitHub Pages when `main` changes or the workflow is started manually.
- `.nojekyll` — static-site marker.
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

## GitHub Pages setup

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Save the setting if GitHub shows a Save button.
4. Open the **Actions** tab and confirm **Deploy CAP.AI preview to GitHub Pages** completes successfully.

The workflow publishes only `index.html` and `.nojekyll` from the repository root, so archived source files and documentation are not exposed as part of the live site.
