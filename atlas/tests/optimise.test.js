// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const O = require("../engine/optimise.js");
const M = require("../engine/model.js");
const D = require("../data.js");
// a smaller library keeps the search quick: a long crisis, a strike, a typhoon
const small = Object.assign({}, D, { events: D.events.filter(e => ["redsea-2023", "ila-2024", "saola-2023"].includes(e.id)) });

test("optimise: lever amounts — 'on' equals the default amount; cost scales linearly", () => {
  const p = M.params(D), net = D.network;
  const on = M.leverAnnualCost(D, net, { rateHedge: true, airBridge: true, dualSource: true, gateways: true }, p).total;
  const amt = M.leverAnnualCost(D, net, { hedgeCoverage: 0.7, airCapPerDc: 120, dualSourceCap: 250, gatewayBoost: 0.6 }, p).total;
  const half = M.leverAnnualCost(D, net, { hedgeCoverage: 0.35, airCapPerDc: 60, dualSourceCap: 125, gatewayBoost: 0.3 }, p).total;
  assert.ok(Math.abs(on - amt) < 1e-6);
  assert.ok(Math.abs(half - amt / 2) < 1e-6);
});

test("optimise: risk measure — deterministic, CVaR90 ≥ expected loss, exact for a certain loss", () => {
  const t = [{ p: 0.3, losses: [10, 20, 30] }, { p: 0.05, losses: [500] }];
  const a = O.riskOf(t, 2000, 7), b = O.riskOf(t, 2000, 7);
  assert.equal(a.cvar90, b.cvar90);
  assert.ok(Math.abs(a.eal - (0.3 * 20 + 0.05 * 500)) < 1e-9);
  assert.ok(a.cvar90 >= a.eal);
  const sure = O.riskOf([{ p: 1, losses: [42] }], 500, 1);
  assert.equal(sure.eal, 42); assert.equal(sure.cvar90, 42);
});

test("optimise: the search never ends worse than holding nothing, and the frontier is efficient", () => {
  const r = O.optimise(small, D.network, {}, { lambda: 0, strata: 2, years: 1000 });
  assert.ok(r.best.objective <= r.none.objective + 1e-6);
  const fr = O.frontier(r.points);
  for (let i = 1; i < fr.length; i++) { assert.ok(fr[i].premium >= fr[i - 1].premium); assert.ok(fr[i].cvar90 < fr[i - 1].cvar90); }
});

test("optimise: weighting the tail buys at least as much protection against bad years", () => {
  const neutral = O.optimise(small, D.network, {}, { lambda: 0, strata: 2, years: 1000 });
  const averse = O.optimise(small, D.network, {}, { lambda: 0.6, strata: 2, years: 1000 });
  assert.ok(averse.best.cvar90 <= neutral.best.cvar90 + 1e-6);
  assert.ok(averse.best.premium >= neutral.best.premium - 1e-6);
});
