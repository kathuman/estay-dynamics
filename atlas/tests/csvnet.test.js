// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../engine/csvnet.js");
const M = require("../engine/model.js");
const D = require("../data.js");

test("csv: quoted fields, escaped quotes and CRLF", () => {
  assert.deepEqual(C.splitCSVLine('a,"b, c","say ""hi""",'), ["a", "b, c", 'say "hi"', ""]);
  const rows = C.parseCSV("ID,Name\r\nx,\"X, Ltd\"\r\n\r\n");
  assert.deepEqual(rows, [{ id: "x", name: "X, Ltd" }]);
});

test("csv: the shipped templates build a valid network", () => {
  const r = C.buildCustomNet(C.NODES_TEMPLATE, C.LANES_TEMPLATE);
  assert.deepEqual(r.errors, []);
  assert.equal(r.net.factories.length, 3);
  assert.equal(r.net.dcs.length, 2);
  assert.equal(r.net.services.length, 4);
  assert.ok(r.net.ports.BDCGP && r.net.ports.BDCGP.sea.length === 2, "custom port attached to the sea graph");
});

test("csv: library ports need no node row; missing days are estimated", () => {
  const nodes = "id,name,type,lat,lng,capacity_teu_wk,demand_teu_wk\nf1,F,factory,31.3,120.6,100,\nd1,D,dc,51.4,6.2,,80\n";
  const lanes = "from,to,mode,capacity_teu_wk,rate_per_teu,days\nf1,CNSHA,road,,150,\nCNSHA,NLRTM,sea,200,900,\nNLRTM,d1,road,,300,1\n";
  const r = C.buildCustomNet(nodes, lanes);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some(w => /estimated/.test(w)));
  assert.ok(r.net.factories[0].exports[0].days >= 1);
  assert.equal(r.net.ports, undefined, "no custom ports -> router uses the library only");
});

test("csv: bad rows are reported, not silently dropped", () => {
  const nodes = "id,name,type,lat,lng\nf1,F,factory,99,0\nx,X,warehouse-ish,1,1\nd1,D,dc,0,0\n";
  const lanes = "from,to,mode\nf1,d1,sea\nnope,d1,road\n";
  const r = C.buildCustomNet(nodes, lanes);
  assert.ok(r.errors.some(e => /bad lat\/lng/.test(e)));
  assert.ok(r.errors.some(e => /type must be/.test(e)));
  assert.ok(r.errors.some(e => /unknown nope/.test(e)));
});

test("csv: demo network serves all demand at baseline and reroutes under the Red Sea closure", () => {
  const net = C.buildCustomNet(C.NODES_TEMPLATE, C.LANES_TEMPLATE).net;
  const base = M.evaluate(net, M.conditions([]), {}, M.params(D));
  assert.equal(Math.round(base.servedTotal), 450);
  const ev = D.events.find(e => e.id === "redsea-2023");
  const r = M.analyse(D, net, [ev], {});
  const viaCape = r.prep.dis.services.filter(s => s.ok && s.chokes.includes("CAPE"));
  assert.ok(viaCape.length >= 2, "Bangladesh/Vietnam to Europe lanes go round the Cape");
  assert.ok(r.total > 0);
});

test("validation: every check against history passes on the current snapshot", () => {
  const V = require("../engine/validation.js");
  const rows = V.run(require("../data/signals.js"), D);
  assert.ok(rows.length >= 6);
  rows.forEach(r => assert.ok(r.ok, `${r.topic}: ${r.claim} — model ${r.model} vs ${r.observed}`));
});
