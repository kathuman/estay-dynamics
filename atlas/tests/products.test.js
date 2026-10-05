// Run: node --test atlas/tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Dy = require("../engine/dynamics.js");
const M = require("../engine/model.js");
const C = require("../engine/csvnet.js");
const D = require("../data.js");
const net = D.network;
const ev = id => D.events.find(e => e.id === id);
const fam = (r, id) => r.products.find(p => p.id === id);

test("products: baseline plan serves every family's demand at every DC", () => {
  const b = M.evaluate(net, M.conditions([]), {}, M.params(D));
  D.products.forEach(pr => {
    const want = net.dcs.reduce((a, d) => a + (d.mix[pr.id] || 0), 0);
    assert.ok(Math.abs(b.byProduct[pr.id].served - want) < 1e-6, pr.id);
  });
  D.events.forEach(e => {
    const r = M.evaluate(net, M.conditions([e]), {}, M.params(D));
    net.dcs.forEach(d => assert.ok(Math.abs(r.served[d.id] + r.short[d.id] - d.demand) < 1e-6, e.id + " " + d.id));
  });
});

test("products: when capacity is short, the most valuable families are protected first", () => {
  const r = Dy.analyse(D, net, [ev("lalb-2021")], {});
  assert.ok(fam(r, "phones").worst4w > fam(r, "appliances").worst4w, "phones fare better than appliances");
  assert.equal(fam(r, "appliances").meets, false);
});

test("products: critical-only safety stock costs less than stocking everything", () => {
  const p = M.params(D);
  const all = M.leverAnnualCost(D, net, { buffer: 10 }, p).total, crit = M.leverAnnualCost(D, net, { buffer: 10, bufferScope: "critical" }, p).total;
  assert.ok(crit < all && crit > 0);
  const r0 = Dy.analyse(D, net, [ev("redsea-2023")], {});
  const rc = Dy.analyse(D, net, [ev("redsea-2023")], { buffer: 10, bufferScope: "critical" });
  assert.ok(fam(rc, "phones").lostTeu < fam(r0, "phones").lostTeu, "critical families gain");
  assert.ok(Math.abs(fam(rc, "appliances").lostTeu - fam(r0, "appliances").lostTeu) < 1e-6 || fam(rc, "appliances").lostTeu <= fam(r0, "appliances").lostTeu, "others not stocked");
});

test("products: air freight only ever carries families allowed to fly", () => {
  const r = Dy.analyse(D, net, [ev("redsea-2023")], { airBridge: true });
  D.products.filter(p => !p.air).forEach(p => assert.equal(fam(r, p.id).airTeu, 0, p.id));
  assert.ok(D.products.filter(p => p.air).some(p => fam(r, p.id).airTeu > 0));
});

test("products: lost-sale cost is valued per family", () => {
  const r = Dy.analyse(D, net, [ev("redsea-2023")], {});
  const want = r.products.reduce((a, p) => a + p.lostTeu * p.lostSaleCostPerTeu, 0);
  assert.ok(Math.abs(r.comps.lostMargin - want) < 1);
});

test("products: networks without families (CSV import) run as one aggregate product", () => {
  const cnet = C.buildCustomNet(C.NODES_TEMPLATE, C.LANES_TEMPLATE).net;
  const r = Dy.analyse(D, cnet, [ev("redsea-2023")], {});
  assert.equal(r.multiProduct, false);
  assert.equal(r.products.length, 1);
  assert.equal(r.products[0].id, "all");
});

test("suppliers: cascade through tiers; dependencies multiply; component stock absorbs short outages", () => {
  const M = require("../engine/model.js");
  const e = M.effectiveSupply(net, {}, { "s-mie": 0 });
  assert.ok(Math.abs(e.suppliers["s-hsinchu"] - 0.5) < 1e-9, "tier 3 -> tier 2");
  assert.ok(e.factories["f-shenzhen"] < 1 && e.factories["f-wroclaw"] < 1 && e.factories["f-campinas"] === 1);
  const two = M.effectiveSupply(net, {}, { "s-hsinchu": 0.5, "s-paju": 0.5 }).factories["f-shenzhen"];
  assert.ok(Math.abs(two - (1 - 0.8 * 0.5) * (1 - 0.4 * 0.5)) < 1e-9);
  const short = Dy.analyse(D, net, [ev("hualien-2024")], {}, { duration: 2 }), long = Dy.analyse(D, net, [ev("hualien-2024")], {}, { duration: 45 });
  assert.equal(short.lostTeu, 0);
  assert.ok(long.lostTeu > 0);
});

test("suppliers: hidden concentration — exposure counts dependence through every tier", () => {
  const r = Dy.analyse(D, net, [], {});
  const fab = r.supplierExposure.find(s => s.id === "s-hsinchu"), chem = r.supplierExposure.find(s => s.id === "s-mie");
  assert.ok(fab.share > 0.5, "most volume needs Taiwan chips");
  assert.ok(chem.share > 0.2 && chem.factories.length >= 5, "a tier-3 plant sits behind most factories");
});

test("suppliers: CSV import and alerts include supplier sites", () => {
  const C = require("../engine/csvnet.js"), A = require("../engine/alerts.js");
  const r = C.buildCustomNet(C.NODES_TEMPLATE, C.LANES_TEMPLATE, C.SUPPLIERS_TEMPLATE);
  assert.equal(r.net.suppliers.length, 3);
  assert.ok(M.effectiveSupply(r.net, {}, { "s-dye": 0 }).factories["f-dhaka"] < 1);
  const al = A.build({ hazards: [{ src: "USGS", type: "EQ", name: "M7.2 — near Hsinchu", mag: 7.2, from: "2026-09-01", lat: 24.8, lng: 121.0 }], disruptions: [] }, net, D.hazardTemplates);
  assert.ok(al.length && al[0].effects.suppliers["s-hsinchu"] < 1);
});
