# Global Disruption Atlas — v2.0.0

**A disruption decision lab: real chokepoint data in, an optimised and costed response out.**
By [kathuman](https://github.com/kathuman) · part of [Estay Dynamics](../index.html) · companion to
*Engineering Flexibility in Supply Chain Design*.

Live: <https://kathuman.github.io/estay-dynamics/atlas/>

## What it does

1. **Live conditions.** A daily GitHub Action (`.github/workflows/atlas-signals.yml`) fetches
   container-ship transits for 14 chokepoints from IMF PortWatch, orange/red alerts from GDACS and
   M6+ earthquakes from USGS into `data/signals.js`. A chokepoint below 35% of its 2019–Oct 2023
   container traffic is treated as avoided; 35–85% as squeezed.
2. **Scenarios.** Live conditions, 9 dated historical events (with sources) and 4 labelled
   hypothetical stress tests. Combine any of them, or layer them on top of today's live state.
3. **Sea-lane routing.** `engine/seagraph.js` — 87 sea waypoints (119 lanes), 30 UN/LOCODE ports, 14
   PortWatch-mapped chokepoints, Dijkstra routing. Distances are within ~6% of published figures;
   closing Bab-el-Mandeb sends Asia–Europe round the Cape by itself (+~10 days).
4. **Re-planning.** `engine/model.js` solves the weekly network as a min-cost flow
   (`engine/flow.js`, shared with the Network Stress Test app): production, inland legs, ocean rate,
   disruption surcharge, carrying cost, and a lost-sale cost on unmet demand.
5. **Time-to-survive vs time-to-recover.** A day-by-day inventory simulation per DC.
6. **Risk and flexibility.** Monte Carlo over durations and rate shocks; all 32 combinations of five
   levers (safety stock, second source, air bridge, multi-gateway contracts, fixed-rate contracts)
   ranked by expected annual loss + annual option cost.
7. **Your network.** Two CSVs (nodes, lanes), parsed in the browser. Templates and a demo in the app.
8. **Tutorial.** Beginner, Medium, Advanced and Pro levels, each step self-checking.

## Run and test

Static site — open `index.html` via any local server (e.g. `python -m http.server`) or GitHub Pages.

```
node --test atlas/tests/*.test.js        # engine unit tests (13)
node atlas/scripts/fetch-signals.mjs     # refresh the live-data snapshot by hand
```

## Honesty notes

The sample company is fictional (real ports and lanes, round numbers). Historical events are real;
their effect sizes are calibrated assumptions shown on each event card. See the in-app
"Method, assumptions & limits" section.

## Versions

- **2.0.0** (Oct 2026) — rebuilt as a decision lab (everything above).
- **1.x** — illustrative globe with scripted scenario overlays and a simulated signal feed.
