// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Dy = require("../engine/dynamics.js");
const D = require("../data.js");
const net = D.network;
const ev = id => D.events.find(e => e.id === id);

test("dynamics: event profile ramps up, holds, fades; rates decay after the event", () => {
  const pr = { onset: 10, recovery: 20, rateHalfLife: 30 };
  assert.equal(Dy.sev(-1, 50, pr), 0);
  assert.equal(Dy.sev(5, 50, pr), 0.5);
  assert.equal(Dy.sev(30, 50, pr), 1);
  assert.equal(Dy.sev(70, 50, pr), 0.5);
  assert.equal(Dy.sev(81, 50, pr), 0);
  assert.ok(Math.abs(Dy.rateIdx(90, 50, pr) - 0.5) < 1e-9, "half-life after the event ends");
});

test("dynamics: with no disruption, every TEU arrives, nothing queues, cost ≈ 0", () => {
  const r = Dy.analyse(D, net, [], {});
  assert.equal(r.lostTeu, 0);
  assert.ok(Math.max(...r.series.backlog) < 1e-6);
  assert.ok(Math.abs(r.total) < 0.5e6, "residual from day rounding stays small: " + r.total);
});

test("dynamics: no cargo is left stuck in a queue at the end of any library event", () => {
  D.events.forEach(e => {
    const r = Dy.analyse(D, net, [e], {});
    const end = r.series.backlog[r.series.backlog.length - 1];
    assert.ok(end < 1, `${e.id}: ${end.toFixed(1)} TEU still queued`);
  });
});

test("dynamics: Ever Given — the Suez queue builds for 6 days and clears in about 5", () => {
  const ctx = Dy.prepare(D, net, [], {});
  const base = ctx.chokeFlow.SUEZ / 7;
  const r = Dy.analyse(D, net, [ev("evergiven-2021")], {});
  const pass = r.chokePass.SUEZ;
  for (let d = 0; d < 6; d++) assert.ok(!(pass[d] > 0), "nothing passes while blocked");
  let surgeDays = 0;
  for (let d = 6; d < 20; d++) if ((pass[d] || 0) > base * 1.5) surgeDays++;
  assert.ok(surgeDays >= 4 && surgeDays <= 7, "backlog surge days: " + surgeDays);
  assert.equal(r.lostTeu, 0, "a 6-day blockage is waited out, not diverted");
});

test("dynamics: a 3-day port strike dips the week, then the backlog spreads over the next weeks", () => {
  const ctx = Dy.prepare(D, net, [], {});
  const r = Dy.analyse(D, net, [ev("ila-2024")], {});
  const pp = r.portPass.USSAV, base = ctx.portIn.USSAV / 7;
  const wk = k => { let s = 0; for (let i = k * 7; i < k * 7 + 7; i++) s += pp[i] || 0; return s / 7 / base; };
  assert.ok(wk(0) < 0.75, "strike week " + wk(0));
  assert.ok(wk(1) > 1.05, "catch-up week " + wk(1));
});

test("dynamics: a long strike hurts far more than a short one; the control tower helps when it's long", () => {
  const s3 = Dy.analyse(D, net, [ev("ila-2024")], {}, { duration: 3 });
  const s42 = Dy.analyse(D, net, [ev("ila-2024")], {}, { duration: 42 });
  const s42ct = Dy.analyse(D, net, [ev("ila-2024")], { controlTower: true }, { duration: 42 });
  assert.equal(s3.lostTeu, 0);
  assert.ok(s42.lostTeu > 1000);
  assert.ok(s42ct.total < s42.total);
});

test("dynamics: Red Sea — Venlo runs short, the control tower and extra stock both reduce it", () => {
  const a = Dy.analyse(D, net, [ev("redsea-2023")], {});
  const ct = Dy.analyse(D, net, [ev("redsea-2023")], { controlTower: true });
  const buf = Dy.analyse(D, net, [ev("redsea-2023")], { buffer: 14 });
  assert.ok(a.lostTeu > 0 && a.dcs.find(d => d.id === "dc-venlo").tts !== null);
  assert.ok(ct.lostTeu < a.lostTeu);
  assert.ok(buf.lostTeu < a.lostTeu);
});

test("dynamics: live conditions show their running cost without an onset shock", () => {
  const M = require("../engine/model.js");
  const live = M.liveEvent({ chokepoints: { chokepoint4: { name: "Bab el-Mandeb", ratio: 0.3, asOf: "2026-09-27", baseline: { container: 17 } } } });
  const r = Dy.analyse(D, net, [live], {}, { duration: 90 });
  assert.equal(r.lostTeu, 0);
  assert.ok(r.total > 0);
});

test("dynamics: Monte Carlo and portfolio are deterministic and ordered", () => {
  const a = Dy.monteCarlo(D, net, [ev("ila-2024")], {}, {}, 60, 9), b = Dy.monteCarlo(D, net, [ev("ila-2024")], {}, {}, 60, 9);
  assert.equal(a.mean, b.mean);
  assert.ok(a.p10 <= a.p50 && a.p50 <= a.p90);
  const q = Dy.quantilesTri({ min: 2, mode: 7, max: 42 }, 6);
  for (let i = 1; i < q.length; i++) assert.ok(q[i] > q[i - 1]);
});

test("dynamics: fixed-rate contracts cut the surcharge paid by their coverage", () => {
  const a = Dy.analyse(D, net, [ev("redsea-2023")], {}), b = Dy.analyse(D, net, [ev("redsea-2023")], { rateHedge: true });
  assert.ok(a.comps.surcharge > 0);
  assert.ok(Math.abs(b.comps.surcharge - a.comps.surcharge * (1 - D.levers.rateHedge.coverage)) < 1e-6 * a.comps.surcharge + 1);
});
