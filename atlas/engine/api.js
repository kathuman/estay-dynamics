/*
 * api.js — run the Atlas from a JSON spec (v5). The same function backs the command-line tool
 * (cli/run.mjs) and the page's "Run a JSON spec" box, so integrations get exactly the numbers
 * the page shows.
 *
 * Spec (atlasSpec: 1):
 *   {
 *     "atlasSpec": 1,
 *     "network": null                        // null = the built-in sample network
 *              | { factories, dcs, services, ports? }          // engine network
 *              | { "csv": { "nodes": "...", "lanes": "..." } } // the page's CSV formats
 *              | { "shipments": "...csv...", "mapping": {...} }// shipment history (engine/shipments.js)
 *     "events": ["redsea-2023", "live", { ...custom event... }],
 *     "liveBase": false,          // solve the baseline under today's live conditions
 *     "durationDays": null,       // peak duration for every event (null = each event's actual)
 *     "levers": { ... },          // on/off or amounts, as in the page
 *     "assumptions": { ... },     // valuePerTeu, lostMarginPerTeu, carryingRatePct, ...
 *     "products": { "phones": { "fillTarget": 0.99 } },
 *     "analyses": {
 *       "monteCarlo": { "runs": 200, "seed": 1 },
 *       "worstCases": { "pairs": true, "by": "cost" },
 *       "optimise": { "lambda": 0.5, "strata": 3 },
 *       "likelihood": { "source": "data", "climate": "today", "correlated": true }
 *     }
 *   }
 * Result (atlasResult: 1): kpis, cost components, families, DCs, services, exposure, and any
 * requested analyses. Unknown event ids are reported in `warnings`, never silently dropped.
 *
 * Pure. Browser global window.AtlasApi; CommonJS for node.
 */
(function (root) {
  "use strict";
  function req(name, glob) { return root[glob] || (typeof require === "function" ? require(name) : null); }
  var M = req("./model.js", "AtlasModel"), Dy = req("./dynamics.js", "AtlasDynamics"), Sea = req("./seagraph.js", "AtlasSea");
  var Csv = req("./csvnet.js", "AtlasCsv"), Lk = req("./likelihood.js", "AtlasLikelihood"), O = req("./optimise.js", "AtlasOptimise");
  var W = req("./worstcase.js", "AtlasWorstCase"), Ship = req("./shipments.js", "AtlasShipments"), Al = req("./alerts.js", "AtlasAlerts");

  var SPEC_VERSION = 1, RESULT_VERSION = 1;

  function buildNetwork(data, spec, warnings) {
    var n = spec.network;
    if (!n) return data.network;
    if (n.csv) {
      var r = Csv.buildCustomNet(n.csv.nodes || "", n.csv.lanes || "");
      r.errors.forEach(function (e) { warnings.push("network: " + e); });
      return r.net;
    }
    if (n.shipments) {
      if (!Ship) throw new Error("shipment import module not loaded");
      var b = Ship.build(Ship.parse(n.shipments), n.mapping || Ship.detect(Ship.parse(n.shipments).headers), n.options || {});
      b.warnings.forEach(function (w) { warnings.push("shipments: " + w); });
      return b.network;
    }
    return n;
  }

  function run(spec, data, signals, appVersion) {
    if (!spec || typeof spec !== "object") throw new Error("spec must be an object");
    if (spec.atlasSpec && spec.atlasSpec > SPEC_VERSION) throw new Error("spec version " + spec.atlasSpec + " is newer than this engine (" + SPEC_VERSION + ")");
    var warnings = [];
    var net = buildNetwork(data, spec, warnings);
    if (!net || !net.dcs || !net.dcs.length) throw new Error("network has no DCs");
    // event lookup: library ids, "live", custom objects
    var portsUsed = {}; if (Al) Al.networkPorts(net).forEach(function (p) { portsUsed[p.code] = 1; });
    var live = signals ? M.liveEvent(signals, { ports: portsUsed }) : null;
    var byId = {}; data.events.forEach(function (e) { byId[e.id] = e; }); if (live) byId.live = live;
    var events = (spec.events || []).map(function (e) {
      if (typeof e === "string") { if (!byId[e]) warnings.push("unknown event '" + e + "' ignored"); return byId[e]; }
      if (e && e.effects) return Object.assign({ kind: "custom", type: e.type || "geopolitical", duration: { actual: 30, min: 7, mode: 30, max: 90 }, severity: 3, name: e.id || "custom" }, e);
      warnings.push("event entries must be ids or objects with effects"); return null;
    }).filter(Boolean);
    var o = Object.assign({}, spec.assumptions || {});
    if (o.extraUpliftPct != null) { o.extraUplift = o.extraUpliftPct / 100; delete o.extraUpliftPct; }
    if (spec.products) o.products = spec.products;
    if (spec.liveBase) { if (live) o.baseEvents = [live]; else warnings.push("liveBase requested but no live snapshot is available"); }
    if (spec.durationDays) o.duration = spec.durationDays;
    var levers = spec.levers || {};

    var res = Dy.analyse(data, net, events, levers, Object.assign({}, o, { duration: o.duration || (events.length ? undefined : 30) }));
    var out = {
      atlasResult: RESULT_VERSION, engine: "Global Disruption Atlas " + (appVersion || ""), generated: new Date().toISOString(),
      dataSnapshot: signals ? signals.generated : null, warnings: warnings,
      network: { name: net.name || "custom", factories: net.factories.length, dcs: net.dcs.length, services: (net.services || []).length, products: (res.products || []).map(function (f) { return f.id; }) },
      scenario: { events: events.map(function (e) { return { id: e.id, name: e.name, kind: e.kind }; }), liveBase: !!spec.liveBase, durationDays: res.ttr, levers: levers },
      kpis: { totalCost: res.total, lostTeu: res.lostTeu, airTeu: res.airTeu, timeToSurvive: res.tts, timeToRecover: res.ttr, serviceRecoveredDay: res.recoveredAt, recoveryTailDays: res.tail,
        peakBacklogTeu: res.series ? Math.max.apply(null, res.series.backlog.concat([0])) : null, leverAnnualCost: res.leverCost.total, firstReplanDay: res.firstReplan },
      components: res.comps,
      families: (res.products || []).map(function (f) { return { id: f.id, name: f.name, demandTeuWeek: f.demand, worst4WeekFill: f.worst4w, overallFill: f.fill, target: f.fillTarget || f.target, meetsTarget: f.meets, lostTeu: f.lostTeu, lostSaleCost: f.lostCost, airTeu: f.airTeu }; }),
      dcs: res.dcs.map(function (d) { return { id: d.id, name: d.name, demandTeuWeek: d.demand, timeToSurvive: d.tts, lostTeu: d.lostTeu, airTeu: d.airTeu }; }),
      services: res.prep.dis.services.map(function (s) { var b = res.prep.base.services.filter(function (x) { return x.id === s.id; })[0]; return { id: s.id, from: s.from, to: s.to, open: s.ok, days: s.ok ? s.days : null, normalDays: b && b.ok ? b.days : null, capacityTeuWeek: s.ok ? s.cap : 0, via: s.ok ? s.chokes : [] }; }),
      exposure: res.exposure
    };
    var an = spec.analyses || {};
    var adj = Lk && an.likelihood ? Lk.adjust(data, signals, an.likelihood) : null;
    if (adj) out.likelihoods = adj.table.map(function (r) { return { id: r.id, stated: r.assumed, used: r.used, episodes: r.evidence ? r.evidence.n : null, years: r.evidence ? r.evidence.years : null, dataInformed: r.posterior ? { p: r.posterior.p, lo: r.posterior.lo, hi: r.posterior.hi } : null }; });
    if (an.monteCarlo && events.length) {
      var mc = Dy.monteCarlo(data, net, events, levers, Object.assign({}, o, { duration: undefined }), an.monteCarlo.runs || 200, an.monteCarlo.seed || 1);
      out.monteCarlo = { runs: mc.runs, mean: mc.mean, p10: mc.p10, p50: mc.p50, p90: mc.p90, p99: mc.p99, pShortfall: mc.pShortfall, meanRecoveryTail: mc.meanTail };
    }
    if (an.worstCases) {
      var wc = W.worstCases(adj ? adj.data : data, net, levers, o, an.worstCases);
      out.worstCases = wc.slice(0, an.worstCases.top || 10).map(function (r) { return { events: r.ids, totalCost: r.total, lostTeu: r.lostTeu, familiesBelowTarget: r.missing, worseTogetherBy: r.interaction == null ? null : r.interaction }; });
    }
    if (an.optimise) {
      var opt = O.optimise(adj ? adj.data : data, net, o, { lambda: an.optimise.lambda || 0, strata: an.optimise.strata || 3, years: an.optimise.years || 4000, drivers: adj ? adj.drivers : [] });
      out.optimise = { lambda: opt.lambda, evaluations: opt.evaluations, recommended: opt.best.levers, annualOptionCost: opt.best.premium, expectedAnnualLoss: opt.best.eal, cvar90: opt.best.cvar90,
        nothingHeld: { expectedAnnualLoss: opt.none.eal, cvar90: opt.none.cvar90 } };
    }
    return out;
  }

  var api = { run: run, SPEC_VERSION: SPEC_VERSION, RESULT_VERSION: RESULT_VERSION };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasApi = api;
})(typeof window !== "undefined" ? window : globalThis);
