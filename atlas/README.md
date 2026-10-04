# Global Disruption Atlas — v4.1.0

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
3. **Sea-lane routing.** `engine/seagraph.js` — 173 sea waypoints, 97 UN/LOCODE ports, 18
   PortWatch-mapped chokepoints, Dijkstra routing; `tests/landcheck.js` proves no lane crosses land. Distances are within ~6% of published figures;
   closing Bab-el-Mandeb sends Asia–Europe round the Cape by itself (+~10 days).
4. **Re-planning.** `engine/model.js` solves the weekly network as a min-cost flow
   (`engine/flow.js`, shared with the Network Stress Test app): production, inland legs, ocean rate,
   disruption surcharge, carrying cost, and a lost-sale cost on unmet demand.
5. **Time-phased simulation (v3).** `engine/dynamics.js` simulates every day: event ramps and
   recovery, freight rates that spike and decay, planners reacting about a week late (and waiting out
   short events), ships diverting mid-voyage or queueing at closed canals, port backlogs, pipeline
   overlap when routes lengthen, and stock rebuilding. Reports time-to-survive vs time-to-recover per
   DC, service over time, backlogs and the measured recovery day.
6. **Product families (v3.1).** Four families in the sample (smartphones, PCs, components,
   appliances), each with its own value, lost-sale cost, fill-rate target and air eligibility; scarce
   capacity goes to the most valuable families first; per-family stock and service results;
   safety stock for all families or critical ones only.
7. **Optimising flexibility (v4).** `engine/optimise.js` searches over lever *amounts* (stock days
   per family, contract coverage, standby capacity, air capacity, gateway allotment, control tower)
   to minimise annual option cost + expected loss, optionally weighting the worst 10% of years
   (CVaR 90%); draws the cost–risk frontier; one click applies the recommendation.
8. **Correlated and emerging risk (v4.1).** `engine/likelihood.js` turns PortWatch disruption episodes
   into data-informed likelihoods (Poisson–Gamma, 80% ranges); shared drivers (geopolitics, El Niño,
   labour contracts, pandemics) cluster related events; climate scenarios scale weather risk.
   `engine/worstcase.js` simulates every event and every pair and ranks the worst for your network.
9. **Risk and flexibility.** Monte Carlo over durations and rate shocks; all 64 combinations of six
   levers (safety stock, second source, air bridge, multi-gateway contracts, fixed-rate contracts,
   early-warning control tower)
   ranked by expected annual loss + annual option cost.
10. **Your network.** Two CSVs (nodes, lanes), parsed in the browser. Templates and a demo in the app.
11. **Tutorial.** Beginner, Medium, Advanced and Pro levels, each step self-checking.
12. **Checked against history.** `engine/validation.js` recomputes 11 checks of the model against the
   PortWatch record and cited figures on every data refresh (shown in the app).

## Run and test

Static site — open `index.html` via any local server (e.g. `python -m http.server`) or GitHub Pages.

```
node --test atlas/tests/*.test.js        # unit tests (53): engine, dynamics, product families, optimiser, likelihood, worst cases, sea graph + land check, CSV, alerts, validation
node atlas/tests/smoke.mjs               # browser smoke test (needs puppeteer; run by CI)
node atlas/scripts/fetch-signals.mjs     # refresh the live-data snapshot by hand
```

## Honesty notes

The sample company is fictional (real ports and lanes, round numbers). Historical events are real;
their effect sizes are calibrated assumptions shown on each event card. See the in-app
"Method, assumptions & limits" section.

## Versions

- **4.1.0** (Oct 2026) — data-informed likelihoods, correlated events via shared drivers, climate
  scenarios, worst-case search over singles and pairs; 11 history checks.
- **4.0.0** (Oct 2026) — levers become amounts with scaled costs; two-stage stochastic optimiser
  (option cost + expected loss + optional CVaR 90% weight); cost–risk frontier; apply to scenario.
- **3.1.0** (Oct 2026) — product families with values, lost-sale costs and fill-rate targets;
  priority allocation; per-family stock, air eligibility and service; critical-only stock; fixes for
  shortfalls merging across DCs and overstated port surge capacity.
- **3.0.0** (Oct 2026) — time-phased simulation replaces the single-snapshot model: ramps,
  rate decay, reaction lag, diversions, canal/port queues (calibrated to the Ever Given and the 2024
  strike), stock rebuilding; service and backlog charts; control-tower lever; 10 history checks.
- **2.2.0** (Oct 2026) — 97-port library on a 173-waypoint graph with an automated land-crossing test
  (found and fixed 9 coastal shortcuts); live container port calls for every library port; port-level
  live conditions and a "Your ports" monitor; hazard alerts near the network become one-click
  scenarios (`engine/alerts.js`); Baltimore 2024 event + history check (8 checks).
- **2.1.0** (Oct 2026) — validation against history (Panama drought recalibrated 60% → 90% container
  capacity), stale-data warning, light theme, chart table views + keyboard reading, phone KPI layout,
  CSV import as a tested module, browser smoke test in CI, no timestamp-only data commits.
- **2.0.0** (Oct 2026) — rebuilt as a decision lab (everything above).
- **1.x** — illustrative globe with scripted scenario overlays and a simulated signal feed.
