/*
 * dynamics.js — the Atlas's time-phased simulation (v3).
 *
 * v2 solved one "during the disruption" network and drained DC buffers against it. Real
 * disruptions unfold: they ramp up, peak and fade; freight rates spike and decay with a lag;
 * planners react a week or so late; ships already at sea divert mid-voyage or queue at a
 * closed canal; strikes leave port backlogs that take weeks to clear. This module simulates
 * all of that day by day:
 *
 *   - Event profiles: severity s(t) ramps 0→1 over `onset` days, holds for the peak duration
 *     L, then fades over `recovery` days. Rates follow u(t): rise over the onset, then decay
 *     with a half-life after the event ends. Defaults per event type; overridable per event.
 *   - Planner: re-plans weekly from the conditions it could see `reactionDays` ago (min-cost
 *     flow, cached per quantised condition level). A control-tower lever shortens the lag.
 *   - Shipments: one cohort per path per day. Export leg → origin-port queue → sailing, with
 *     each chokepoint reached at its fraction of the voyage (closed → queue) → destination-
 *     port queue → inland leg → DC. When the plan reroutes a service, cohorts still short of
 *     the abandoned chokepoint divert from where they are.
 *   - Capacities: ports clear at max(baseline flow × (1 + portHeadroom), contracted
 *     allotments) × the event's capacity factor; chokepoints clear a queue at baseline flow ×
 *     (1 + chokeHeadroom). Calibrated in engine/validation.js (Ever Given backlog cleared in
 *     ~5 days; 2024 East Coast strike backlog spread over ~3 weeks).
 *   - DCs: daily inventory with an order-up-to cap, lost sales when empty, optional air top-up.
 *
 * Costs are measured per TEU against the baseline plan's average cost, plus extra carrying
 * cost for every day a TEU arrives later than planned, plus air freight and lost sales.
 *
 * Pure. Browser global window.AtlasDynamics; CommonJS for node --test.
 */
(function (root) {
  "use strict";
  var M = root.AtlasModel || (typeof require === "function" ? require("./model.js") : null);
  var Sea = root.AtlasSea || (typeof require === "function" ? require("./seagraph.js") : null);

  // ------------------------------------------------------------------ event profiles
  // onset/recovery in days; rateHalfLife = days for a rate spike to halve once the event ends.
  var PROFILES = {
    geopolitical: { onset: 14, recovery: 60, rateHalfLife: 60 },
    weather: { onset: 1, recovery: 3, rateHalfLife: 14 },
    accident: { onset: 0, recovery: 0, rateHalfLife: 21 },
    strike: { onset: 0, recovery: 0, rateHalfLife: 14 },
    pandemic: { onset: 7, recovery: 21, rateHalfLife: 45 },
    congestion: { onset: 30, recovery: 60, rateHalfLife: 60 },
    cyber: { onset: 0, recovery: 3, rateHalfLife: 7 },
    earthquake: { onset: 0, recovery: 14, rateHalfLife: 14 },
    natural: { onset: 1, recovery: 7, rateHalfLife: 14 }
  };
  function profileOf(ev) {
    var d = PROFILES[ev.type] || { onset: 3, recovery: 7, rateHalfLife: 21 };
    var o = ev.profile || {};
    return { onset: o.onset != null ? o.onset : d.onset, recovery: o.recovery != null ? o.recovery : d.recovery, rateHalfLife: o.rateHalfLife || d.rateHalfLife };
  }
  // severity s(t) for an event starting at day 0 with peak length L
  function sev(t, L, pr) {
    if (t < 0) return 0;
    if (t < pr.onset) return t / pr.onset;
    if (t < pr.onset + L) return 1;
    if (pr.recovery > 0 && t < pr.onset + L + pr.recovery) return 1 - (t - pr.onset - L) / pr.recovery;
    return 0;
  }
  // rate index u(t): rises over the onset (at least a week), holds, then decays after the event
  function rateIdx(t, L, pr) {
    if (t < 0) return 0;
    var end = pr.onset + L;
    if (t <= end) return Math.min(1, t / Math.max(7, pr.onset));
    return Math.min(1, end / Math.max(7, pr.onset)) * Math.pow(0.5, (t - end) / pr.rateHalfLife);
  }

  function scaledEvent(ev, s, u) {
    var e = ev.effects || {}, o = { closed: [], choke: {}, ports: {}, supply: {}, uplift: {} };
    if (s >= 0.5) o.closed = (e.closed || []).slice();
    Object.keys(e.choke || {}).forEach(function (w) { o.choke[w] = { cap: 1 - s * (1 - e.choke[w].cap), delay: (e.choke[w].delay || 0) * s }; });
    Object.keys(e.ports || {}).forEach(function (k) { o.ports[k] = { cap: 1 - s * (1 - e.ports[k].cap), delay: (e.ports[k].delay || 0) * s }; });
    Object.keys(e.supply || {}).forEach(function (f) { o.supply[f] = 1 - s * (1 - e.supply[f]); });
    Object.keys(e.uplift || {}).forEach(function (t) { o.uplift[t] = e.uplift[t] * u; });
    return { id: ev.id, effects: o };
  }
  function condAt(events, levels) {
    var evs = [];
    events.forEach(function (ev, i) { var l = levels[i]; if (l.s > 0 || l.u > 0) evs.push(scaledEvent(ev, l.s, l.u)); });
    return M.conditions(evs);
  }
  var q4 = function (x) { return Math.round(x * 4) / 4; };
  var q20 = function (x) { return Math.round(x * 20) / 20; };

  // ------------------------------------------------------------------ prepare
  function prepare(data, net, events, levers, overrides) {
    overrides = overrides || {}; levers = levers || {};
    var p = M.params(data, overrides);
    p.portHeadroom = overrides.portHeadroom != null ? overrides.portHeadroom : (data.defaults.portHeadroom != null ? data.defaults.portHeadroom : 0.15);
    p.chokeHeadroom = overrides.chokeHeadroom != null ? overrides.chokeHeadroom : (data.defaults.chokeHeadroom != null ? data.defaults.chokeHeadroom : 1.2);
    p.waitOutDays = overrides.waitOutDays != null ? overrides.waitOutDays : (data.defaults.waitOutDays != null ? data.defaults.waitOutDays : 7);
    p.rebuildRate = overrides.rebuildRate != null ? overrides.rebuildRate : (data.defaults.rebuildRate != null ? data.defaults.rebuildRate : 0.2);
    var R = overrides.reactionDays != null ? overrides.reactionDays : (data.defaults.reactionDays != null ? data.defaults.reactionDays : 7);
    if (levers.controlTower && data.levers.controlTower) R = Math.min(R, data.levers.controlTower.reactionDays);
    var baseEvents = overrides.baseEvents || [];
    var scen = events.filter(function (e) { return baseEvents.indexOf(e) < 0; });
    // constant events (live steady state, or the base) sit at full severity for the whole run
    var all = baseEvents.map(function (e) { return { ev: e, constant: true, inBase: true }; })
      .concat(scen.map(function (e) { return { ev: e, constant: !!e.steadyState, inBase: false, pr: profileOf(e) }; }));
    var evList = all.map(function (x) { return x.ev; });

    var baseLevels = all.map(function (x) { return x.inBase ? { s: 1, u: 1 } : { s: 0, u: 0 }; });
    var base = M.evaluate(net, condAt(evList, baseLevels), levers, p);

    // baseline flows and contracted allotments by port and chokepoint (TEU/week)
    var portIn = {}, portOut = {}, allotIn = {}, allotOut = {}, chokeFlow = {};
    base.services.forEach(function (sv) { if (sv.ok) { allotIn[sv.to] = (allotIn[sv.to] || 0) + sv.cap; allotOut[sv.from] = (allotOut[sv.from] || 0) + sv.cap; } });
    base.paths.forEach(function (pt) {
      if (pt.short || !pt.service) return;
      portIn[pt.service.to] = (portIn[pt.service.to] || 0) + pt.flow;
      portOut[pt.service.from] = (portOut[pt.service.from] || 0) + pt.flow;
      (pt.service.chokes || []).forEach(function (w) { chokeFlow[w] = (chokeFlow[w] || 0) + pt.flow; });
    });
    var portCapWeek = function (code, dir, factor) {
      var flow = dir === "in" ? portIn[code] || 0 : portOut[code] || 0, allot = dir === "in" ? allotIn[code] || 0 : allotOut[code] || 0;
      // planning capacity: contracted allotments, or normal flow plus surge headroom if more
      return Math.max(flow * (1 + p.portHeadroom), allot) * factor;
    };

    var plans = {};
    function planFor(levels) {
      var key = levels.map(function (l) { return q4(l.s) + "/" + q4(l.u); }).join("|");
      if (plans[key]) return plans[key];
      var ql = levels.map(function (l) { return { s: q4(l.s), u: q4(l.u) }; });
      var cond = condAt(evList, ql);
      if (p.extraUplift && cond.active) cond.upliftAll = (cond.upliftAll || 0) + p.extraUplift;
      var caps = {};
      Object.keys(Object.assign({}, allotIn, allotOut)).forEach(function (code) {
        var f = (cond.ports[code] || { cap: 1 }).cap;
        caps[code] = { inWeek: portCapWeek(code, "in", f), outWeek: portCapWeek(code, "out", f) };
      });
      var sol = M.evaluate(net, cond, levers, Object.assign({}, p, { portCaps: caps }));
      var supplyPlan = {};
      sol.paths.forEach(function (pt) { if (!pt.short) supplyPlan[pt.factory] = (supplyPlan[pt.factory] || 0) + pt.flow; });
      var paths = sol.paths.filter(function (pt) { return !pt.short && pt.flow > 1e-6; }).map(function (pt) {
        var o = { key: pt.key, flow: pt.flow, factory: pt.factory, dc: pt.dc, product: pt.product, standby: pt.standby, mode: pt.mode, comps: pt.comps, exportDays: 0, importDays: 0, directDays: 0, svc: null };
        pt.legs.forEach(function (l) {
          if (l.kind === "export") { o.exportDays = l.days; o.oport = l.to; }
          else if (l.kind === "import") { o.importDays = l.days; o.dport = l.from; }
          else if (l.kind === "direct") o.directDays = l.days;
          else if (l.kind === "service") o.svc = l.svc;
        });
        o.fixedPerTeu = (pt.comps.production || 0) + (pt.comps.inland || 0) + (pt.comps.freight || 0) + (pt.comps.carrying || 0);
        o.plannedDays = pt.days;
        return o;
      });
      var svcRoute = {};
      sol.services.forEach(function (sv) { svcRoute[sv.id] = sv.ok ? { via: sv.route.via.join(">"), days: sv.days, chokes: (sv.chokeFrac || []).map(function (c) { return c.wp; }) } : null; });
      var inFlow = {}, outFlow = {};
      paths.forEach(function (pt) { if (pt.svc) { inFlow[pt.dport] = (inFlow[pt.dport] || 0) + pt.flow; outFlow[pt.oport] = (outFlow[pt.oport] || 0) + pt.flow; } });
      plans[key] = { key: key, sol: sol, cond: cond, paths: paths, supplyPlan: supplyPlan, svcRoute: svcRoute, inFlow: inFlow, outFlow: outFlow, standby: sol.paths.some(function (pt) { return pt.standby && pt.flow > 1e-6 && !pt.short; }) };
      return plans[key];
    }

    var basePlan = planFor(baseLevels);
    var basePerTeu = base.servedTotal ? base.opCostWeek / base.servedTotal : 0;
    var maxDays = basePlan.paths.reduce(function (a, pt) { return Math.max(a, pt.plannedDays); }, 0);
    var carry = p.valuePerTeu * (p.carryingRatePct / 100) / 365;
    // product families (one "All goods" family for networks without a mix)
    var products = M.productsOf(net, p), prodById = {}, carryP = {}, basePerTeuP = {}, baseCompsP = {};
    products.forEach(function (pr) {
      prodById[pr.id] = pr;
      carryP[pr.id] = pr.valuePerTeu * (p.carryingRatePct / 100) / 365;
      var bp = (base.byProduct || {})[pr.id];
      basePerTeuP[pr.id] = bp && bp.served ? bp.opCost / bp.served : basePerTeu;
      baseCompsP[pr.id] = {};
      if (bp && bp.served) Object.keys(bp.comps).forEach(function (k) { baseCompsP[pr.id][k] = bp.comps[k] / bp.served; });
    });
    var supplyCap = {};
    net.factories.forEach(function (f) { supplyCap[f.id] = f; });

    return {
      data: data, net: net, p: p, levers: levers, R: R, all: all, evList: evList, base: base, basePlan: basePlan,
      basePerTeu: basePerTeu, planFor: planFor, chokeFlow: chokeFlow, portIn: portIn, portOut: portOut, allotIn: allotIn, allotOut: allotOut,
      portCapWeek: portCapWeek, warmup: Math.ceil(maxDays) + 3, carry: carry, factories: supplyCap,
      products: products, prodById: prodById, carryP: carryP, basePerTeuP: basePerTeuP, baseCompsP: baseCompsP,
      air: levers.airBridge ? { capDay: p.air.capPerDc / 7, ramp: p.ramp.airBridge + p.air.days, cost: p.air.costPerTeu } : null
    };
  }

  // ------------------------------------------------------------------ run
  // durations: peak length per scenario event (array aligned with ctx.all, constants ignored)
  // horizon: for steady-state-only scenarios (live conditions), the number of days to cost.
  function run(ctx, durations, rateMult, keep, horizon) {
    rateMult = rateMult == null ? 1 : rateMult;
    var all = ctx.all, p = ctx.p, net = ctx.net, carry = ctx.carry;
    var L = all.map(function (x, i) { return x.constant ? 0 : (durations && durations[i] != null ? durations[i] : (x.ev.duration ? x.ev.duration.actual : 30)); });
    var eventEnd = 0, windowEnd = 0;
    all.forEach(function (x, i) { if (!x.constant) { eventEnd = Math.max(eventEnd, x.pr.onset + L[i]); windowEnd = Math.max(windowEnd, x.pr.onset + L[i] + x.pr.recovery); } });
    var steadyOnly = all.every(function (x) { return x.constant; });
    if (steadyOnly) eventEnd = windowEnd = horizon || 90;

    var lvT = null, lvV = null;
    function levelsAt(t) {
      if (t === lvT) return lvV;
      var v = all.map(function (x, i) { return x.constant ? { s: 1, u: 1 } : { s: sev(t, L[i], x.pr), u: rateIdx(t, L[i], x.pr) }; });
      if (t === curT) { lvT = t; lvV = v; }
      return v;
    }
    // actual (physical) conditions, cached at 5% resolution
    var actCache = {}, actT = null, actV = null;
    function actualAt(t) {
      if (t === actT) return actV;
      var lv = levelsAt(t), key = lv.map(function (l) { return q20(l.s); }).join("|");
      if (!actCache[key]) actCache[key] = condAt(ctx.evList, lv.map(function (l) { return { s: q20(l.s), u: 0 }; }));
      if (t === curT) { actT = t; actV = actCache[key]; }
      return actCache[key];
    }
    // market freight surcharge rate for a trade on day t (share of base rate), cached per day
    var upDay = null, upCache = {};
    function upliftAt(trade, t) {
      if (upDay !== t) { upDay = t; upCache = {}; }
      if (upCache[trade] != null) return upCache[trade];
      var lv = levelsAt(t), m = 0;
      all.forEach(function (x, i) {
        var u = x.ev.effects && x.ev.effects.uplift; if (!u) return;
        var v = u[trade] != null ? u[trade] : (u["*"] || 0);
        m = Math.max(m, v * lv[i].u * (x.constant ? 1 : rateMult));
      });
      m += (p.extraUplift && lv.some(function (l) { return l.s > 0; }) ? p.extraUplift : 0);
      upCache[trade] = m;
      return m;
    }

    // Stock items: one per DC and product family. Extra safety stock (the buffer lever) applies to
    // every family, or only critical ones when levers.bufferScope === "critical".
    var scope = ctx.levers.bufferScope || "all";
    var dcs = [];
    net.dcs.forEach(function (d) {
      ctx.products.forEach(function (pr) {
        var dem = M.demandOf(d, pr); if (dem <= 0) return;
        var extra = (ctx.levers.buffer || 0) * (scope === "all" || pr.critical ? 1 : 0);
        var buf = (d.bufferDays || 0) + extra, D = dem / 7;
        dcs.push({ id: d.id, key: d.id + "|" + pr.id, product: pr.id, pr: pr, name: d.name, demand: dem, D: D, I0: buf * D, I: buf * D, buffer: buf,
          lost: 0, air: 0, tts: null, arrivals: 0, pending: 0, trace: keep ? [] : null, lostDays: keep ? [] : null });
      });
    });
    // air is shared per DC: the most valuable families get it first
    dcs.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : b.pr.lostSaleCostPerTeu - a.pr.lostSaleCostPerTeu; });
    var dcIdx = {}; dcs.forEach(function (d, i) { dcIdx[d.key] = i; });
    var Dtot = dcs.reduce(function (a, d) { return a + d.D; }, 0);
    var compsP = {}, dispatchedP = {}; ctx.products.forEach(function (pr) { compsP[pr.id] = { production: 0, inland: 0, freight: 0, carrying: 0, surcharge: 0 }; dispatchedP[pr.id] = 0; });

    var buckets = {}, curT = -Infinity; // day -> [cohort events]
    function sched(c, day, stage) { var k = Math.max(curT, Math.round(day)); c.stage = stage; c.at = k; (buckets[k] = buckets[k] || []).push({ c: c, v: c.v }); }
    var outQ = {}, inQ = {}, chQ = {}; // FIFO arrays of cohorts
    var atSea = {}; // svcId -> Set of cohorts that may still divert
    var comps = { production: 0, inland: 0, freight: 0, carrying: 0, surcharge: 0, delay: 0, air: 0, lostMargin: 0 };
    var opDelta = 0, extraCarry = 0, dispatched = 0;
    // fixed-rate contracts: only the uncovered share of any surcharge is paid
    var hedgeF = ctx.levers.rateHedge ? 1 - (p.hedgeCoverage || 0) : 1;
    var series = keep ? { served: [], backlog: [], rate: [], severity: [], chokePass: {}, famLost: {} } : null;
    var chokePass = {}, portPass = {};

    var legacy = []; // [{paths, until}] old-plan paths kept running while a longer pipeline fills
    var refillDue = {}; // day -> {dcIdx: teu}
    var R = ctx.R, plan = ctx.basePlan, planSince = null, standbyFrom = null, firstDisruptPlan = null;
    var t0 = -ctx.warmup, tMax = Math.ceil(windowEnd) + 365, tEnd = Math.ceil(windowEnd) + 30, recoveredAt = null, settledRun = 0;

    for (var t = t0; t <= tMax; t++) {
      curT = t;
      // ---- weekly re-plan from the conditions visible R days ago
      if ((t - t0) % 7 === 0) {
        var seen = levelsAt(t - R), now = levelsAt(t);
        var np = ctx.planFor(seen.map(function (l, i) {
          var lv = { s: Math.min(l.s, now[i].s), u: Math.min(l.u, now[i].u) };
          // Wait it out if the disruption isn't expected to last another week: the planner
          // expects the event's typical length, and once it overruns that, expects it to run
          // on about half as long again as it already has.
          var x = all[i];
          if (!x.constant && lv.s > 0) {
            var typical = x.pr.onset + (x.ev.duration ? x.ev.duration.mode : 30);
            if (Math.max(typical - t, 0.5 * t) < ctx.p.waitOutDays) lv.s = 0;
          }
          return lv;
        }));
        if (np !== plan) {
          divert(plan, np, t);
          Object.keys(chQ).forEach(function (w) {
            chQ[w].slice().forEach(function (c) { var nr = np.svcRoute[c.pt.svc.id]; if (nr && nr.chokes.indexOf(w) < 0) divertCohort(c, t, nr); });
          });
          overlap(plan, np, t);
          plan = np;
          if (plan !== ctx.basePlan && firstDisruptPlan === null) firstDisruptPlan = t;
          if (plan.standby && standbyFrom === null) standbyFrom = t;
        }
      }
      var act = actualAt(t);

      // ---- dispatch today's cohorts (current plan + any overlapping legacy paths)
      legacy = legacy.filter(function (g) { return t < g.until; });
      var todays = legacy.length ? plan.paths.concat.apply(plan.paths, legacy.map(function (g) { return g.paths; })) : plan.paths;
      todays.forEach(function (pt) {
        if (pt.standby && (standbyFrom === null || t < standbyFrom + p.ramp.dualSource)) return;
        var f = ctx.factories[pt.factory], planned = plan.supplyPlan[pt.factory] || 0;
        var actualCap = f ? f.cap * (act.supply[pt.factory] == null ? 1 : act.supply[pt.factory]) + (plan.standby && f.standby ? f.standby.cap : 0) + (plan.standby && p.surge[pt.factory] ? p.surge[pt.factory] : 0) : Infinity;
        var teu = pt.flow / 7 * Math.min(1, planned > 0 ? actualCap / planned : 1);
        if (teu <= 1e-9) return;
        var c = { teu: teu, pt: pt, dep: t, now: t, v: 0, planArr: t + pt.plannedDays };
        if (t >= 0) {
          var sur = pt.svc ? pt.svc.rate * upliftAt(pt.svc.trade, t) * hedgeF : 0;
          var cost = pt.fixedPerTeu + sur, cp = compsP[pt.product];
          opDelta += teu * (cost - ctx.basePerTeuP[pt.product]); dispatched += teu; dispatchedP[pt.product] += teu;
          cp.production += teu * (pt.comps.production || 0); cp.inland += teu * (pt.comps.inland || 0);
          cp.freight += teu * (pt.comps.freight || 0); cp.carrying += teu * (pt.comps.carrying || 0); cp.surcharge += teu * sur;
        }
        if (pt.svc) sched(c, t + pt.exportDays, "oport");
        else sched(c, t + pt.directDays, "dc");
      });

      // ---- move cohorts that reach a stage today
      drainToday(t);

      // ---- queues release up to today's capacity
      // terminals work through a backlog at +portHeadroom over the volume they normally handle
      // for this network (the larger of the baseline and the current plan)
      // …but never more than the port can take under today's actual conditions
      var physCap = function (code, dir, f) {
        var vol = dir === "in" ? Math.max(plan.inFlow[code] || 0, ctx.portIn[code] || 0) : Math.max(plan.outFlow[code] || 0, ctx.portOut[code] || 0);
        if (vol <= 0) vol = (dir === "in" ? ctx.allotIn[code] : ctx.allotOut[code]) || 1e6;
        return Math.min(vol * (1 + p.portHeadroom), ctx.portCapWeek(code, dir, f)) / 7;
      };
      Object.keys(outQ).forEach(function (code) {
        var f = (act.ports[code] || { cap: 1 }).cap;
        release(outQ[code], physCap(code, "out", f), function (c) { startSailing(c, t); });
      });
      Object.keys(chQ).forEach(function (w) {
        if (act.closed[w]) return;
        var base = ctx.chokeFlow[w] || 0, f = (act.choke[w] || { cap: 1 }).cap;
        var cap = base > 0 ? base / 7 * (1 + p.chokeHeadroom) * f : Infinity;
        release(chQ[w], cap, function (c) { passChoke(c, t, w); });
      });
      Object.keys(inQ).forEach(function (code) {
        var f = (act.ports[code] || { cap: 1 }).cap;
        release(inQ[code], physCap(code, "in", f), function (c) {
          if (t >= 0) { portPass[code] = portPass[code] || {}; portPass[code][t] = (portPass[code][t] || 0) + c.teu; }
          sched(c, t + c.pt.importDays, "dc");
        });
      });
      // cargo released today can reach its next stage today (e.g. a strait right outside the port)
      drainToday(t);

      // ---- DCs: demand, air top-up, lost sales
      var lostToday = 0;
      var due = refillDue[t]; delete refillDue[t];
      if (due) Object.keys(due).forEach(function (i) { dcs[i].arrivals += due[i]; dcs[i].pending -= due[i]; });
      var leadNow = plan.lead || (plan.lead = leadByDc(plan));
      var shortNow = plan.shortBy || (plan.shortBy = shortByItem(plan));
      var airLeft = {};
      dcs.forEach(function (d, i) {
        if (t < 0) { d.arrivals = 0; return; } // warm-up: the pipeline fills, stock held at target
        d.I = Math.min(d.I0, d.I + d.arrivals - d.D); d.arrivals = 0;
        if (d.I < -1e-9 && ctx.air && d.pr.air && firstDisruptPlan !== null && t >= firstDisruptPlan + ctx.air.ramp) {
          if (airLeft[d.id] == null) airLeft[d.id] = ctx.air.capDay;
          var xa = Math.min(airLeft[d.id], -d.I); d.air += xa; d.I += xa; airLeft[d.id] -= xa;
        }
        var lostD = 0;
        if (d.I < -1e-9) { lostD = -d.I; d.lost += lostD; lostToday += lostD; if (d.tts === null) d.tts = t; d.I = 0; }
        if (d.trace) d.trace.push(d.I);
        if (d.lostDays) d.lostDays.push(lostD);
        var gap = d.I0 - d.I - d.pending;
        if (gap > 1e-6 && !(shortNow[d.key] > 1e-6) && leadNow[d.key]) {
          var x = Math.min(gap, p.rebuildRate * d.D), day = t + Math.max(1, Math.round(leadNow[d.key]));
          (refillDue[day] = refillDue[day] || {})[i] = ((refillDue[day] || {})[i] || 0) + x;
          d.pending += x;
        }
      });
      if (t < 0) continue;

      // carrying cost on cargo sitting in queues
      var backlog = (series || t >= eventEnd) ? qTeu(outQ) + qTeu(inQ) + qTeu(chQ) : 0;
      if (series) {
        var lv = levelsAt(t);
        series.served.push(Dtot ? 1 - lostToday / Dtot : 1);
        var fl = {}; dcs.forEach(function (it) { fl[it.product] = (fl[it.product] || 0) + (it.lostDays ? it.lostDays[it.lostDays.length - 1] || 0 : 0); });
        Object.keys(fl).forEach(function (k) { (series.famLost[k] = series.famLost[k] || []).push(fl[k]); });
        series.backlog.push(backlog);
        series.severity.push(Math.max.apply(null, lv.map(function (l, i) { return all[i].constant ? 0 : l.s; }).concat([0])));
        series.rate.push(Math.max.apply(null, lv.map(function (l, i) { return all[i].constant ? 0 : l.u; }).concat([0])));
      }

      // ---- stop once things are back to normal after the window
      if (t >= eventEnd) {
        var ok = lostToday < 1e-6 && backlog < 0.5 && dcs.every(function (d) { return d.I >= 0.98 * d.I0 || d.I + d.pending >= 0.98 * d.I0 && d.I >= 0.9 * d.I0; });
        settledRun = ok ? settledRun + 1 : 0;
        if (ok && settledRun === 1) recoveredAt = t;
        if (!ok) recoveredAt = null;
        if (t >= tEnd && settledRun >= 7) break;
      }
    }
    var lastDay = t;

    // ---- helpers (closures over this run's state)
    // flow-weighted planned lead time per stock item (DC|family)
    function leadByDc(pl) {
      var w = {}, f = {};
      pl.paths.forEach(function (pt) { var k = pt.dc + "|" + pt.product; w[k] = (w[k] || 0) + pt.flow * pt.plannedDays; f[k] = (f[k] || 0) + pt.flow; });
      var o = {}; Object.keys(f).forEach(function (k) { o[k] = f[k] ? w[k] / f[k] : 0; }); return o;
    }
    function shortByItem(pl) {
      var o = {}; pl.sol.paths.forEach(function (pt) { if (pt.short) { var k = pt.dc + "|" + pt.product; o[k] = (o[k] || 0) + pt.flow; } }); return o;
    }
    // Switching a DC onto slower supply (e.g. back onto the canal after a drought) would leave
    // a gap while the longer pipeline fills; planners keep the old, still-open lanes running for
    // the difference. Only lanes whose route is unchanged under the new plan qualify.
    function overlap(oldPlan, newPlan, t) {
      var lo = leadByDc(oldPlan), ln = leadByDc(newPlan);
      Object.keys(ln).forEach(function (dc) {
        var extra = ln[dc] - (lo[dc] || ln[dc]);
        if (extra < 1) return;
        // only the volume the new plan takes off a lane that is still open and unchanged
        var newFlow = {}; newPlan.paths.forEach(function (pt) { newFlow[pt.key] = (newFlow[pt.key] || 0) + pt.flow; });
        var keep = [];
        oldPlan.paths.forEach(function (pt) {
          if (pt.dc + "|" + pt.product !== dc) return;
          var moved = pt.flow - (newFlow[pt.key] || 0);
          if (moved <= 1e-6) return;
          if (pt.svc) { var a = oldPlan.svcRoute[pt.svc.id], b = newPlan.svcRoute[pt.svc.id]; if (!a || !b || a.via !== b.via) return; }
          keep.push(Object.assign({}, pt, { flow: moved }));
        });
        if (keep.length) legacy.push({ paths: keep, until: t + Math.round(extra) });
      });
    }
    function drainToday(t) {
      for (var pass = 0; buckets[t] && pass < 20; pass++) { // a cohort can clear several stages in one day
        var today = buckets[t];
        delete buckets[t];
        today.forEach(function (e) {
          var c = e.c; if (e.v !== c.v) return; c.now = t;
          if (c.stage === "oport") (outQ[c.pt.oport] = outQ[c.pt.oport] || []).push(c);
          else if (c.stage === "choke") reachChoke(c, t);
          else if (c.stage === "dport") { removeAtSea(c); (inQ[c.pt.dport] = inQ[c.pt.dport] || []).push(c); }
          else if (c.stage === "dc") deliver(c, t);
        });
      }
    }
    function qTeu(Q) { var s = 0; Object.keys(Q).forEach(function (k) { Q[k].forEach(function (c) { s += c.teu; }); }); return s; }
    function release(Q, capDay, onOut) {
      var cap = capDay;
      while (Q.length && cap > 1e-9) {
        var c = Q[0];
        if (c.teu <= cap + 1e-9) { cap -= c.teu; Q.shift(); onOut(c); }
        else { // split the cohort: part moves today, the rest waits
          var part = Object.assign({}, c, { teu: cap, v: 0 });
          if (c.pt.svc && atSea[c.pt.svc.id] && atSea[c.pt.svc.id].has(c)) atSea[c.pt.svc.id].add(part);
          c.teu -= cap; cap = 0; onOut(part);
        }
      }
    }
    function startSailing(c, t) {
      c.sail = t; c.ci = 0; c.svcDays = c.pt.svc.days; c.route = (plan.svcRoute[c.pt.svc.id] || {}).via || "";
      (atSea[c.pt.svc.id] = atSea[c.pt.svc.id] || new Set()).add(c);
      nextLeg(c, t);
    }
    function nextLeg(c, t) {
      var cf = c.pt.svc.chokeFrac || [];
      if (c.ci < cf.length) sched(c, Math.max(t, c.sail + cf[c.ci].frac * c.svcDays), "choke");
      else sched(c, Math.max(t + 1, c.sail + c.svcDays), "dport");
    }
    function reachChoke(c, t) {
      var w = c.pt.svc.chokeFrac[c.ci].wp, act = actualAt(t);
      if (act.closed[w]) {
        // left port before the reroute: if the plan now avoids this chokepoint, turn round here
        var nr = plan.svcRoute[c.pt.svc.id];
        if (nr && nr.chokes.indexOf(w) < 0 && divertCohort(c, t, nr)) return;
        (chQ[w] = chQ[w] || []).push(c);
      } else if (chQ[w] && chQ[w].length) (chQ[w] = chQ[w] || []).push(c);
      else passChoke(c, t, w);
    }
    function passChoke(c, t, w) {
      if (t >= 0) chokePass[w] = chokePass[w] || {}, chokePass[w][t] = (chokePass[w][t] || 0) + c.teu;
      // time spent waiting pushes the rest of the voyage back
      var cf = c.pt.svc.chokeFrac[c.ci], planned = c.sail + cf.frac * c.svcDays;
      if (t > planned) c.sail += (t - planned);
      c.ci++;
      nextLeg(c, t);
    }
    function removeAtSea(c) { if (c.pt.svc && atSea[c.pt.svc.id]) atSea[c.pt.svc.id].delete(c); }
    // The plan has moved a service onto a longer route: cohorts that haven't yet passed the
    // chokepoint it now avoids turn round from where they are.
    function divert(oldPlan, newPlan, t) {
      Object.keys(atSea).forEach(function (sid) {
        var nr = newPlan.svcRoute[sid], or = oldPlan.svcRoute[sid];
        if (!nr || !or || nr.via === or.via || nr.days <= or.days) return;
        atSea[sid].forEach(function (c) { divertCohort(c, t, nr); });
      });
    }
    // Turn a ship onto the plan's longer route if it hasn't yet passed a chokepoint that route
    // avoids. Returns true if it diverted.
    function divertCohort(c, t, nr) {
      var cf = c.pt.svc.chokeFrac || [];
      var pending = cf.slice(c.ci).map(function (x) { return x.wp; });
      if (!pending.some(function (w) { return nr.chokes.indexOf(w) < 0; })) return false;
      // where the ship is now: never past the chokepoint it is waiting at or heading for
      var pos = Math.min(cf[c.ci].frac, Math.max(0, (t - c.sail) / c.svcDays));
      var w0 = cf[c.ci].wp; if (chQ[w0]) { var i = chQ[w0].indexOf(c); if (i >= 0) chQ[w0].splice(i, 1); }
      c.v++; c.ci = cf.length; // no more chokepoints on the long way round (modelled as open)
      var remaining = Math.max(1, nr.days - pos * c.svcDays);
      c.sail = t - pos * c.svcDays; c.svcDays = pos * c.svcDays + remaining;
      sched(c, t + remaining, "dport");
      return true;
    }
    function deliver(c, t) {
      var d = dcs[dcIdx[c.pt.dc + "|" + c.pt.product]];
      if (t >= 0 && d) {
        var late = t - c.planArr;
        if (late > 1.5) { extraCarry += c.teu * late * (ctx.carryP[c.pt.product] || carry); }
      }
      if (d) d.arrivals += c.teu;
    }

    // ---- totals
    var lostTeu = dcs.reduce(function (a, d) { return a + d.lost; }, 0), airTeu = dcs.reduce(function (a, d) { return a + d.air; }, 0);
    var tts = dcs.reduce(function (a, d) { return d.tts === null ? a : (a === null ? d.tts : Math.min(a, d.tts)); }, null);
    // component deltas vs each family's baseline per-TEU cost, so the breakdown adds up and a
    // shift in the mix (e.g. cheap families going short) isn't mistaken for a saving
    var out = { production: 0, inland: 0, freight: 0, carrying: 0, surcharge: 0 };
    ctx.products.forEach(function (pr) {
      var cp = compsP[pr.id], bc = ctx.baseCompsP[pr.id], n = dispatchedP[pr.id];
      Object.keys(out).forEach(function (k) { out[k] += cp[k] - (bc[k] || 0) * (k === "surcharge" ? hedgeF : 1) * n; });
    });
    out.carrying += extraCarry; // late arrivals: queues, diversions
    if (airTeu > 0 && ctx.air) out.air = airTeu * ctx.air.cost;
    out.lostMargin = dcs.reduce(function (a, d) { return a + d.lost * d.pr.lostSaleCostPerTeu; }, 0);
    var total = 0; Object.keys(out).forEach(function (k) { total += out[k]; });

    // per family: overall fill rate and the worst rolling 4-week fill (what service targets are judged on)
    var days = lastDay + 1;
    var famRes = ctx.products.map(function (pr) {
      var its = dcs.filter(function (d) { return d.product === pr.id; });
      var D = its.reduce(function (a, d) { return a + d.D; }, 0), lost = its.reduce(function (a, d) { return a + d.lost; }, 0);
      var worst = 1;
      if (keep && D > 0) {
        var daily = [];
        for (var k = 0; k < days; k++) daily.push(its.reduce(function (a, d) { return a + (d.lostDays[k] || 0); }, 0));
        var win = 28, acc = 0;
        for (var j = 0; j < daily.length; j++) { acc += daily[j]; if (j >= win) acc -= daily[j - win]; if (j >= win - 1 || j === daily.length - 1) worst = Math.min(worst, 1 - acc / (D * Math.min(win, j + 1))); }
      } else if (D > 0) worst = null;
      var tt = its.reduce(function (a, d) { return d.tts === null ? a : (a === null ? d.tts : Math.min(a, d.tts)); }, null);
      return { id: pr.id, name: pr.name, critical: !!pr.critical, air: !!pr.air, target: pr.fillTarget, valuePerTeu: pr.valuePerTeu, lostSaleCostPerTeu: pr.lostSaleCostPerTeu,
        demand: D * 7, lostTeu: lost, lostCost: lost * pr.lostSaleCostPerTeu, airTeu: its.reduce(function (a, d) { return a + d.air; }, 0), tts: tt,
        fill: D > 0 ? 1 - lost / (D * days) : 1, worst4w: worst, meets: worst == null ? null : worst >= pr.fillTarget - 1e-9 };
    });
    // per DC: families summed
    var dcRes = net.dcs.map(function (dd) {
      var its = dcs.filter(function (d) { return d.id === dd.id; });
      var trace = null;
      if (keep && its.length) { trace = []; for (var k = 0; k < its[0].trace.length; k++) trace.push(its.reduce(function (a, d) { return a + (d.trace[k] || 0); }, 0)); }
      var D = its.reduce(function (a, d) { return a + d.D; }, 0), lost = its.reduce(function (a, d) { return a + d.lost; }, 0);
      return { id: dd.id, name: dd.name, demand: dd.demand, buffer: (dd.bufferDays || 0) + (ctx.levers.buffer || 0), baseBuffer: dd.bufferDays || 0,
        tts: its.reduce(function (a, d) { return d.tts === null ? a : (a === null ? d.tts : Math.min(a, d.tts)); }, null),
        lostTeu: lost, airTeu: its.reduce(function (a, d) { return a + d.air; }, 0), trace: trace, servedShare: D > 0 ? 1 - lost / (D * days) : 1,
        byProduct: its.map(function (d) { return { product: d.product, tts: d.tts, lostTeu: d.lost, buffer: d.buffer }; }) };
    });

    var res = {
      total: total, comps: out, lostTeu: lostTeu, airTeu: airTeu, tts: tts,
      ttr: Math.round(windowEnd), eventEnd: Math.round(eventEnd), recoveredAt: recoveredAt, lastDay: lastDay,
      tail: recoveredAt === null ? null : Math.max(0, recoveredAt - Math.round(windowEnd)),
      dcs: dcRes, products: famRes, multiProduct: !(ctx.products.length === 1 && ctx.products[0].single),
      chokePass: chokePass, portPass: portPass, firstReplan: firstDisruptPlan
    };
    if (series) res.series = series;
    return res;
  }

  // ------------------------------------------------------------------ public API (v2-compatible shapes)
  function fullLevels(ctx) { return ctx.all.map(function () { return { s: 1, u: 1 }; }); }
  function scenarioDurations(ctx, overrides) {
    return ctx.all.map(function (x) { return x.constant ? null : (overrides && overrides.duration ? overrides.duration : (x.ev.duration ? x.ev.duration.actual : 30)); });
  }

  function analyse(data, net, events, levers, overrides) {
    overrides = overrides || {};
    var ctx = prepare(data, net, events, levers, overrides);
    var res = run(ctx, scenarioDurations(ctx, overrides), 1, true, overrides.duration);
    var peak = ctx.planFor(fullLevels(ctx));
    var steady = events.length > 0 && events.every(function (e) { return e.steadyState; });
    res.prep = { base: ctx.base, dis: peak.sol, cond: peak.cond, steady: steady, p: ctx.p, levers: levers, reactionDays: ctx.R };
    res.leverCost = M.leverAnnualCost(data, net, levers || {}, ctx.p);
    res.exposure = M.exposure(ctx.base);
    return res;
  }

  function quantilesTri(d, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var u = (i + 0.5) / n, a = d.min, c = d.mode, b = d.max;
      if (b <= a) { out.push(a); continue; }
      var f = (c - a) / (b - a);
      out.push(u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c)));
    }
    return out;
  }

  function monteCarlo(data, net, events, levers, overrides, runs, seed) {
    var ctx = prepare(data, net, events, levers, overrides);
    var rng = M.mulberry32(seed || 12345);
    runs = runs || 400;
    var xs = [], durs = [], shortRuns = 0, tails = [];
    for (var i = 0; i < runs; i++) {
      var du = ctx.all.map(function (x) { return x.constant ? null : M.triangular(rng, x.ev.duration.min, x.ev.duration.mode, x.ev.duration.max); });
      var m = 0.6 + 0.8 * rng();
      var r = run(ctx, du, m, false);
      xs.push(r.total); durs.push(r.eventEnd);
      if (r.tts !== null) shortRuns++;
      if (r.tail != null) tails.push(r.tail);
    }
    var sorted = xs.slice().sort(function (a, b) { return a - b; });
    var q = function (p) { var k = (sorted.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k); return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo); };
    var mean = xs.reduce(function (a, b) { return a + b; }, 0) / (xs.length || 1);
    return { runs: runs, mean: mean, p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), sorted: sorted, pShortfall: shortRuns / (runs || 1),
      meanDuration: durs.reduce(function (a, b) { return a + b; }, 0) / (durs.length || 1), meanTail: tails.length ? tails.reduce(function (a, b) { return a + b; }, 0) / tails.length : null };
  }

  // Expected annual loss over the library: each event's likelihood × its average cost over
  // `strata` duration quantiles (deterministic, so the ranking doesn't jitter between runs).
  function expectedAnnualLoss(data, net, levers, overrides, strata) {
    strata = strata || 6;
    var total = 0, byEvent = [];
    data.events.forEach(function (ev) {
      if (!ev.annualProb) return;
      if (overrides && overrides.baseEvents && overrides.baseEvents.some(function (b) { return b.id === ev.id; })) return;
      var o = Object.assign({}, overrides || {}); delete o.duration;
      var ctx = prepare(data, net, [ev], levers, o), i = ctx.all.length - 1;
      var qs = quantilesTri(ev.duration, strata), sum = 0;
      qs.forEach(function (L) { var du = ctx.all.map(function () { return null; }); du[i] = L; sum += run(ctx, du, 1, false).total; });
      var mean = sum / qs.length;
      byEvent.push({ id: ev.id, name: ev.name, p: ev.annualProb, mean: mean, eal: ev.annualProb * mean });
      total += ev.annualProb * mean;
    });
    return { total: total, byEvent: byEvent };
  }

  var LEVERS = ["buffer", "dualSource", "airBridge", "gateways", "rateHedge", "controlTower"];
  function combos(bufferDays, bufferScope) {
    var out = [];
    for (var mask = 0; mask < 64; mask++) out.push({ buffer: (mask & 1) ? bufferDays : 0, bufferScope: bufferScope || "all", dualSource: !!(mask & 2), airBridge: !!(mask & 4), gateways: !!(mask & 8), rateHedge: !!(mask & 16), controlTower: !!(mask & 32) });
    return out;
  }
  function scoreCombo(data, net, overrides, lv, strata) {
    var p = M.params(data, overrides);
    var eal = expectedAnnualLoss(data, net, lv, overrides, strata);
    var prem = M.leverAnnualCost(data, net, lv, p);
    return { levers: lv, eal: eal.total, premium: prem.total, total: eal.total + prem.total, byEvent: eal.byEvent };
  }
  function finishPortfolio(rows) {
    var none = rows[0];
    rows.forEach(function (r) { r.netValue = none.total - r.total; });
    return rows.slice().sort(function (a, b) { return a.total - b.total; });
  }
  function portfolio(data, net, overrides, bufferDays, strata, bufferScope) {
    return finishPortfolio(combos(bufferDays, bufferScope).map(function (lv) { return scoreCombo(data, net, overrides, lv, strata); }));
  }
  // Same, but yields between combinations so a page stays responsive; onProgress(done, total).
  function portfolioAsync(data, net, overrides, bufferDays, strata, onProgress, onDone, bufferScope) {
    var list = combos(bufferDays, bufferScope), rows = [], i = 0;
    (function step() {
      var until = Date.now() + 40;
      while (i < list.length && Date.now() < until) { rows.push(scoreCombo(data, net, overrides, list[i], strata)); i++; }
      if (onProgress) onProgress(i, list.length);
      if (i < list.length) setTimeout(step, 0); else onDone(finishPortfolio(rows));
    })();
  }

  var api = { PROFILES: PROFILES, profileOf: profileOf, sev: sev, rateIdx: rateIdx, prepare: prepare, run: run, analyse: analyse,
    monteCarlo: monteCarlo, expectedAnnualLoss: expectedAnnualLoss, portfolio: portfolio, portfolioAsync: portfolioAsync, quantilesTri: quantilesTri, LEVERS: LEVERS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasDynamics = api;
})(typeof window !== "undefined" ? window : globalThis);
