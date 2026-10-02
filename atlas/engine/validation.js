/*
 * validation.js — check the model's assumptions against what actually happened.
 *
 * Each check computes a model figure (from the sea graph or the event library) and an
 * observed figure (from the IMF PortWatch weekly series in the live snapshot, or a cited
 * public figure), and passes or flags it against a stated tolerance. Recomputed whenever
 * the snapshot refreshes, so the page never shows a stale validation.
 *
 * Pure. Browser global window.AtlasValidation; CommonJS for node --test.
 */
(function (root) {
  "use strict";
  var Sea = root.AtlasSea || (typeof require === "function" ? require("./seagraph.js") : null);

  function windowRatio(ch, from, to, field) {
    if (!ch || !ch.weekly) return null;
    var col = field === "total" ? 2 : 1;
    var w = ch.weekly.filter(function (x) { return x[0] >= from && x[0] <= to; });
    if (!w.length) return null;
    var avg = w.reduce(function (s, x) { return s + x[col]; }, 0) / w.length;
    var base = field === "total" ? ch.baseline.total : ch.baseline.container;
    return base ? avg / base : null;
  }
  function pct(x) { return x == null ? "—" : Math.round(x * 100) + "%"; }
  function ev(data, id) { return data.events.filter(function (e) { return e.id === id; })[0]; }

  function run(signals, data) {
    var C = (signals && signals.chokepoints) || {}, out = [];
    var speed = data.defaults.speedKn;
    function add(row) { out.push(row); }

    // 1. Distance calibration
    var suez = Sea.route("CNSHA", "NLRTM", { avoid: { PANAMA: true } });
    add({ topic: "Sea routing", claim: "Shanghai → Rotterdam via Suez", model: Math.round(suez.nm).toLocaleString("en-US") + " nm",
      observed: "≈10,500 nm (standard port-distance tables)", ok: Math.abs(suez.nm - 10500) / 10500 < 0.06, note: "Tolerance ±6%." });

    // 2. Red Sea: extra days round the Cape
    var cape = Sea.route("CNSHA", "NLRTM", { closed: { BAM: true }, avoid: { PANAMA: true } });
    var extraDays = (cape.nm - suez.nm) / (speed * 24);
    add({ topic: "Red Sea crisis", claim: "Extra sailing time Asia → North Europe via the Cape", model: "+" + extraDays.toFixed(1) + " days at " + speed + " kn",
      observed: "“an extra ten days” (Wikipedia, Red Sea crisis)", ok: extraDays >= 8 && extraDays <= 14, note: "Tolerance 8–14 days; actual services vary with speed and port calls.",
      url: "https://en.wikipedia.org/wiki/Red_Sea_crisis" });

    // 3. Red Sea: Bab-el-Mandeb container traffic in 2024
    var bam = windowRatio(C.chokepoint4, "2024-01-01", "2024-12-31");
    add({ topic: "Red Sea crisis", claim: "Container lines avoid Bab-el-Mandeb (modelled as closed)", model: "Closed to modelled Asia/India/Gulf–Europe services",
      observed: bam == null ? "no data" : "2024 container transits " + pct(bam) + " of normal", ok: bam != null && bam < 0.35,
      note: "Passes if 2024 traffic sits below the Atlas's 35% 'avoided' threshold; the remainder is regional and non-mainline traffic." });

    // 4. Red Sea: Cape traffic rises
    var cp = windowRatio(C.chokepoint7, "2024-01-01", "2024-12-31");
    add({ topic: "Red Sea crisis", claim: "Diverted services sail round the Cape", model: "All diverted Europe-bound services route via the Cape",
      observed: cp == null ? "no data" : "2024 Cape container transits " + pct(cp) + " of normal", ok: cp != null && cp > 1.5, note: "Passes if Cape traffic rose by more than half." });

    // 5. Ever Given: two weeks around the closure
    var eg = windowRatio(C.chokepoint1, "2021-03-21", "2021-04-03");
    var egModel = (14 - ev(data, "evergiven-2021").duration.actual) / 14;
    add({ topic: "Ever Given, Mar 2021", claim: "6-day Suez closure, seen over the two weeks around it", model: pct(egModel) + " of normal transits expected",
      observed: eg == null ? "no data" : pct(eg) + " of normal", ok: eg != null && Math.abs(eg - egModel) < 0.15, note: "Tolerance ±15 points (weekly buckets, backlog clearing)." });

    // 6. Panama drought: container vs all vessels
    var pe = ev(data, "panama-2023"), pcap = pe.effects.choke.PANAMA.cap;
    var pc = windowRatio(C.chokepoint2, "2023-11-01", "2024-03-31"), pt = windowRatio(C.chokepoint2, "2023-11-01", "2024-03-31", "total");
    add({ topic: "Panama drought, 2023–24", claim: "Container-service capacity through the canal", model: pct(pcap) + " capacity + " + pe.effects.choke.PANAMA.delay + " d queue",
      observed: pc == null ? "no data" : "Nov–Mar container transits " + pct(pc) + "; all vessels " + pct(pt), ok: pc != null && Math.abs(pc - pcap) < 0.15,
      note: "Container lines largely kept their booked slots; bulk and gas carriers took most of the cuts. Recalibrated in v2.1 (was 60%)." });

    // 7. Live: Hormuz
    var hz = C.chokepoint6;
    if (hz) add({ topic: "Live, 2026", claim: "Strait of Hormuz treated as avoided in Live conditions", model: hz.ratio < 0.35 ? "Avoided (closed)" : hz.ratio < 0.85 ? "Squeezed" : "Normal",
      observed: "Last 7 days " + pct(hz.ratio) + "; since 8 Mar 2026 " + pct(windowRatio(hz, "2026-03-08", "2099-01-01")), ok: true, note: "Consistent by construction — shown so the live rule can be audited." });
    return out;
  }

  var api = { run: run, windowRatio: windowRatio };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasValidation = api;
})(typeof window !== "undefined" ? window : globalThis);
