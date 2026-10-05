/*
 * model.js — the Atlas decision engine. Pure functions, no DOM.
 *
 * Pipeline for a scenario (a set of disruption events + a set of flexibility levers):
 *   1. conditions(events)      merge event effects: closed chokepoints, capacity factors,
 *                              queue/dwell delays, supply cuts, freight-rate uplifts.
 *   2. evaluate(net, cond, L)  route every ocean service over the sea graph under those
 *                              conditions, build a min-cost-flow network
 *                              (factories -> ports -> services -> ports -> DCs), solve it,
 *                              and decompose the flow into factory-to-DC paths.
 *   3. simulateDc(...)         day-by-day inventory at each DC: the buffer drains while the
 *                              re-planned supply is still on the water. Gives time-to-survive
 *                              (TTS: days until the first unmet demand) against the
 *                              time-to-recover (TTR: the disruption's duration) — the
 *                              Simchi-Levi stress-test pair — plus lost sales.
 *   4. analyse(...)            baseline vs disrupted: cost breakdown and TTS/TTR per DC.
 *   5. monteCarlo(...)         sample durations and rate shocks -> loss distribution.
 *   6. portfolio(...)          expected annual loss over the event library for each
 *                              combination of levers -> value of flexibility.
 *
 * Simplifications (stated in the UI's method notes): one aggregate commodity (TEU);
 * steady weekly flows; a lane's weekly capacity shrinks in proportion to a longer voyage
 * (same fleet, longer rotation); cargo already at sea on a lane that is shut (closed route
 * or zero port capacity) is not delivered during the disruption; recovery is immediate when
 * the disruption ends.
 *
 * Browser global window.AtlasModel; CommonJS for node --test.
 */
(function (root) {
  "use strict";

  var Sea = root.AtlasSea || (typeof require === "function" ? require("./seagraph.js") : null);
  var Flow = root.AtlasFlow || (typeof require === "function" ? require("./flow.js") : null);

  // ------------------------------------------------------------------ helpers
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function triangular(rng, a, c, b) { // min a, mode c, max b
    if (b <= a) return a;
    var u = rng(), f = (c - a) / (b - a);
    return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
  }
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    var i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  // ------------------------------------------------------------------ 1. conditions
  // Overlapping events combine conservatively: the tightest capacity, the longest delay,
  // the largest rate uplift per trade (uplifts don't stack — they're the same market).
  function conditions(events) {
    var c = { closed: {}, choke: {}, ports: {}, supply: {}, suppliers: {}, uplift: {}, upliftAll: 0, active: false, ids: [] };
    (events || []).forEach(function (ev) {
      if (!ev) return;
      var e = ev.effects || {};
      c.active = true; c.ids.push(ev.id);
      (e.closed || []).forEach(function (w) { c.closed[w] = true; });
      Object.keys(e.choke || {}).forEach(function (w) {
        var x = e.choke[w], cur = c.choke[w] || { cap: 1, delay: 0 };
        c.choke[w] = { cap: Math.min(cur.cap, x.cap == null ? 1 : x.cap), delay: Math.max(cur.delay, x.delay || 0) };
      });
      Object.keys(e.ports || {}).forEach(function (p) {
        var x = e.ports[p], cur = c.ports[p] || { cap: 1, delay: 0 };
        c.ports[p] = { cap: Math.min(cur.cap, x.cap == null ? 1 : x.cap), delay: Math.max(cur.delay, x.delay || 0) };
      });
      Object.keys(e.supply || {}).forEach(function (f) { c.supply[f] = Math.min(c.supply[f] == null ? 1 : c.supply[f], e.supply[f]); });
      Object.keys(e.suppliers || {}).forEach(function (s) { c.suppliers[s] = Math.min(c.suppliers[s] == null ? 1 : c.suppliers[s], e.suppliers[s]); });
      Object.keys(e.uplift || {}).forEach(function (t) {
        if (t === "*") c.upliftAll = Math.max(c.upliftAll, e.uplift[t]);
        else c.uplift[t] = Math.max(c.uplift[t] || 0, e.uplift[t]);
      });
    });
    return c;
  }
  function upliftFor(c, trade) { return Math.max(c.uplift[trade] || 0, c.upliftAll || 0); }

  // Turn the PortWatch snapshot into a "live conditions" event.
  // Chokepoints — container transits over the last 7 days vs the 2019–Oct 2023 average:
  // below 35% the chokepoint is treated as avoided by container lines (closed); 35–85% as a
  // capacity squeeze with queueing.
  // Ports — container port calls over the last 14 days vs the same baseline (port series are
  // noisier, so the bands are wider): below 35% the port is treated as nearly shut (capacity =
  // the ratio, floor 10%); 35–60% as reduced. Ports with too little traffic to judge are skipped.
  // opts.ports (optional): only these LOCODEs get port effects (e.g. the ports a network uses).
  function liveEvent(signals, opts) {
    opts = opts || {};
    var closeBelow = opts.closeBelow == null ? 0.35 : opts.closeBelow, squeezeBelow = opts.squeezeBelow == null ? 0.85 : opts.squeezeBelow;
    var portShut = opts.portShut == null ? 0.35 : opts.portShut, portReduced = opts.portReduced == null ? 0.6 : opts.portReduced;
    if (!signals || !signals.chokepoints || !Sea) return null;
    var byPw = {};
    Object.keys(Sea.CHOKES).forEach(function (wp) { byPw[Sea.CHOKES[wp].portwatch] = wp; });
    var eff = { closed: [], choke: {}, ports: {} }, notes = [], portNotes = [], asOf = null;
    Object.keys(signals.chokepoints).forEach(function (pw) {
      var s = signals.chokepoints[pw], wp = byPw[pw];
      if (!wp || s.ratio == null) return;
      if (!asOf || (s.asOf && s.asOf > asOf)) asOf = s.asOf;
      if (s.baseline && s.baseline.container < 1) return; // under one container ship a day: a % change means nothing
      if (wp === "CAPE") return; // diversions *raise* Cape traffic; never a constraint here
      if (s.ratio < closeBelow) { eff.closed.push(wp); notes.push({ wp: wp, name: s.name, ratio: s.ratio, status: "avoided" }); }
      else if (s.ratio < squeezeBelow) {
        eff.choke[wp] = { cap: +s.ratio.toFixed(2), delay: Math.round((1 - s.ratio) * 8) };
        notes.push({ wp: wp, name: s.name, ratio: s.ratio, status: "reduced" });
      }
    });
    Object.keys(signals.ports || {}).forEach(function (code) {
      var s = signals.ports[code];
      if (!s || s.ratio == null || (opts.ports && !opts.ports[code])) return;
      var nm = (Sea.PORTS[code] && Sea.PORTS[code].name) || code;
      if (s.ratio < portShut) { eff.ports[code] = { cap: Math.max(0.1, +s.ratio.toFixed(2)), delay: 3 }; portNotes.push({ code: code, name: nm, ratio: s.ratio, status: "near-shut" }); }
      else if (s.ratio < portReduced) { eff.ports[code] = { cap: +s.ratio.toFixed(2), delay: 2 }; portNotes.push({ code: code, name: nm, ratio: s.ratio, status: "reduced" }); }
    });
    var all = notes.length + portNotes.length;
    var parts = [];
    if (notes.length) parts.push("Chokepoints well below their 2019–Oct 2023 container-transit average (last 7 days): " + notes.map(function (n) { return n.name + " " + Math.round(n.ratio * 100) + "%"; }).join(", ") + ".");
    if (portNotes.length) parts.push("Ports well below their normal container calls (last 14 days): " + portNotes.map(function (n) { return n.name + " " + Math.round(n.ratio * 100) + "%"; }).join(", ") + ".");
    return {
      id: "live", kind: "live", type: "live", name: "Live conditions (IMF PortWatch)", period: "as of " + (asOf || "?"),
      lat: 0, lng: 0, severity: all ? Math.min(5, 2 + all) : 1, steadyState: true,
      description: parts.length ? parts.join(" ") : "All chokepoints and ports on the network are near normal container traffic.",
      notes: notes, portNotes: portNotes, effects: eff,
      source: signals.sources && signals.sources.portwatch,
      duration: { actual: 90, min: 30, mode: 90, max: 365 }, annualProb: 0
    };
  }

  // ------------------------------------------------------------------ 2. evaluate
  var routeCache = {};
  function routeKey(a, b, closed, avoid) { return a + ">" + b + "|" + Object.keys(closed).sort().join(",") + "|" + Object.keys(avoid).sort().join(","); }
  function cachedRoute(a, b, closed, avoid, ports) {
    if (ports) return Sea.route(a, b, { closed: closed, avoid: avoid, ports: ports }); // custom ports: don't cache
    var k = routeKey(a, b, closed, avoid);
    if (!routeCache[k]) routeCache[k] = Sea.route(a, b, { closed: closed, avoid: avoid });
    return routeCache[k];
  }

  function portLookup(net) { return net.ports || null; }

  // Ocean service under conditions -> {ok, nm, days, cap, ratePerTeu, upliftPerTeu, route}
  function evalService(s, net, cond, levers, p) {
    var avoid = s.ulcv ? { PANAMA: true } : {};
    var ports = portLookup(net);
    var base = cachedRoute(s.from, s.to, {}, avoid, ports);
    var r = cond.active ? cachedRoute(s.from, s.to, cond.closed, avoid, ports) : base;
    var portF = (cond.ports[s.from] || { cap: 1 }).cap * (cond.ports[s.to] || { cap: 1 }).cap;
    var out = { id: s.id, from: s.from, to: s.to, trade: s.trade, baseNm: base.nm, ok: !!(r.ok && base.ok && portF > 0) };
    var sailDays = function (nm) { return nm / (p.speedKn * 24) + 2 * p.dwellDays; };
    out.baseDays = base.ok ? sailDays(base.nm) : Infinity;
    if (!r.ok) { out.cap = 0; out.days = Infinity; out.route = base; out.closedRoute = true; return out; }
    var chokeF = 1, delay = 0;
    r.chokes.forEach(function (w) { var x = cond.choke[w]; if (x) { chokeF *= x.cap; delay += x.delay; } });
    delay += (cond.ports[s.from] || { delay: 0 }).delay + (cond.ports[s.to] || { delay: 0 }).delay;
    out.nm = r.nm; out.route = r; out.chokes = r.chokes;
    // where each chokepoint sits along the route (fraction of the distance sailed)
    var cum = [0];
    for (var i = 1; i < r.path.length; i++) cum.push(cum[i - 1] + Sea.gcNm({ lat: r.path[i - 1][0], lng: r.path[i - 1][1] }, { lat: r.path[i][0], lng: r.path[i][1] }));
    var tot = cum[cum.length - 1] || 1;
    out.chokeFrac = r.via.map(function (w, k) { return Sea.WP[w].choke ? { wp: w, frac: cum[k + 1] / tot } : null; }).filter(Boolean);
    out.days = sailDays(r.nm) + delay;
    var rotation = Math.min(1, out.baseDays / out.days);
    var boost = 1, gb = levers.gatewayBoost != null ? levers.gatewayBoost : (levers.gateways ? p.gatewayBoost : 0);
    if (cond.active && gb > 0 && p.gatewayPorts && (p.gatewayPorts[s.to] || p.gatewayPorts[s.from])) boost += gb;
    out.cap = s.cap * chokeF * portF * rotation * boost;
    var distF = (1 - p.distanceShare) + p.distanceShare * (r.nm / base.nm);
    out.rate = s.rate * distF;
    out.uplift = s.rate * distF * upliftFor(cond, s.trade);
    out.ok = out.cap > 1e-6;
    return out;
  }

  // ---- tier-2/3 suppliers (v5.1)
  // `share` = the share of a site's output that needs a supplier's parts. Availability of each
  // supplier = its own factor × Π(1 − share × shortfall of what feeds it); a factory's output
  // factor = its direct factor × Π(1 − share × shortfall of its suppliers). Independent
  // bottlenecks multiply.
  // supplyMap: direct factory factors; supplierMap: suppliers' own factors (both 0..1).
  function effectiveSupply(net, supplyMap, supplierMap) {
    var sup = {}, byId = {}, out = {};
    (net.suppliers || []).forEach(function (s) { byId[s.id] = s; });
    function avail(id, depth) {
      if (sup[id] != null) return sup[id];
      if (depth > 6) return 1; // guard against loops in imported data
      var own = supplierMap && supplierMap[id] != null ? supplierMap[id] : 1, keep = 1;
      (net.suppliers || []).forEach(function (u) { var sh = u.feeds && u.feeds[id]; if (sh) keep *= 1 - sh * (1 - avail(u.id, depth + 1)); });
      return (sup[id] = Math.max(0, Math.min(1, own * keep)));
    }
    net.factories.forEach(function (f) {
      var keep = 1;
      (net.suppliers || []).forEach(function (s) { var sh = s.feeds && s.feeds[f.id]; if (sh) keep *= 1 - sh * (1 - avail(s.id, 0)); });
      var direct = supplyMap && supplyMap[f.id] != null ? supplyMap[f.id] : 1;
      out[f.id] = Math.max(0, Math.min(1, direct * keep));
    });
    return { factories: out, suppliers: sup };
  }
  // How much of the network's weekly volume depends on each supplier, through every tier.
  function supplierExposure(net, base) {
    var list = net.suppliers || []; if (!list.length) return [];
    var flow = {}; base.paths.forEach(function (pt) { if (!pt.short && pt.factory) flow[pt.factory] = (flow[pt.factory] || 0) + pt.flow; });
    var total = Object.keys(flow).reduce(function (a, k) { return a + flow[k]; }, 0) || 1;
    // dependence of factory f on supplier s = direct share + shares through intermediate suppliers
    function dep(sId, target, depth) {
      var s = list.filter(function (x) { return x.id === sId; })[0]; if (!s || depth > 6) return 0;
      var d = (s.feeds && s.feeds[target]) || 0;
      list.forEach(function (u) { if (s.feeds && s.feeds[u.id]) d += s.feeds[u.id] * dep(u.id, target, depth + 1); });
      return d;
    }
    return list.map(function (s) {
      var teu = 0, facs = [];
      net.factories.forEach(function (f) { var d = dep(s.id, f.id, 0); if (d > 0) { teu += d * (flow[f.id] || 0); facs.push({ id: f.id, name: f.name, share: d }); } });
      return { id: s.id, name: s.name, tier: s.tier || 2, lat: s.lat, lng: s.lng, what: s.what || "", teuWeek: teu, share: teu / total, factories: facs };
    }).sort(function (a, b) { return b.teuWeek - a.teuWeek; });
  }

  // share of the default second-source capacity held (1 = the default "on" lever)
  function dualScale(net, levers, p) {
    if (levers.dualSourceCap == null) return levers.dualSource ? 1 : 0;
    var std = net.factories.reduce(function (a, f) { return a + (f.standby && f.standby.lever === "dualSource" ? f.standby.cap : 0); }, 0) || 250;
    return levers.dualSourceCap / std;
  }

  // Product families on a network. A network whose DCs carry a `mix` ({productId: TEU/week})
  // is multi-product; otherwise it is one aggregate product ("All goods") valued with the
  // global defaults — which is exactly the v3.0 model.
  function productsOf(net, p) {
    // a network can bring its own families (e.g. built from shipment history); page/API
    // per-family overrides apply to either
    var defs = net.productDefs ? net.productDefs.map(function (x) { return Object.assign({}, x, (p.productOverrides || {})[x.id] || {}); }) : (p.products || []);
    var used = {};
    net.dcs.forEach(function (d) { if (d.mix) Object.keys(d.mix).forEach(function (k) { if (d.mix[k] > 0) used[k] = 1; }); });
    var list = defs.filter(function (x) { return used[x.id]; });
    if (!list.length) return [{ id: "all", name: "All goods", valuePerTeu: p.valuePerTeu, lostSaleCostPerTeu: p.lostMarginPerTeu, fillTarget: p.fillTarget || 0.95, air: true, critical: true, single: true }];
    return list;
  }
  function demandOf(d, prod) { return prod.single ? d.demand : (d.mix && d.mix[prod.id]) || 0; }
  function makes(f, prod) { return prod.single || !f.products || f.products.indexOf(prod.id) >= 0; }

  // Weekly plan. Multi-product networks are planned family by family in priority order (highest
  // cost of a lost sale first): each family's min-cost flow uses whatever factory, ship and port
  // capacity the families before it left. A greedy but transparent approximation of a joint
  // multi-commodity optimisation (see the Method notes).
  function evaluate(net, cond, levers, p) {
    levers = levers || {};
    var BIG = 1e7;
    var prods = productsOf(net, p).slice().sort(function (a, b) { return b.lostSaleCostPerTeu - a.lostSaleCostPerTeu; });
    var dcById = {}, totalDemand = 0;
    net.dcs.forEach(function (d) { dcById[d.id] = d; totalDemand += d.demand; });

    // shared capacity, used up family by family
    var remSupply = {}, standbyOf = {};
    var eff = effectiveSupply(net, cond.supply, cond.suppliers).factories;
    net.factories.forEach(function (f) {
      var cap = f.cap * eff[f.id];
      var standby = false;
      var dk = dualScale(net, levers, p);
      if (cond.active && dk > 0) {
        if (f.standby && f.standby.lever === "dualSource") { cap += f.standby.cap * dk; standby = true; }
        if (p.surge && p.surge[f.id]) { cap += p.surge[f.id] * dk; standby = true; }
      }
      remSupply[f.id] = cap; standbyOf[f.id] = standby;
    });
    var services = (net.services || []).map(function (s) { return evalService(s, net, cond, levers, p); });
    var remSvc = {}; services.forEach(function (sv) { remSvc[sv.id] = sv.ok ? sv.cap : 0; });
    var portSeen = {};
    services.forEach(function (sv) { portSeen[sv.from] = 1; portSeen[sv.to] = 1; });
    var remPortOut = {}, remPortIn = {};
    Object.keys(portSeen).forEach(function (code) {
      var pcap = p.portCaps && p.portCaps[code];
      remPortOut[code] = pcap ? pcap.outWeek : BIG; remPortIn[code] = pcap ? pcap.inWeek : BIG;
    });

    var allPaths = [], solverCost = 0;
    prods.forEach(function (prod) {
      var carry = prod.valuePerTeu * (p.carryingRatePct / 100) / 365; // $ per TEU-day in transit
      var idx = {}, n = 0;
      function node(k) { if (idx[k] === undefined) idx[k] = n++; return idx[k]; }
      var S = node("S"), T = node("T");
      var edges = [];
      function add(a, b, cap, cost, meta) { edges.push([node(a), node(b), cap, cost, meta]); }
      var demandP = 0;

      net.factories.forEach(function (f) {
        if (!makes(f, prod)) return;
        if (remSupply[f.id] > 1e-6) add("S", "f:" + f.id, remSupply[f.id], f.prodCost || 0, { kind: "supply", ref: f.id, days: 0, comps: { production: f.prodCost || 0 }, standby: standbyOf[f.id] });
        (f.exports || []).forEach(function (x) {
          if ((cond.ports[x.port] || { cap: 1 }).cap <= 0) return;
          add("f:" + f.id, "ox:" + x.port, BIG, x.cost + carry * x.days, { kind: "export", ref: f.id + ">" + x.port, days: x.days, mode: x.mode, from: f.id, to: x.port, comps: { inland: x.cost, carrying: carry * x.days } });
        });
        (f.direct || []).forEach(function (x) {
          if (!dcById[x.dc]) return;
          add("f:" + f.id, "dc:" + x.dc, BIG, x.cost + carry * x.days, { kind: "direct", ref: f.id + ">" + x.dc, days: x.days, mode: x.mode, from: f.id, to: x.dc, comps: { inland: x.cost, carrying: carry * x.days } });
        });
      });
      services.forEach(function (sv) {
        if (!sv.ok || remSvc[sv.id] <= 1e-6) return;
        add("o:" + sv.from, "d:" + sv.to, remSvc[sv.id], sv.rate + sv.uplift + carry * sv.days,
          { kind: "service", ref: sv.id, days: sv.days, svc: sv, comps: { freight: sv.rate, surcharge: sv.uplift, carrying: carry * sv.days } });
      });
      Object.keys(portSeen).forEach(function (code) {
        add("ox:" + code, "o:" + code, remPortOut[code], 0, { kind: "portcap", dir: "out", ref: code, days: 0 });
        add("d:" + code, "dx:" + code, remPortIn[code], 0, { kind: "portcap", dir: "in", ref: code, days: 0 });
      });
      net.dcs.forEach(function (d) {
        var dem = demandOf(d, prod); if (dem <= 0) return;
        demandP += dem;
        (d.imports || []).forEach(function (x) {
          if ((cond.ports[x.port] || { cap: 1 }).cap <= 0) return;
          add("dx:" + x.port, "dc:" + d.id, BIG, x.cost + carry * x.days, { kind: "import", ref: x.port + ">" + d.id, days: x.days, mode: x.mode, from: x.port, to: d.id, comps: { inland: x.cost, carrying: carry * x.days } });
        });
        add("dc:" + d.id, "T", dem, 0, { kind: "demand", ref: d.id });
        add("S", "dc:" + d.id, dem, prod.lostSaleCostPerTeu, { kind: "short", ref: d.id });
      });
      if (demandP <= 0) return;

      var mcf = new Flow.MinCostFlow(n);
      var eidx = edges.map(function (e) { return mcf.addEdge(e[0], e[1], e[2], e[3]); });
      var res = mcf.run(S, T, demandP);
      solverCost += res.cost;

      // use up shared capacity
      edges.forEach(function (e, i) {
        var fl = mcf.edges[eidx[i]].flow, m = e[4]; if (fl <= 1e-9) return;
        if (m.kind === "supply") remSupply[m.ref] -= fl;
        else if (m.kind === "service") remSvc[m.ref] -= fl;
        else if (m.kind === "portcap") { if (m.dir === "out") remPortOut[m.ref] -= fl; else remPortIn[m.ref] -= fl; }
      });

      // decompose into S->T paths
      var rem = eidx.map(function (ei) { return mcf.edges[ei].flow; });
      var outE = {}; edges.forEach(function (e, i) { (outE[e[0]] = outE[e[0]] || []).push(i); });
      for (var guard = 0; guard < 2000; guard++) {
        var u = S, seq = [], bott = Infinity, seen = {};
        while (u !== T) {
          var list = outE[u] || [], pick = -1;
          for (var j = 0; j < list.length; j++) if (rem[list[j]] > 1e-6) { pick = list[j]; break; }
          if (pick < 0 || seen[u]) { seq = null; break; }
          seen[u] = true; seq.push(pick); bott = Math.min(bott, rem[pick]); u = edges[pick][1];
        }
        if (!seq || !seq.length) break;
        seq.forEach(function (i) { rem[i] -= bott; });
        var pt = makePath(seq.map(function (i) { return edges[i][4]; }), bott);
        pt.product = prod.id;
        if (!prod.single) pt.key = "p:" + prod.id + "|" + pt.key;
        allPaths.push(pt);
      }
    });

    // merge identical paths
    var merged = {};
    allPaths.forEach(function (pt) { if (merged[pt.key]) merged[pt.key].flow += pt.flow; else merged[pt.key] = pt; });
    var paths = Object.keys(merged).map(function (k) { return merged[k]; });

    var served = {}, shortW = {}, opCost = 0, comps = {}, servedTotal = 0, byProduct = {};
    net.dcs.forEach(function (d) { served[d.id] = 0; shortW[d.id] = 0; });
    paths.forEach(function (pt) {
      var bp = byProduct[pt.product] = byProduct[pt.product] || { served: 0, short: 0, opCost: 0, comps: {} };
      if (pt.short) { shortW[pt.dc] += pt.flow; bp.short += pt.flow; return; }
      served[pt.dc] += pt.flow; servedTotal += pt.flow; bp.served += pt.flow;
      Object.keys(pt.comps).forEach(function (k) {
        var v = pt.comps[k] * pt.flow;
        comps[k] = (comps[k] || 0) + v; opCost += v;
        bp.comps[k] = (bp.comps[k] || 0) + v; bp.opCost += v;
      });
    });
    return { services: services, paths: paths, served: served, short: shortW, servedTotal: servedTotal, demand: totalDemand, opCostWeek: opCost, compsWeek: comps, solverCost: solverCost, byProduct: byProduct, products: prods };
  }

  function makePath(metas, flow) {
    var pt = { flow: flow, days: 0, comps: {}, legs: [], key: "", short: false, dc: null, factory: null, mode: "sea", standby: false, service: null };
    var refs = [];
    metas.forEach(function (m) {
      if (m.kind === "short") { pt.short = true; pt.dc = m.ref; refs.push("short:" + m.ref); return; } // keyed by DC so shortfalls never merge across DCs
      if (m.kind === "demand") { pt.dc = m.ref; return; }
      if (m.kind === "supply") { pt.factory = m.ref; if (m.standby) pt.standby = true; }
      if (m.kind === "direct") pt.mode = "direct";
      if (m.kind === "air") pt.mode = "air";
      if (m.kind === "service") pt.service = m.svc;
      if (m.kind === "portcap") return;
      if (m.kind !== "aircap") refs.push(m.ref);
      pt.days += m.days || 0;
      Object.keys(m.comps || {}).forEach(function (k) { pt.comps[k] = (pt.comps[k] || 0) + m.comps[k]; });
      if (m.kind !== "supply" && m.kind !== "aircap") pt.legs.push(m);
    });
    pt.key = refs.join("|");
    return pt;
  }

  // ------------------------------------------------------------------ 3. day simulation
  // Arrival streams into one DC during a disruption of L days.
  function arrivalStreams(dcId, base, dis, rampOf) {
    var streams = []; // {rate (TEU/day), from, to}
    var baseByKey = {};
    base.paths.forEach(function (pt) { if (!pt.short && pt.dc === dcId) baseByKey[pt.key] = pt; });
    var disByKey = {};
    dis.paths.forEach(function (pt) { if (!pt.short && pt.dc === dcId) disByKey[pt.key] = pt; });
    Object.keys(disByKey).forEach(function (k) {
      var d = disByKey[k], b = baseByKey[k];
      var carried = b ? Math.min(b.flow, d.flow) : 0;
      if (carried > 0) streams.push({ rate: carried / 7, from: Math.max(0, d.days - b.days), to: Infinity });
      var extra = d.flow - carried;
      if (extra > 1e-6) streams.push({ rate: extra / 7, from: d.days + rampOf(d), to: Infinity });
    });
    // Cut flow on lanes that stay open keeps arriving until the pipeline empties.
    Object.keys(baseByKey).forEach(function (k) {
      var b = baseByKey[k], d = disByKey[k];
      var lost = b.flow - (d ? d.flow : 0);
      if (lost <= 1e-6) return;
      var open = !b.service || dis.services.some(function (s) { return s.id === b.service.id && s.ok; });
      if (!open) return;
      var shift = d ? Math.max(0, d.days - b.days) : 0;
      streams.push({ rate: lost / 7, from: shift, to: b.days + shift });
    });
    return streams;
  }

  // air (optional): {capDay, from} — an air-freight contract that tops up any shortfall
  // from day `from` (booking ramp + flight time), up to capDay TEU-equivalent per day.
  // Air is modelled here, not in the weekly flow, because its value is speed: it bridges
  // the weeks while re-planned ocean supply is still at sea.
  function simulateDc(demandWeek, bufferDays, streams, L, keepTrace, air) {
    // Stock never builds above its target: when re-planned supply overlaps cargo already at
    // sea, the planner holds back orders rather than stockpiling (order-up-to policy).
    var D = demandWeek / 7, I0 = bufferDays * D, I = I0, lost = 0, airTeu = 0, tts = null, trace = keepTrace ? [] : null;
    for (var t = 0; t < L; t++) {
      var a = 0;
      for (var i = 0; i < streams.length; i++) { var s = streams[i]; if (t >= s.from && t < s.to) a += s.rate; }
      I = Math.min(I0, I + a - D);
      if (I < -1e-9 && air && t >= air.from) { var x = Math.min(air.capDay, -I); airTeu += x; I += x; }
      if (I < -1e-9) { lost += -I; I = 0; if (tts === null) tts = t; }
      if (trace) trace.push(I);
    }
    return { lostTeu: lost, airTeu: airTeu, tts: tts, trace: trace, endInv: I };
  }

  // ------------------------------------------------------------------ 4. analyse
  function params(data, overrides) {
    var d = data.defaults, o = overrides || {}, L = data.levers;
    var p = {};
    Object.keys(d).forEach(function (k) { p[k] = o[k] != null ? o[k] : d[k]; });
    p.gatewayPorts = {}; (L.gateways.ports || []).forEach(function (x) { p.gatewayPorts[x] = true; });
    p.gatewayBoost = L.gateways.capBoost;
    p.surge = L.dualSource.surge || {};
    p.air = { from: o.airFrom || ["f-shenzhen", "f-yangtze"], capPerDc: L.airBridge.capPerDc, costPerTeu: L.airBridge.costPerTeu, days: L.airBridge.days };
    p.ramp = { dualSource: L.dualSource.rampDays, airBridge: L.airBridge.rampDays };
    p.extraUplift = o.extraUplift || 0;
    // product families: data.products, with per-family overrides (value, lost-sale cost, target)
    p.products = (data.products || []).map(function (x) { var ov = (o.products || {})[x.id] || {}; return Object.assign({}, x, ov); });
    p.productOverrides = o.products || {};
    p.hedgeCoverage = L.rateHedge ? L.rateHedge.coverage : 0;
    p.hedgePremiumPct = L.rateHedge ? L.rateHedge.premiumPct : 0;
    return p;
  }

  // Lever settings can be on/off (the sidebar) or amounts (the optimiser). This turns either
  // into amounts; an "on" lever means its default amount from data.levers.
  function leverAmounts(data, net, levers, p) {
    levers = levers || {};
    var L = data.levers, prods = productsOf(net, p), stock = {};
    var scope = levers.bufferScope || "all";
    prods.forEach(function (pr) {
      var byF = levers.bufferByFamily && levers.bufferByFamily[pr.id];
      stock[pr.id] = byF != null ? byF : (levers.buffer || 0) * (scope === "all" || pr.critical ? 1 : 0);
    });
    var stdDual = net.factories.reduce(function (a, f) { return a + (f.standby && f.standby.lever === "dualSource" ? f.standby.cap : 0); }, 0) || L.dualSource.defaultCap || 250;
    return {
      stock: stock,
      hedge: levers.hedgeCoverage != null ? levers.hedgeCoverage : (levers.rateHedge ? L.rateHedge.coverage : 0),
      dualCap: levers.dualSourceCap != null ? levers.dualSourceCap : (levers.dualSource ? stdDual : 0), dualStd: stdDual,
      airCap: levers.airCapPerDc != null ? levers.airCapPerDc : (levers.airBridge ? L.airBridge.capPerDc : 0),
      gwBoost: levers.gatewayBoost != null ? levers.gatewayBoost : (levers.gateways ? L.gateways.capBoost : 0),
      tower: !!levers.controlTower
    };
  }

  function leverAnnualCost(data, net, levers, p) {
    var L = data.levers, total = 0, parts = {}, a = leverAmounts(data, net, levers, p);
    // holding cost = extra days × daily demand × each family's value × holding rate
    var hold = productsOf(net, p).reduce(function (s, pr) {
      var days = a.stock[pr.id] || 0; if (!days) return s;
      var daily = net.dcs.reduce(function (x, d) { return x + demandOf(d, pr); }, 0) / 7;
      return s + days * daily * pr.valuePerTeu * (p.holdingRatePct / 100);
    }, 0);
    if (hold > 0) { parts.buffer = hold; total += hold; }
    // retainers scale with the amount held (linear in the default amount's price)
    if (a.dualCap > 0) { parts.dualSource = L.dualSource.annualCost * a.dualCap / a.dualStd; total += parts.dualSource; }
    if (a.airCap > 0) { parts.airBridge = L.airBridge.annualCost * a.airCap / L.airBridge.capPerDc; total += parts.airBridge; }
    if (a.gwBoost > 0) { parts.gateways = L.gateways.annualCost * a.gwBoost / L.gateways.capBoost; total += parts.gateways; }
    if (a.tower && L.controlTower) { parts.controlTower = L.controlTower.annualCost; total += parts.controlTower; }
    if (a.hedge > 0) {
      // premium over spot on the share of the baseline ocean-freight bill under contract, paid every year
      var base = evaluate(net, conditions([]), {}, p);
      parts.rateHedge = (base.compsWeek.freight || 0) * 52 * (p.hedgePremiumPct / 100) * (a.hedge / L.rateHedge.coverage);
      total += parts.rateHedge;
    }
    return { total: total, parts: parts, amounts: a };
  }

  // A prepared scenario: both flow solutions and the per-DC arrival streams. Cheap to
  // re-cost for any duration / rate multiplier, which is what makes Monte Carlo fast.
  // baseEvents: conditions that are already the status quo (e.g. today's live chokepoint
  // state) — the baseline is solved under them and the scenario adds `events` on top.
  // An event flagged steadyState (live conditions) has no onset shock: the network is
  // assumed to have adapted already, so there is no pipeline gap, only the running cost.
  function prepare(data, net, events, levers, p, baseEvents) {
    levers = levers || {};
    baseEvents = baseEvents || [];
    var all = baseEvents.concat(events.filter(function (e) { return baseEvents.indexOf(e) < 0; }));
    var cond = conditions(all);
    if (p.extraUplift) { cond.upliftAll = Math.max(cond.upliftAll, 0) + p.extraUplift; if (!cond.active && p.extraUplift > 0) cond.active = true; }
    var base = evaluate(net, conditions(baseEvents), levers, p);
    var dis = evaluate(net, cond, levers, p);
    var steady = events.length > 0 && events.every(function (e) { return e.steadyState; });
    var rampOf = function (pt) { return pt.standby ? p.ramp.dualSource : 0; };
    var dcs = net.dcs.map(function (d) {
      var streams = steady ? [{ rate: (dis.served[d.id] || 0) / 7, from: 0, to: Infinity }] : arrivalStreams(d.id, base, dis, rampOf);
      return { id: d.id, name: d.name, demand: d.demand, buffer: (d.bufferDays || 0) + (levers.buffer || 0), streams: streams };
    });
    var air = levers.airBridge && p.air ? { capDay: p.air.capPerDc / 7, from: p.ramp.airBridge + p.air.days, cost: p.air.costPerTeu } : null;
    // per-served-TEU operating cost, baseline vs disrupted, by component
    var perTeu = function (sol) { var o = {}; Object.keys(sol.compsWeek).forEach(function (k) { o[k] = sol.servedTotal ? sol.compsWeek[k] / sol.servedTotal : 0; }); return o; };
    return { cond: cond, base: base, dis: dis, dcs: dcs, air: air, steady: steady, basePer: perTeu(base), disPer: perTeu(dis), levers: levers, p: p };
  }

  // Cost a prepared scenario for duration L days and rate multiplier m.
  function cost(prep, L, m, keepTrace) {
    m = m == null ? 1 : m;
    var p = prep.p, comps = {}, total = 0;
    var weeks = L / 7, served = prep.dis.servedTotal;
    var keys = {};
    Object.keys(prep.basePer).forEach(function (k) { keys[k] = 1; });
    Object.keys(prep.disPer).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var mult = k === "surcharge" ? m * (prep.levers.rateHedge ? 1 - p.hedgeCoverage : 1) : 1;
      var d = (prep.disPer[k] || 0) * mult - (prep.basePer[k] || 0) * (k === "surcharge" && prep.levers.rateHedge ? 1 - p.hedgeCoverage : 1);
      comps[k] = d * served * weeks; total += comps[k];
    });
    var dcRes = prep.dcs.map(function (d) {
      var r = simulateDc(d.demand, d.buffer, d.streams, Math.ceil(L), keepTrace, prep.air);
      return { id: d.id, name: d.name, demand: d.demand, buffer: d.buffer, tts: r.tts, lostTeu: r.lostTeu, airTeu: r.airTeu, trace: r.trace, servedShare: d.demand ? (prep.dis.served[d.id] || 0) / d.demand : 1 };
    });
    var lostTeu = dcRes.reduce(function (a, d) { return a + d.lostTeu; }, 0);
    var airTeu = dcRes.reduce(function (a, d) { return a + d.airTeu; }, 0);
    if (airTeu > 0) { comps.air = airTeu * prep.air.cost; total += comps.air; }
    comps.lostMargin = lostTeu * p.lostMarginPerTeu; total += comps.lostMargin;
    var tts = dcRes.reduce(function (a, d) { return d.tts === null ? a : (a === null ? d.tts : Math.min(a, d.tts)); }, null);
    return { total: total, comps: comps, dcs: dcRes, lostTeu: lostTeu, airTeu: airTeu, tts: tts, ttr: L };
  }

  function eventsDuration(events, mode, rng) {
    var L = 0;
    events.forEach(function (e) {
      var d = e.duration || { actual: 30, min: 7, mode: 30, max: 90 };
      var x = mode === "sample" ? triangular(rng, d.min, d.mode, d.max) : (d.actual || d.mode);
      L = Math.max(L, x);
    });
    return L;
  }

  function analyse(data, net, events, levers, overrides) {
    var p = params(data, overrides);
    var prep = prepare(data, net, events, levers, p, overrides && overrides.baseEvents);
    var L = overrides && overrides.duration ? overrides.duration : eventsDuration(events, "actual");
    var res = cost(prep, L, 1, true);
    res.prep = prep;
    res.leverCost = leverAnnualCost(data, net, levers || {}, p);
    res.exposure = exposure(prep.base);
    return res;
  }

  // ------------------------------------------------------------------ 5. Monte Carlo
  function monteCarlo(data, net, events, levers, overrides, runs, seed) {
    var p = params(data, overrides);
    var prep = prepare(data, net, events, levers, p, overrides && overrides.baseEvents);
    var rng = mulberry32(seed || 12345);
    runs = runs || p.mcRuns;
    var xs = [], ttsMiss = 0, durs = [];
    for (var i = 0; i < runs; i++) {
      var L = eventsDuration(events, "sample", rng);
      var m = 0.6 + 0.8 * rng();
      var r = cost(prep, L, m, false);
      xs.push(r.total); durs.push(L);
      if (r.tts !== null) ttsMiss++;
    }
    var sorted = xs.slice().sort(function (a, b) { return a - b; });
    var mean = xs.reduce(function (a, b) { return a + b; }, 0) / (xs.length || 1);
    return {
      runs: runs, mean: mean, p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), p99: quantile(sorted, 0.99),
      sorted: sorted, pShortfall: ttsMiss / (runs || 1), meanDuration: durs.reduce(function (a, b) { return a + b; }, 0) / (durs.length || 1)
    };
  }

  // ------------------------------------------------------------------ 6. portfolio
  // Expected annual loss over the event library = sum(annualProb x mean MC loss).
  function expectedAnnualLoss(data, net, levers, overrides, runs) {
    var total = 0, byEvent = [];
    data.events.forEach(function (ev, i) {
      if (!ev.annualProb) return;
      if (overrides && overrides.baseEvents && overrides.baseEvents.some(function (b) { return b.id === ev.id; })) return;
      var mc = monteCarlo(data, net, [ev], levers, overrides, runs || 150, 1000 + i);
      byEvent.push({ id: ev.id, name: ev.name, p: ev.annualProb, mean: mc.mean, eal: ev.annualProb * mc.mean });
      total += ev.annualProb * mc.mean;
    });
    return { total: total, byEvent: byEvent };
  }

  var LEVER_KEYS = ["buffer", "dualSource", "airBridge", "gateways", "rateHedge"];
  // Every combination of the five levers (buffer at 0 or at `bufferDays`), ranked by total
  // annual cost of risk = expected annual loss + annual cost of holding the options.
  function portfolio(data, net, overrides, bufferDays, runs) {
    var p = params(data, overrides);
    var rows = [];
    for (var mask = 0; mask < 32; mask++) {
      var lv = { buffer: (mask & 1) ? bufferDays : 0, dualSource: !!(mask & 2), airBridge: !!(mask & 4), gateways: !!(mask & 8), rateHedge: !!(mask & 16) };
      var eal = expectedAnnualLoss(data, net, lv, overrides, runs);
      var prem = leverAnnualCost(data, net, lv, p);
      rows.push({ levers: lv, eal: eal.total, premium: prem.total, total: eal.total + prem.total, byEvent: eal.byEvent });
    }
    var none = rows[0]; // mask 0 = no levers
    rows.forEach(function (r) { r.netValue = none.total - r.total; });
    rows.sort(function (a, b) { return a.total - b.total; });
    return rows;
  }

  // Share of baseline weekly flow through each chokepoint.
  function exposure(base) {
    var by = {}, total = 0;
    base.paths.forEach(function (pt) {
      if (pt.short) return;
      total += pt.flow;
      if (pt.service && pt.service.chokes) pt.service.chokes.forEach(function (w) { by[w] = (by[w] || 0) + pt.flow; });
    });
    return Object.keys(by).map(function (w) { return { wp: w, name: Sea.CHOKES[w] ? Sea.CHOKES[w].name : w, teuWeek: by[w], share: total ? by[w] / total : 0 }; })
      .sort(function (a, b) { return b.teuWeek - a.teuWeek; });
  }

  var api = {
    conditions: conditions, liveEvent: liveEvent, evaluate: evaluate, simulateDc: simulateDc, params: params,
    prepare: prepare, cost: cost, analyse: analyse, productsOf: productsOf, demandOf: demandOf, leverAmounts: leverAmounts, dualScale: dualScale,
    effectiveSupply: effectiveSupply, supplierExposure: supplierExposure, monteCarlo: monteCarlo, expectedAnnualLoss: expectedAnnualLoss,
    portfolio: portfolio, exposure: exposure, leverAnnualCost: leverAnnualCost, eventsDuration: eventsDuration,
    triangular: triangular, mulberry32: mulberry32, LEVER_KEYS: LEVER_KEYS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasModel = api;
})(typeof window !== "undefined" ? window : globalThis);
