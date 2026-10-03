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
  function dyn() { return root.AtlasDynamics || (typeof require === "function" ? require("./dynamics.js") : null); }

  function windowRatio(ch, from, to, field) {
    if (!ch || !ch.weekly) return null;
    var col = field === "total" ? 2 : 1;
    var w = ch.weekly.filter(function (x) { return x[0] >= from && x[0] <= to; });
    if (!w.length) return null;
    var avg = w.reduce(function (s, x) { return s + x[col]; }, 0) / w.length;
    var base = field === "total" ? ch.baseline.total : ch.baseline.container;
    return base ? avg / base : null;
  }
  // Average daily container calls for a port over [from, to], as a share of its baseline.
  function portWindow(p, from, to) {
    if (!p || !p.weekly || !p.baseline) return null;
    var t0 = Date.parse(p.weekStart + "T00:00:00Z"), wk = function (d) { return Math.floor((Date.parse(d + "T00:00:00Z") - t0) / (7 * 864e5)); };
    var xs = p.weekly.slice(Math.max(0, wk(from)), wk(to) + 1).filter(function (x) { return x != null; });
    return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length / p.baseline : null;
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

    // 7. Baltimore 2024: a port-closure event, checked with PortWatch port calls
    var bp = signals && signals.ports && signals.ports.USBAL, be = ev(data, "baltimore-2024");
    var bObs = portWindow(bp, "2024-03-31", "2024-05-31"), bRec = portWindow(bp, "2024-07-01", "2024-08-31");
    if (be) add({ topic: "Baltimore, 2024", claim: "Key Bridge collapse leaves the port near-shut for weeks", model: pct(be.effects.ports.USBAL.cap) + " capacity for " + be.duration.actual + " days",
      observed: bObs == null ? "no data" : "Apr–May container calls " + pct(bObs) + " of normal; Jul–Aug " + pct(bRec), ok: bObs != null && Math.abs(bObs - be.effects.ports.USBAL.cap) < 0.15 && bRec > 0.6,
      note: "Passes if the closure-period calls match the modelled capacity (±15 points) and traffic was back above 60% after the reopening." });

    // 8–9. Time-phased simulation: backlog behaviour after a blockage and a strike
    var Dy = dyn();
    if (Dy && data.network) {
      var ctx0 = Dy.prepare(data, data.network, [], {});
      var egEv = ev(data, "evergiven-2021");
      if (egEv && ctx0.chokeFlow.SUEZ) {
        var rEg = Dy.analyse(data, data.network, [egEv], {}), passE = rEg.chokePass.SUEZ || {}, baseE = ctx0.chokeFlow.SUEZ / 7, clear = 0;
        for (var d = egEv.duration.actual; d < egEv.duration.actual + 30; d++) if ((passE[d] || 0) > baseE * 1.05) clear++;
        add({ topic: "Ever Given, Mar 2021", claim: "Queue at the canal clears after reopening (time-phased model)", model: clear + " days to clear the backlog",
          observed: "Freed 29 Mar; backlog “finally cleared by 3 April” (~5 days)", ok: Math.abs(clear - 5) <= 2,
          note: "Calibrates the canal's surge capacity (+120%). Tolerance ±2 days.", url: "https://en.wikipedia.org/wiki/2021_Suez_Canal_obstruction" });
      }
      var stEv = ev(data, "ila-2024"), sv = signals && signals.ports && signals.ports.USSAV, ny = signals && signals.ports && signals.ports.USNYC;
      if (stEv && ctx0.portIn.USSAV && sv && ny) {
        var rSt = Dy.analyse(data, data.network, [stEv], {}), pp = rSt.portPass.USSAV || {}, bS = ctx0.portIn.USSAV / 7;
        var wkM = function (k) { var x = 0; for (var i = k * 7; i < k * 7 + 7; i++) x += pp[i] || 0; return x / 7 / bS; };
        var obsWeek = (portWindow(sv, "2024-09-29", "2024-10-05") + portWindow(ny, "2024-09-29", "2024-10-05")) / 2;
        var obsAfter = (portWindow(sv, "2024-10-06", "2024-10-26") + portWindow(ny, "2024-10-06", "2024-10-26")) / 2;
        var mWeek = wkM(0), mAfter = (wkM(1) + wkM(2) + wkM(3)) / 3;
        add({ topic: "US East Coast strike, Oct 2024", claim: "3-day stoppage: the week dips, the backlog spreads over the next weeks", model: "strike week " + pct(mWeek) + "; next 3 weeks " + pct(mAfter),
          observed: "Savannah + New York calls: strike week " + pct(obsWeek) + "; next 3 weeks " + pct(obsAfter), ok: Math.abs(mWeek - obsWeek) < 0.15 && Math.abs(mAfter - obsAfter) < 0.12,
          note: "Calibrates port surge capacity (+15%). Tolerance ±15 points for the strike week, ±12 for the catch-up." });
      }
    }

    // 10. Live: Hormuz
    var hz = C.chokepoint6;
    if (hz) add({ topic: "Live, 2026", claim: "Strait of Hormuz treated as avoided in Live conditions", model: hz.ratio < 0.35 ? "Avoided (closed)" : hz.ratio < 0.85 ? "Squeezed" : "Normal",
      observed: "Last 7 days " + pct(hz.ratio) + "; since 8 Mar 2026 " + pct(windowRatio(hz, "2026-03-08", "2099-01-01")), ok: true, note: "Consistent by construction — shown so the live rule can be audited." });
    return out;
  }

  var api = { run: run, windowRatio: windowRatio, portWindow: portWindow };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasValidation = api;
})(typeof window !== "undefined" ? window : globalThis);
