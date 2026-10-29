# Estay Dynamics — website

Static site, no build step, no serverless functions. Pages: `index.html` (problems, approach, offers, tools), `problems.html`, `services.html` (the three offers), `expertise/` (five areas), `technical-depth.html` (validation, methods, research, all tools), `lab.html` (experiments, including engineering simulation), `case-studies.html` (field notes), `about.html`, `contact.html`, sharing `styles.css` and `script.js`. Tool screenshots are in `assets/tools/`.

## Theme and images

Theme: Copper & Slate (tokens at the top of `styles.css`; old token names such as `--amber` and `--cyan` now hold the copper accents, so existing markup keeps working). Fonts: Instrument Serif, Inter, IBM Plex Mono.

- `assets/illustrations/`: SVG illustrations for the five problems, the offers and the field notes.
- `assets/tools/`: screenshots of the tools and Lab projects. Retake one if its tool changes visibly.
- Every page shares the same nav and footer, written into each file. If you change them, change every page; the active nav item comes from `<body data-section="…">`.
- `sitemap.xml`, `robots.txt` and `404.html` live at the root. Absolute URLs assume `https://kathuman.github.io/estay-dynamics/`; update them if you add a custom domain.

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
