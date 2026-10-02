// Run: node --test atlas/tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const Sea = require("../engine/seagraph.js");
const Flow = require("../engine/flow.js");
const M = require("../engine/model.js");
const D = require("../data.js");

const days = nm => nm / (16 * 24);

test("sea graph: published lane distances within ~6%", () => {
  // Reference port-to-port distances (nautical miles, common routing).
  const ref = [["CNSHA", "NLRTM", 10500], ["SGSIN", "NLRTM", 8300], ["CNSHA", "USLAX", 5700], ["INNSA", "NLRTM", 6300]];
  ref.forEach(([a, b, nm]) => {
    const r = Sea.route(a, b);
    assert.ok(r.ok, `${a}-${b} routes`);
    assert.ok(Math.abs(r.nm - nm) / nm < 0.06, `${a}-${b}: ${Math.round(r.nm)} vs ${nm}`);
  });
});

test("sea graph: closing Bab-el-Mandeb diverts Asia–Europe round the Cape (+8 to +14 days)", () => {
  const base = Sea.route("CNSHA", "NLRTM", { avoid: { PANAMA: true } });
  const cape = Sea.route("CNSHA", "NLRTM", { closed: { BAM: true }, avoid: { PANAMA: true } });
  assert.ok(base.via.includes("SUEZ"));
  assert.ok(cape.via.includes("CAPE") && !cape.via.includes("SUEZ"));
  const extra = days(cape.nm - base.nm);
  assert.ok(extra > 8 && extra < 14, `extra days ${extra.toFixed(1)}`);
});

test("sea graph: Hormuz closure isolates Jebel Ali; Taiwan Strait closure reroutes east of Taiwan", () => {
  assert.equal(Sea.route("AEJEA", "NLRTM", { closed: { HORMUZ: true } }).ok, false);
  const r = Sea.route("CNSHA", "SGSIN", { closed: { TWS: true } });
  assert.ok(r.ok && r.via.includes("LUZON") && !r.via.includes("TWS"));
});

test("sea graph: every library port reaches Rotterdam and Los Angeles", () => {
  Object.keys(Sea.PORTS).forEach(code => {
    if (code !== "NLRTM") assert.ok(Sea.route(code, "NLRTM").ok, code + " -> NLRTM");
    if (code !== "USLAX") assert.ok(Sea.route(code, "USLAX").ok, code + " -> USLAX");
  });
});

test("flow solver: picks the cheaper path, spills over capacity", () => {
  const f = new Flow.MinCostFlow(4);
  f.addEdge(0, 1, 5, 1); f.addEdge(1, 3, 5, 1); // cheap, cap 5
  f.addEdge(0, 2, 10, 3); f.addEdge(2, 3, 10, 3); // dear
  const r = f.run(0, 3, 8);
  assert.equal(r.flow, 8);
  assert.equal(r.cost, 5 * 2 + 3 * 6);
});

test("model: baseline serves all demand with no shortage", () => {
  const base = M.evaluate(D.network, M.conditions([]), {}, M.params(D));
  assert.equal(Math.round(base.servedTotal), D.network.dcs.reduce((a, d) => a + d.demand, 0));
  Object.values(base.short).forEach(x => assert.ok(x < 1e-6));
});

test("model: flow is conserved — served + short = demand at every DC, every event", () => {
  D.events.forEach(ev => {
    const r = M.evaluate(D.network, M.conditions([ev]), {}, M.params(D));
    D.network.dcs.forEach(d => assert.ok(Math.abs(r.served[d.id] + r.short[d.id] - d.demand) < 1e-6, ev.id + " " + d.id));
  });
});

test("model: conditions combine to the tightest capacity and largest uplift", () => {
  const c = M.conditions([
    { id: "a", effects: { ports: { X: { cap: 0.5, delay: 3 } }, uplift: { AE: 0.4 } } },
    { id: "b", effects: { ports: { X: { cap: 0.8, delay: 7 } }, uplift: { AE: 1.0, "*": 0.2 } } }
  ]);
  assert.deepEqual(c.ports.X, { cap: 0.5, delay: 7 });
  assert.equal(c.uplift.AE, 1.0);
  assert.equal(c.upliftAll, 0.2);
});

test("model: day simulation — buffer covers a gap shorter than itself, not a longer one", () => {
  const ok = M.simulateDc(700, 10, [{ rate: 100, from: 8, to: Infinity }], 60);
  assert.equal(ok.tts, null); assert.equal(ok.lostTeu, 0);
  const short = M.simulateDc(700, 5, [{ rate: 100, from: 8, to: Infinity }], 60);
  assert.equal(short.tts, 5); assert.ok(Math.abs(short.lostTeu - 300) < 1e-6);
  const air = M.simulateDc(700, 5, [{ rate: 100, from: 8, to: Infinity }], 60, false, { capDay: 50, from: 6 });
  assert.ok(Math.abs(air.lostTeu - 200) < 1e-6 && Math.abs(air.airTeu - 100) < 1e-6);
});

test("model: Red Sea closure costs money, lengthens Venlo supply, and more buffer raises TTS", () => {
  const ev = D.events.find(e => e.id === "redsea-2023");
  const r0 = M.analyse(D, D.network, [ev], {});
  assert.ok(r0.total > 0 && r0.comps.surcharge > 0);
  assert.ok(r0.tts !== null, "8-day Venlo buffer can't cover a ~10-day Cape diversion");
  const r1 = M.analyse(D, D.network, [ev], { buffer: 10 });
  assert.equal(r1.tts, null);
  assert.ok(r1.lostTeu < r0.lostTeu);
});

test("model: fixed-rate contracts cut surcharge exposure; live conditions are a steady state", () => {
  const ev = D.events.find(e => e.id === "redsea-2023");
  const a = M.analyse(D, D.network, [ev], {}), b = M.analyse(D, D.network, [ev], { rateHedge: true });
  assert.ok(b.comps.surcharge < a.comps.surcharge * 0.4);
  const live = M.liveEvent({ chokepoints: { chokepoint4: { name: "Bab el-Mandeb", ratio: 0.3, asOf: "2026-09-27" } } });
  assert.deepEqual(live.effects.closed, ["BAM"]);
  const r = M.analyse(D, D.network, [live], {});
  assert.equal(r.lostTeu, 0, "no onset shock in steady state");
});

test("model: Monte Carlo is reproducible and ordered", () => {
  const ev = D.events.find(e => e.id === "ila-2024");
  const a = M.monteCarlo(D, D.network, [ev], {}, {}, 200, 42), b = M.monteCarlo(D, D.network, [ev], {}, {}, 200, 42);
  assert.equal(a.mean, b.mean);
  assert.ok(a.p10 <= a.p50 && a.p50 <= a.p90 && a.p90 <= a.p99);
});

test("model: portfolio covers all 32 lever combinations, sorted by total annual cost", () => {
  const rows = M.portfolio(D, D.network, {}, 5, 60);
  assert.equal(rows.length, 32);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].total >= rows[i - 1].total - 1e-6);
});
