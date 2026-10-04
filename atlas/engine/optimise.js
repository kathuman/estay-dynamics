/*
 * optimise.js — choose how much flexibility to buy (v4).
 *
 * v2–v3.1 scored on/off lever combinations. This searches over lever AMOUNTS — stock days
 * per product family, contract coverage, standby second-source capacity, air capacity,
 * extra gateway allotment, control tower — to minimise
 *
 *     annual option cost + (1 − λ)·E[annual loss] + λ·CVaR90[annual loss]
 *
 * a two-stage stochastic programme: options are bought now (first stage); every library
 * event is then simulated with the time-phased model and the network's best response
 * (second stage, inside the simulation).
 *
 * Scenario set: each library event at `strata` duration quantiles (common to every
 * candidate, so comparisons are fair). Annual loss distribution: `years` sampled years in
 * which each event occurs independently with its annual likelihood and one of its sampled
 * durations; losses add up. CVaR90 = the mean of the worst 10% of years. Fixed seed, so the
 * same inputs always give the same answer.
 *
 * Search: coordinate descent on a grid of amounts from "no options", then from the best
 * on/off combination; each candidate costs one simulation per scenario, cached.
 * Every evaluated portfolio is kept, so the page can draw the cost–risk frontier.
 *
 * Pure. Browser global window.AtlasOptimise; CommonJS for node --test.
 */
(function (root) {
  "use strict";
  var M = root.AtlasModel || (typeof require === "function" ? require("./model.js") : null);
  var Dy = root.AtlasDynamics || (typeof require === "function" ? require("./dynamics.js") : null);

  function grid(data, net, p) {
    var fams = M.productsOf(net, p);
    var vars = fams.map(function (pr) { return { key: "stock:" + pr.id, label: "Extra stock — " + pr.name, unit: "days", levels: [0, 5, 10, 20] }; });
    vars.push({ key: "hedgeCoverage", label: "Fixed-rate contract coverage", unit: "share", levels: [0, 0.35, 0.7, 0.9] });
    vars.push({ key: "controlTower", label: "Early-warning control tower", unit: "on/off", levels: [0, 1] });
    vars.push({ key: "dualSourceCap", label: "Standby second-source capacity", unit: "TEU/wk", levels: [0, 125, 250] });
    vars.push({ key: "airCapPerDc", label: "Air-bridge capacity per DC", unit: "TEU/wk", levels: [0, 60, 120, 240] });
    vars.push({ key: "gatewayBoost", label: "Extra gateway allotment", unit: "share", levels: [0, 0.3, 0.6] });
    return vars;
  }
  // decision vector (one level index per variable) -> lever settings for the engine
  function toLevers(vars, x) {
    var lv = { bufferByFamily: {} };
    vars.forEach(function (v, i) {
      var val = v.levels[x[i]];
      if (v.key.indexOf("stock:") === 0) lv.bufferByFamily[v.key.slice(6)] = val;
      else if (v.key === "controlTower") lv.controlTower = !!val;
      else lv[v.key] = val;
    });
    return lv;
  }

  function quantilesTri(d, n) { return Dy.quantilesTri(d, n); }

  // Prepare once per candidate: losses for every (event, duration quantile).
  function lossTable(data, net, lv, o, strata) {
    var rows = [];
    data.events.forEach(function (ev) {
      if (!ev.annualProb) return;
      if (o.baseEvents && o.baseEvents.some(function (b) { return b.id === ev.id; })) return;
      var ctx = Dy.prepare(data, net, [ev], lv, o), i = ctx.all.length - 1;
      var losses = quantilesTri(ev.duration, strata).map(function (L) {
        var du = ctx.all.map(function () { return null; }); du[i] = L;
        return Dy.run(ctx, du, 1, false).total;
      });
      rows.push({ id: ev.id, p: ev.annualProb, losses: losses });
    });
    return rows;
  }

  // Annual loss distribution from the table: common random numbers across candidates.
  function riskOf(table, years, seed) {
    var rng = M.mulberry32(seed || 4242), xs = new Array(years);
    var eal = table.reduce(function (a, r) { return a + r.p * r.losses.reduce(function (s, x) { return s + x; }, 0) / r.losses.length; }, 0);
    for (var y = 0; y < years; y++) {
      var tot = 0;
      for (var k = 0; k < table.length; k++) {
        var r = table[k], u = rng(), q = rng();
        if (u < r.p) tot += r.losses[Math.min(r.losses.length - 1, Math.floor(q * r.losses.length))];
      }
      xs[y] = tot;
    }
    xs.sort(function (a, b) { return b - a; });
    var n = Math.max(1, Math.round(years * 0.1)), cvar = 0;
    for (var j = 0; j < n; j++) cvar += xs[j];
    return { eal: eal, cvar90: cvar / n, p90: xs[n - 1] };
  }

  /*
   * optimiseAsync(data, net, overrides, opts, onProgress, onDone)
   *   opts.lambda   risk weight 0..1 (0 = expected cost only)
   *   opts.strata   duration quantiles per event (default 3 for the search)
   *   opts.years    sampled years for the risk measure (default 4000)
   * onDone({best, none, points, vars}) where points = every evaluated portfolio.
   * A synchronous optimise() is provided for tests.
   */
  function makeSearch(data, net, overrides, opts) {
    opts = opts || {};
    var o = Object.assign({}, overrides || {}); delete o.duration;
    var p = M.params(data, o), vars = grid(data, net, p);
    var lambda = opts.lambda || 0, strata = opts.strata || 3, years = opts.years || 4000;
    var cache = {}, points = [];
    function evalX(x) {
      var key = x.join(",");
      if (cache[key]) return cache[key];
      var lv = toLevers(vars, x);
      var table = lossTable(data, net, lv, o, strata), risk = riskOf(table, years, 4242);
      var prem = M.leverAnnualCost(data, net, lv, p);
      var r = { x: x.slice(), levers: lv, premium: prem.total, parts: prem.parts, eal: risk.eal, cvar90: risk.cvar90,
        objective: prem.total + (1 - lambda) * risk.eal + lambda * risk.cvar90, byEvent: table };
      r.total = prem.total + risk.eal;
      cache[key] = r; points.push(r);
      return r;
    }
    var zero = vars.map(function () { return 0; });
    // queue of candidate moves for coordinate descent, processed one evaluation at a time
    var state = { x: zero.slice(), best: null, pass: 0, vi: 0, li: 0, improved: false, done: false, starts: [zero.slice()] };
    // second start: every lever at its default "on" amount (index 2 for stock = 10 days, etc.)
    var on = vars.map(function (v) { return v.key === "controlTower" ? 1 : Math.min(v.levels.length - 1, 2); });
    state.starts.push(on);
    var startIdx = 0, overall = null;
    function beginStart() {
      state.x = state.starts[startIdx].slice(); state.best = evalX(state.x); state.pass = 0; state.vi = 0; state.li = 0; state.improved = false;
    }
    beginStart();
    function step() { // one evaluation; returns false when finished
      if (state.done) return false;
      var v = vars[state.vi];
      if (state.li < v.levels.length) {
        if (state.li !== state.x[state.vi]) {
          var cand = state.x.slice(); cand[state.vi] = state.li;
          var r = evalX(cand);
          if (r.objective < state.best.objective - 1e-6) { state.best = r; state.x = cand; state.improved = true; }
        }
        state.li++;
        return true;
      }
      state.li = 0; state.vi++;
      if (state.vi >= vars.length) {
        state.vi = 0; state.pass++;
        if (!state.improved || state.pass >= 4) {
          if (!overall || state.best.objective < overall.objective) overall = state.best;
          startIdx++;
          if (startIdx >= state.starts.length) { state.done = true; return false; }
          beginStart();
        }
        state.improved = false;
      }
      return true;
    }
    return {
      vars: vars, step: step, points: points,
      result: function () {
        var none = cache[zero.join(",")];
        return { best: overall, none: none, points: points, vars: vars, lambda: lambda, evaluations: points.length };
      },
      progress: function () { return { evaluations: points.length, start: startIdx + 1, starts: state.starts.length, pass: state.pass + 1 }; }
    };
  }
  function optimise(data, net, overrides, opts) {
    var s = makeSearch(data, net, overrides, opts);
    while (s.step()) { /* run to completion */ }
    return s.result();
  }
  function optimiseAsync(data, net, overrides, opts, onProgress, onDone) {
    var s = makeSearch(data, net, overrides, opts);
    (function tick() {
      var until = Date.now() + 50, more = true;
      while (more && Date.now() < until) more = s.step();
      if (onProgress) onProgress(s.progress());
      if (more) setTimeout(tick, 0); else onDone(s.result());
    })();
  }

  // Portfolios no other evaluated portfolio beats on both annual option cost and tail risk.
  function frontier(points) {
    var pts = points.slice().sort(function (a, b) { return a.premium - b.premium || a.cvar90 - b.cvar90; }), out = [], bestTail = Infinity;
    pts.forEach(function (p) { if (p.cvar90 < bestTail - 1e-6) { out.push(p); bestTail = p.cvar90; } });
    return out;
  }

  var api = { grid: grid, toLevers: toLevers, lossTable: lossTable, riskOf: riskOf, optimise: optimise, optimiseAsync: optimiseAsync, frontier: frontier };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasOptimise = api;
})(typeof window !== "undefined" ? window : globalThis);
