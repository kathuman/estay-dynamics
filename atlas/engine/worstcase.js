/*
 * worstcase.js — where is this network most fragile? (v4.1)
 *
 * Simulates every library event on its own and every pair together (each at its typical
 * duration, with the time-phased model and the levers currently held) and ranks them by
 * total cost, or by lost sales. Pairs matter: two disruptions together can hurt far more than
 * the sum of each alone when they knock out the alternatives (e.g. the Red Sea plus a US East
 * Coast strike). The "interaction" column shows that extra.
 *
 * Pure. Browser global window.AtlasWorstCase; CommonJS for node --test.
 */
(function (root) {
  "use strict";
  var Dy = root.AtlasDynamics || (typeof require === "function" ? require("./dynamics.js") : null);

  function candidates(data, opts) {
    opts = opts || {};
    var evs = data.events.filter(function (e) { return e.kind === "historical" || e.kind === "hypothetical"; });
    var list = evs.map(function (e) { return [e]; });
    if (opts.pairs !== false) for (var i = 0; i < evs.length; i++) for (var j = i + 1; j < evs.length; j++) list.push([evs[i], evs[j]]);
    return list;
  }
  function score(data, net, combo, levers, overrides) {
    var o = Object.assign({}, overrides || {}); delete o.duration;
    // each event at its typical (mode) duration
    var ctx = Dy.prepare(data, net, combo, levers || {}, o);
    var du = ctx.all.map(function (x) { return x.constant ? null : x.ev.duration.mode; });
    var r = Dy.run(ctx, du, 1, false);
    var miss = (r.products || []).filter(function (f) { return f.meets === false || (f.meets == null && f.lostTeu > 0.5 && f.fill < f.target); }).map(function (f) { return f.name; });
    return { ids: combo.map(function (e) { return e.id; }), names: combo.map(function (e) { return e.name; }), total: r.total, lostTeu: r.lostTeu, tts: r.tts, missing: miss };
  }
  function rank(rows, by) {
    var key = by === "lost" ? "lostTeu" : "total";
    var single = {}; rows.forEach(function (r) { if (r.ids.length === 1) single[r.ids[0]] = r; });
    rows.forEach(function (r) {
      if (r.ids.length === 2 && single[r.ids[0]] && single[r.ids[1]]) r.interaction = r[key] - single[r.ids[0]][key] - single[r.ids[1]][key];
    });
    return rows.slice().sort(function (a, b) { return b[key] - a[key]; });
  }
  function worstCases(data, net, levers, overrides, opts) {
    opts = opts || {};
    return rank(candidates(data, opts).map(function (c) { return score(data, net, c, levers, overrides); }), opts.by);
  }
  function worstCasesAsync(data, net, levers, overrides, opts, onProgress, onDone) {
    opts = opts || {};
    var list = candidates(data, opts), rows = [], i = 0;
    (function tick() {
      var until = Date.now() + 50;
      while (i < list.length && Date.now() < until) { rows.push(score(data, net, list[i], levers, overrides)); i++; }
      if (onProgress) onProgress(i, list.length);
      if (i < list.length) setTimeout(tick, 0); else onDone(rank(rows, opts.by));
    })();
  }

  var api = { candidates: candidates, score: score, rank: rank, worstCases: worstCases, worstCasesAsync: worstCasesAsync };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasWorstCase = api;
})(typeof window !== "undefined" ? window : globalThis);
