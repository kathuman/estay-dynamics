// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../engine/alerts.js");
const M = require("../engine/model.js");
const D = require("../data.js");

const T = D.hazardTemplates;
const sig = hazards => ({ chokepoints: {}, hazards, disruptions: [] });

test("alerts: a typhoon near Shenzhen shuts Yantian and cuts the factory", () => {
  const ev = A.build(sig([{ src: "GDACS", type: "TC", name: "SAOLA-99", alert: "Red", from: "2026-09-01", lat: 22.3, lng: 114.5, url: "x" }]), D.network, T);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].effects.ports.CNYTN, { cap: 0, delay: 2 });
  assert.equal(ev[0].effects.supply["f-shenzhen"], 0.6);
  assert.equal(ev[0].severity, 5);
  const r = M.analyse(D, D.network, ev, {});
  assert.ok(r.total > 0, "the alert scenario runs through the engine");
});

test("alerts: earthquake bands by magnitude; far-away hazards are ignored", () => {
  const big = A.build(sig([{ src: "USGS", type: "EQ", name: "M7.4 — near Ningbo", mag: 7.4, from: "2026-09-02", lat: 29.9, lng: 121.6 }]), D.network, T)[0];
  assert.equal(big.effects.ports.CNNGB.cap, 0.3);
  const small = A.build(sig([{ src: "USGS", type: "EQ", name: "M6.2 — near Ningbo", mag: 6.2, from: "2026-09-03", lat: 29.9, lng: 121.6 }]), D.network, T)[0];
  assert.equal(small.effects.ports.CNNGB.cap, 0.8);
  assert.equal(A.build(sig([{ src: "USGS", type: "EQ", name: "M7.9 — mid-ocean", mag: 7.9, from: "2026-09-04", lat: -50, lng: -120 }]), D.network, T).length, 0);
});

test("alerts: a drought counts for the canal only when Panama is listed", () => {
  const near = { src: "GDACS", type: "DR", alert: "Orange", from: "2026-04-21", lat: 16.9, lng: -93.6 };
  assert.equal(A.build(sig([{ ...near, name: "Drought in Costa Rica, Mexico" }]), D.network, T).length, 0);
  const ev = A.build(sig([{ ...near, name: "Drought in Costa Rica, Panama" }]), D.network, T)[0];
  assert.deepEqual(ev.effects.choke, { PANAMA: { cap: 0.9, delay: 4 } });
});

test("alerts: PortWatch's affected-port list is honoured and duplicates collapse", () => {
  const h = { type: "TC", name: "BAVI-99", alert: "Red", from: "2026-07-01", lat: 28.7, lng: 125.0 }; // ~350 km from Ningbo
  const ev = A.build({ hazards: [{ ...h, src: "GDACS" }], disruptions: [{ ...h, src: "PortWatch", id: "1", ports: ["CNNGB"] }] }, D.network, T);
  assert.equal(ev.length, 1, "same storm from two sources -> one alert");
  const pw = A.build({ hazards: [], disruptions: [{ ...h, src: "PortWatch", id: "1", ports: ["CNNGB"] }] }, D.network, T)[0];
  assert.ok(pw.effects.ports.CNNGB, "listed port included even beyond the radius");
});

test("live conditions: ports below normal become port effects", () => {
  const live = M.liveEvent({ chokepoints: {}, ports: { AEJEA: { ratio: 0.13 }, SAJED: { ratio: 0.5 }, NLRTM: { ratio: 0.95 } } });
  assert.deepEqual(live.effects.ports.AEJEA, { cap: 0.13, delay: 3 });
  assert.deepEqual(live.effects.ports.SAJED, { cap: 0.5, delay: 2 });
  assert.equal(live.effects.ports.NLRTM, undefined);
  const only = M.liveEvent({ chokepoints: {}, ports: { AEJEA: { ratio: 0.13 }, SAJED: { ratio: 0.5 } } }, { ports: { SAJED: 1 } });
  assert.deepEqual(Object.keys(only.effects.ports), ["SAJED"]);
});
