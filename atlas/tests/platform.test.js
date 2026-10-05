// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const Api = require("../engine/api.js");
const Sh = require("../engine/shipments.js");
const M = require("../engine/model.js");
const Dy = require("../engine/dynamics.js");
const D = require("../data.js");
const S = require("../data/signals.js");

test("api: a spec gives the same numbers as the engine the page uses", () => {
  const r = Api.run({ atlasSpec: 1, events: ["redsea-2023"], levers: { controlTower: true } }, D, S, "test");
  const direct = Dy.analyse(D, D.network, [D.events.find(e => e.id === "redsea-2023")], { controlTower: true }, {});
  assert.equal(r.atlasResult, 1);
  assert.ok(Math.abs(r.kpis.totalCost - direct.total) < 1e-6);
  assert.equal(r.kpis.lostTeu, direct.lostTeu);
  assert.equal(r.families.length, 4);
});

test("api: unknown events are reported, newer spec versions refused, custom events accepted", () => {
  const r = Api.run({ events: ["nope", { id: "my-strike", type: "strike", effects: { ports: { USSAV: { cap: 0 } } }, duration: { actual: 10, min: 5, mode: 10, max: 30 } }] }, D, S);
  assert.ok(r.warnings.some(w => /nope/.test(w)));
  assert.deepEqual(r.scenario.events.map(e => e.id), ["my-strike"]);
  assert.throws(() => Api.run({ atlasSpec: 99 }, D, S), /newer/);
});

test("api: optional analyses run and the live base works", () => {
  const r = Api.run({ events: ["ila-2024"], liveBase: true, analyses: { monteCarlo: { runs: 30, seed: 2 }, likelihood: { source: "data" } } }, D, S);
  assert.ok(r.monteCarlo && r.monteCarlo.runs === 30);
  assert.ok(r.likelihoods.some(x => x.dataInformed));
  assert.equal(r.scenario.liveBase, true);
});

test("shipments: detect columns, match ports by code and name, rebuild the network", () => {
  const base = M.evaluate(D.network, M.conditions([]), {}, M.params(D));
  const P = Sh.parse(Sh.sampleCsv(D.network, base, 12));
  const m = Sh.detect(P.headers);
  ["date", "origin", "destination", "pol", "pod", "teu", "product"].forEach(k => assert.ok(m[k], "detected " + k));
  const b = Sh.build(P, m, {});
  assert.deepEqual(b.warnings, []);
  assert.equal(b.network.dcs.length, 3);
  assert.equal(b.network.productDefs.length, 4);
  const want = D.network.dcs.find(d => d.id === "dc-venlo").demand, got = b.network.dcs.find(d => /Venlo/.test(d.name)).demand;
  assert.ok(Math.abs(got - want) / want < 0.2, `Venlo demand ${got} vs ${want} (sample includes ±15% noise; direct road legs aren't in shipment data)`);
  ["Long Beach", "JNPT", "Port of Shanghai", "CN NGB", "Pusan"].forEach(x => assert.ok(Sh.matchPort(x), x));
  assert.equal(Sh.matchPort("Atlantis"), null);
});

test("shipments: semicolon files, FEU volumes and unresolved ports are handled", () => {
  const csv = "Supplier;POL;POD;Destination;FEU;Date\nA;Shanghai;Rotterdam;Venlo DC;2;2026-01-05\nA;Shanghai;Atlantis;Venlo DC;1;2026-01-12\nB;Busan;Long Beach;Dallas DC;3;2026-01-19\n";
  const P = Sh.parse(csv), m = Sh.detect(P.headers);
  assert.equal(P.sep, ";"); assert.equal(m.teuFactor, 2);
  const b = Sh.build(P, m, {});
  assert.equal(b.stats.used, 2);
  assert.ok(b.warnings.some(w => /Atlantis/.test(w)));
  assert.equal(b.network.services.length, 2);
});

test("cli: runs an example spec and prints a JSON result", () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, "..", "cli", "run.mjs"), path.join(__dirname, "..", "examples", "redsea-with-options.json")], { encoding: "utf8" });
  const r = JSON.parse(out);
  assert.equal(r.atlasResult, 1);
  assert.ok(r.kpis.totalCost > 0 && r.monteCarlo.runs === 100);
});
