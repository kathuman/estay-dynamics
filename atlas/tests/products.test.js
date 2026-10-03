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
