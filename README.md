# Estay Dynamics — website

Static site, no build step, no serverless functions. 5 pages: `index.html`, `services.html`, `case-studies.html`, `about.html`, `contact.html`, sharing `styles.css` and `script.js`.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo (see repo setup below if not done yet).
2. On GitHub: repo → Settings → Pages → Build and deployment → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)`.
3. GitHub publishes at `https://<username>.github.io/<repo>/` within a minute or two. Add a custom domain under Settings → Pages → Custom domain once you have one.

Since the site is served from a subpath by default (not a custom domain), double-check internal links stay relative (`atlas/index.html`, not `/atlas/index.html`) — they already are.

## Global Disruption Atlas

Live at `/atlas/` — the interactive globe tool now ships as part of this site, fully self-contained (globe.gl vendored, no CDN, no build step). It's linked from the main nav and featured on the homepage. If you update the underlying tool later, just replace the files under `atlas/` — nothing else needs to change.

## Before you actually launch

- `about.html`: I deliberately did **not** name your current employer anywhere on this site — review that paragraph and decide if you want to reference your current role at all, given you're pursuing an internal Director track. Safer to leave it out or keep it generic, but it's your call.
- `case-studies.html`: these three cases are illustrative composites I wrote from your background (mining, beverage distribution, independent research) — not real disclosed engagements. Read them carefully before publishing; rewrite anything that reads as too specific or that you can't stand behind if a prospect asks follow-up questions.
- Fonts load from Google Fonts CDN — fine for GitHub Pages, no action needed.
- No analytics wired up. Add Plausible, GoatCounter, or similar later if you want traffic data.
- The DDRA page (`ddra/`) previously had an optional Gemini-backed Q&A widget (`api/chat.js`, a Vercel Edge Function); it's been removed since GitHub Pages can't run serverless functions. The interactive sliders/charts on that page are pure client-side JS and are unaffected.
