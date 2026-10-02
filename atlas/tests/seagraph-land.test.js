// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Sea = require("../engine/seagraph.js");
const { check } = require("./landcheck.js");

test("sea graph: no lane or port access leg crosses land", () => {
  const bad = check();
  assert.deepEqual(bad.map(b => `${b.edge} (${b.landNm} nm over ${b.country})`), []);
});

test("sea graph: every library port reaches every major region", () => {
  const hubs = ["NLRTM", "USLAX", "SGSIN", "USNYC", "BRSSZ", "AUSYD"];
  Object.keys(Sea.PORTS).forEach(code => hubs.forEach(h => {
    if (code !== h) assert.ok(Sea.route(code, h).ok, `${code} -> ${h}`);
  }));
});

test("sea graph: every chokepoint waypoint is on at least two lanes", () => {
  Object.keys(Sea.CHOKES).forEach(w => {
    const n = Sea.EDGES.filter(e => e[0] === w || e[1] === w).length;
    assert.ok(n >= 2, w + " has " + n);
  });
});
