// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Lk = require("../engine/likelihood.js");
const O = require("../engine/optimise.js");
const W = require("../engine/worstcase.js");
const D = require("../data.js");
const S = require("../data/signals.js");

test("likelihood: episode detection — threshold, minimum length, merging, sudden drops", () => {
  const s = [0.9, 0.9, 0.2, 0.3, 0.9, 0.2, 0.2, 0.9, 0.9, 0.9, 0.9, 0.9, 0.1, 0.9].map((r, i) => ["w" + i, r]);
  assert.equal(Lk.episodes(s, 0.35, 2, 0).length, 2, "two runs of 2+ weeks");
  assert.equal(Lk.episodes(s, 0.35, 2, 1).length, 1, "merged across a one-week recovery");
  assert.equal(Lk.episodes(s, 0.35, 1, 0, { maxWeeks: 1, fromNormal: true }).length, 1, "only the isolated one-week drop from normal");
});

test("likelihood: Poisson–Gamma update — no episodes lowers, episodes raise, interval brackets", () => {
  const none = Lk.posterior(0.1, 0, 8, 5), some = Lk.posterior(0.1, 3, 8, 5);
  assert.ok(none.p < 0.1 && some.p > 0.1);
  assert.ok(none.lo <= none.p && none.p <= none.hi);
  const same = Lk.posterior(0.1, 0, 0, 5);
  assert.ok(Math.abs(same.p - 0.1) < 1e-9, "no data: stays at the prior");
});

test("likelihood: the detector finds the disruptions we know happened", () => {
  const t = Lk.adjust(D, S, { source: "data" }).table;
  const firstFrom = id => t.find(r => r.id === id).evidence.episodes.map(e => e.from.slice(0, 7));
  assert.ok(firstFrom("redsea-2023").includes("2023-12"), "Red Sea from Dec 2023");
  assert.ok(firstFrom("panama-2023").includes("2023-11"), "Panama drought from Nov 2023");
  assert.ok(firstFrom("baltimore-2024").includes("2024-03"), "Baltimore from Mar 2024");
  assert.ok(firstFrom("ila-2024").some(m => m === "2024-09" || m === "2024-10"), "East Coast strike, Oct 2024");
  assert.ok(firstFrom("x-hormuz").includes("2026-03"), "Hormuz from Mar 2026");
  assert.ok(firstFrom("evergiven-2021").includes("2021-03"), "Ever Given, Mar 2021");
});

test("correlation: drivers keep each event's likelihood but fatten the bad-year tail", () => {
  const tab = [1, 2, 3, 4, 5].map(i => ({ id: "e" + i, p: 0.1, losses: [1] }));
  const dr = [{ id: "d", q: 0.1, qBase: 0.1, m: 8, events: tab.map(r => r.id) }];
  const a = O.riskOf(tab, 40000, 3, []), b = O.riskOf(tab, 40000, 3, dr);
  assert.equal(a.eal, b.eal);
  assert.ok(b.cvar90 > a.cvar90 * 1.1);
  const sp = Lk.driverSplit(0.2, 0.25, 3), lam = -Math.log(0.8);
  const mixRate = 0.25 * -Math.log(1 - sp.hi) + 0.75 * -Math.log(1 - sp.lo);
  assert.ok(Math.abs(mixRate - lam) < 1e-9, "rates average back to the marginal");
});

test("climate: an El Niño year raises drought and typhoon risk only", () => {
  const t = Lk.adjust(D, S, { climate: "today" }).data.events, e = Lk.adjust(D, S, { climate: "elnino" }).data.events;
  const p = (evs, id) => evs.find(x => x.id === id).annualProb;
  assert.ok(p(e, "panama-2023") > p(t, "panama-2023") && p(e, "saola-2023") > p(t, "saola-2023"));
  assert.equal(p(e, "redsea-2023"), p(t, "redsea-2023"));
  const w = Lk.adjust(D, S, { climate: "warm2040" }).data.events.find(x => x.id === "panama-2023");
  assert.ok(w.duration.mode > D.events.find(x => x.id === "panama-2023").duration.mode);
});

test("worst cases: singles and pairs, ranked; overlapping events don't simply add up", () => {
  const small = Object.assign({}, D, { events: D.events.filter(e => ["redsea-2023", "ila-2024", "yantian-2021", "shanghai-2022"].includes(e.id)) });
  const r = W.worstCases(small, D.network, {}, {});
  assert.equal(r.length, 4 + 6);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].total <= r[i - 1].total);
  assert.ok(r.some(x => x.ids.length === 2 && x.interaction != null));
});
