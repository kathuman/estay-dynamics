/*
 * likelihood.js — how likely is each event, and which events come together? (v4.1)
 *
 * 1. Data-informed likelihoods. Each library event can name evidence in the live snapshot
 *    (`evidence` in data.js): a chokepoint or set of ports whose traffic falls below a
 *    threshold for long enough. Episodes are detected in the weekly PortWatch history
 *    (chokepoints since 2019, ports since 2022); runs separated by short recoveries are merged.
 *    The stated likelihood is a Gamma prior on the yearly rate worth `priorYears` of
 *    experience; observed episodes update it (Poisson–Gamma), giving a posterior mean and an
 *    80% interval. Short histories therefore move the estimate only part of the way.
 * 2. Correlation. Shared drivers (data.drivers) — e.g. a year of geopolitical tension —
 *    make related events cluster without changing how often each happens on its own: if a
 *    driver occurs with probability q and multiplies its events' rate by m in those years,
 *    the event's rate is λ/(q·m + 1 − q) in normal years and m times that in driver years.
 * 3. Climate scenarios (data.climate) scale weather events' likelihood and duration, or force
 *    a driver (e.g. an El Niño year).
 *
 * Pure. Browser global window.AtlasLikelihood; CommonJS for node --test.
 */
(function (root) {
  "use strict";
  var M = root.AtlasModel || (typeof require === "function" ? require("./model.js") : null);

  // ---------------------------------------------------------------- episode detection
  // series: [[weekEndDate, ratio|null], ...] oldest first. Returns [{from, to, weeks, min}].
  function episodes(series, threshold, minWeeks, mergeGap, opts) {
    opts = opts || {};
    var runs = [], run = null;
    series.forEach(function (w, i) {
      var r = w[1];
      if (r != null && r < threshold) {
        if (!run) run = { from: w[0], to: w[0], weeks: 0, min: r, start: i };
        run.to = w[0]; run.weeks++; run.min = Math.min(run.min, r); run.end = i;
      } else if (run) { runs.push(run); run = null; }
    });
    if (run) runs.push(run);
    // merge runs separated by a short recovery (one disruption, not several)
    var merged = [];
    runs.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && mergeGap && r.start - last.end - 1 <= mergeGap) { last.to = r.to; last.weeks += r.weeks; last.min = Math.min(last.min, r.min); last.end = r.end; }
      else merged.push(Object.assign({}, r));
    });
    return merged.filter(function (r) {
      if (r.weeks < minWeeks) return false;
      if (opts.maxWeeks && r.weeks > opts.maxWeeks) return false;
      if (opts.fromNormal) { // a sudden drop from normal traffic, not a dip within a long disruption
        var prev = series.slice(Math.max(0, r.start - 4), r.start).map(function (w) { return w[1]; }).filter(function (x) { return x != null; });
        if (!prev.length || prev.reduce(function (a, b) { return a + b; }, 0) / prev.length < 0.85) return false;
      }
      return true;
    });
  }

  function chokeSeries(signals, id, field) {
    var c = signals && signals.chokepoints && signals.chokepoints[id]; if (!c) return null;
    var base = field === "total" ? c.baseline.total : c.baseline.container, col = field === "total" ? 2 : 1;
    return c.weekly.map(function (w) { return [w[0], base ? w[col] / base : null]; });
  }
  function portSeries(signals, code) {
    var p = signals && signals.ports && signals.ports[code]; if (!p || !p.weekly || !p.baseline) return null;
    var t0 = Date.parse(p.weekStart + "T00:00:00Z");
    return p.weekly.map(function (v, i) { return [new Date(t0 + (i * 7 + 6) * 864e5).toISOString().slice(0, 10), v == null ? null : v / p.baseline]; });
  }
  // several ports: a week counts if at least `need` of them are below the threshold
  function jointPortSeries(signals, codes, threshold, need) {
    var ss = codes.map(function (c) { return portSeries(signals, c); }).filter(Boolean);
    if (!ss.length) return null;
    var n = Math.min.apply(null, ss.map(function (s) { return s.length; }));
    var out = [];
    for (var i = 0; i < n; i++) {
      var below = ss.filter(function (s) { return s[i][1] != null && s[i][1] < threshold; }).length;
      out.push([ss[0][i][0], below >= Math.min(need, ss.length) ? threshold * 0.5 : 1]);
    }
    return out;
  }

  // Evidence for one event: {episodes, years, n}
  function evidenceFor(signals, ev) {
    var e = ev.evidence; if (!e || !signals) return null;
    var series = e.choke ? chokeSeries(signals, e.choke, e.field)
      : e.ports ? (e.ports.length > 1 ? jointPortSeries(signals, e.ports, e.threshold, e.need || e.ports.length) : portSeries(signals, e.ports[0]))
      : null;
    if (!series || series.length < 52) return null;
    var eps = episodes(series, e.threshold, e.minWeeks || 1, e.mergeGap || 0, { maxWeeks: e.maxWeeks, fromNormal: e.fromNormal });
    var years = series.length / 52.18;
    return { episodes: eps, n: eps.length, years: years, from: series[0][0], to: series[series.length - 1][0], what: e.label || "" };
  }

  // ---------------------------------------------------------------- Poisson–Gamma update
  function gammaSample(rng, a) { // Marsaglia–Tsang, shape a, scale 1
    if (a < 1) return gammaSample(rng, a + 1) * Math.pow(rng(), 1 / a);
    var d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      var x, v;
      do { var u1 = rng(), u2 = rng(); x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
      v = v * v * v; var u = rng();
      if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function posterior(priorP, n, years, priorYears) {
    var w = priorYears || 5, lam0 = -Math.log(1 - Math.min(0.99, priorP));
    var a = lam0 * w + n, b = w + years;
    var rng = M.mulberry32(97), xs = [];
    for (var i = 0; i < 4000; i++) xs.push(gammaSample(rng, a) / b);
    xs.sort(function (x, y) { return x - y; });
    var toP = function (l) { return 1 - Math.exp(-l); };
    return { rate: a / b, p: toP(a / b), lo: toP(xs[Math.floor(0.1 * xs.length)]), hi: toP(xs[Math.floor(0.9 * xs.length)]), a: a, b: b };
  }

  // ---------------------------------------------------------------- settings -> adjusted library
  /*
   * settings: { source: "assumed"|"data", climate: "today"|..., correlated: bool }
   * Returns { data: copy of data with adjusted annualProb/durations, drivers: [...], table: [...] }
   * table rows: {id, name, assumed, evidence, posterior, used}
   */
  function adjust(data, signals, settings) {
    settings = settings || {};
    var clim = (data.climate || {})[settings.climate || "today"] || {};
    var table = [];
    var events = data.events.map(function (ev) {
      var e = Object.assign({}, ev), row = { id: ev.id, name: ev.name, kind: ev.kind, type: ev.type, assumed: ev.annualProb || 0 };
      var evd = evidenceFor(signals, ev);
      if (evd) { row.evidence = evd; row.posterior = posterior(row.assumed, evd.n, evd.years, data.priorYears); }
      var p = row.assumed;
      if (settings.source === "data" && row.posterior) p = row.posterior.p;
      // climate: weather events more likely / longer
      var mult = (clim.probMult && (clim.probMult[ev.id] || clim.probMult[ev.type])) || 1;
      var dmult = (clim.durationMult && (clim.durationMult[ev.id] || clim.durationMult[ev.type])) || 1;
      p = Math.min(0.95, p * mult);
      if (dmult !== 1 && ev.duration) e.duration = { actual: ev.duration.actual, min: ev.duration.min * dmult, mode: ev.duration.mode * dmult, max: ev.duration.max * dmult };
      e.annualProb = p; row.used = p; row.climateMult = mult;
      table.push(row);
      return e;
    });
    // drivers: qBase = how often driver years happen normally (used to split each event's rate);
    // q = how often under this climate scenario. When they differ (e.g. a certain El Niño
    // year), the driver's events take the scenario's effective likelihood.
    var drivers = (data.drivers || []).map(function (d) {
      var q = clim.drivers && clim.drivers[d.id] != null ? clim.drivers[d.id] : d.q;
      return Object.assign({}, d, { q: q, qBase: d.q });
    });
    drivers.forEach(function (d) {
      if (d.q === d.qBase) return;
      events.forEach(function (e, i) {
        if (d.events.indexOf(e.id) < 0 || !e.annualProb) return;
        var sp = driverSplit(e.annualProb, d.qBase, d.m);
        e.annualProb = d.q * sp.hi + (1 - d.q) * sp.lo;
        table[i].used = e.annualProb; table[i].driverForced = d.name;
        e._split = { lo: sp.lo, hi: sp.hi }; // keep the split so sampling stays consistent
      });
    });
    return { data: Object.assign({}, data, { events: events }), drivers: settings.correlated === false ? [] : drivers, table: table };
  }

  // Per-event (p in normal years, p in driver years) so marginals stay at p.
  function driverSplit(p, q, m) {
    var lam = -Math.log(1 - Math.min(0.99, p)), lo = lam / (q * m + 1 - q), hi = lo * m;
    return { lo: 1 - Math.exp(-lo), hi: 1 - Math.exp(-hi) };
  }

  var api = { episodes: episodes, chokeSeries: chokeSeries, portSeries: portSeries, jointPortSeries: jointPortSeries,
    evidenceFor: evidenceFor, posterior: posterior, adjust: adjust, driverSplit: driverSplit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasLikelihood = api;
})(typeof window !== "undefined" ? window : globalThis);
