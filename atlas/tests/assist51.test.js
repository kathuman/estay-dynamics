// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../engine/describe.js");
const B = require("../engine/brief.js");
const Dy = require("../engine/dynamics.js");
const D = require("../data.js");
const net = D.network;

test("describe: places, kind, severity, duration and rates become a structured event", () => {
  const a = X.parse("Busan port strike for three weeks, half capacity", D, net).event;
  assert.equal(a.type, "strike"); assert.equal(a.duration.actual, 21);
  assert.deepEqual(a.effects.ports.KRPUS, { cap: 0.5, delay: 0 });
  const b = X.parse("Houthi attacks close the Red Sea for 6 months and rates double", D, net).event;
  assert.deepEqual(b.effects.closed, ["BAM"]); assert.equal(b.effects.uplift["*"], 1); assert.equal(b.duration.actual, 180);
  const c = X.parse("Fire at the Hsinchu chip fabs, output down to 20% for two months", D, net).event;
  assert.equal(c.effects.suppliers["s-hsinchu"], 0.2); assert.equal(c.duration.actual, 60);
});

test("describe: nothing recognisable gives no event and says why; parsed events run in the engine", () => {
  const r = X.parse("A strike somewhere", D, net);
  assert.equal(r.event, null); assert.ok(r.notes.some(n => /recognised/.test(n)));
  const e = X.parse("Ransomware attack on Rotterdam terminals for 10 days", D, net).event;
  const res = Dy.analyse(D, net, [e], {});
  assert.ok(res.total > 0);
});

test("brief: first visit shows today's problems weighted by exposure; later visits show only changes", () => {
  const sig = (bam, hz) => ({ chokepoints: { chokepoint4: { name: "Bab el-Mandeb", ratio: bam, asOf: "2026-10-01", baseline: { container: 17 } } }, ports: {}, hazards: hz ? [{ src: "USGS", id: "q1", name: "M7", from: "2026-10-01" }] : [] });
  const ctx = { exposure: [{ wp: "BAM", name: "Bab el-Mandeb", share: 0.34 }], chokeIds: { BAM: "chokepoint4" }, portFlow: {}, alerts: [] };
  const first = B.compare(null, B.summarise(sig(0.28)), ctx);
  assert.ok(first.first && first.items[0].level === "critical" && /34%/.test(first.items[0].text));
  const same = B.compare(B.summarise(sig(0.28)), B.summarise(sig(0.3)), ctx);
  assert.ok(/No material change/.test(same.items[0].text));
  const better = B.compare(B.summarise(sig(0.28)), B.summarise(sig(0.9)), ctx);
  assert.equal(better.items[0].level, "good");
  assert.ok(/# /.test(B.markdown(better, "Brief")));
});
