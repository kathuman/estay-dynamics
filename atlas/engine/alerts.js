/*
 * alerts.js — turn live hazard alerts near a network into ready-to-run scenarios.
 *
 * Inputs: the live snapshot (GDACS orange/red alerts, USGS M6+ earthquakes, PortWatch port-
 * disruption events with the ports they affected) and a network. For each hazard close
 * enough to the network's factories or ports, build an "alert" event whose effects come from
 * a per-hazard-type template in data.js (`hazardTemplates`) — stated assumptions, shown on the
 * event card, never presented as a forecast.
 *
 * Pure. Browser global window.AtlasAlerts; CommonJS for node --test.
 */
(function (root) {
  "use strict";
  var Sea = root.AtlasSea || (typeof require === "function" ? require("./seagraph.js") : null);

  var TYPE = { TC: "weather", FL: "weather", DR: "weather", EQ: "earthquake", VO: "natural", WF: "natural" };
  var LABEL = { TC: "Tropical cyclone", FL: "Flood", DR: "Drought", EQ: "Earthquake", VO: "Volcano", WF: "Wildfire" };

  function km(a, b) { return Sea.gcNm(a, b) * 1.852; }
  // The same storm or quake often appears in GDACS and PortWatch — this key matches them.
  function keyOf(h) { return h.type + "|" + Math.round(h.lat) + "|" + Math.round(h.lng) + "|" + String(h.from).slice(0, 7); }

  function networkPorts(net) {
    var set = {};
    (net.services || []).forEach(function (s) { set[s.from] = 1; set[s.to] = 1; });
    (net.factories || []).forEach(function (f) { (f.exports || []).forEach(function (x) { set[x.port] = 1; }); });
    (net.dcs || []).forEach(function (d) { (d.imports || []).forEach(function (x) { set[x.port] = 1; }); });
    return Object.keys(set).map(function (code) {
      var p = (net.ports && net.ports[code]) || Sea.PORTS[code];
      return p ? { code: code, name: p.name, lat: p.lat, lng: p.lng } : null;
    }).filter(Boolean);
  }

  function template(tpls, h) {
    var t = tpls[h.type];
    if (!t) return null;
    if (Array.isArray(t)) { // earthquakes: pick the band for the magnitude
      var mag = h.mag || magFrom(h);
      return t.filter(function (x) { return mag >= x.minMag; })[0] || null;
    }
    return t;
  }
  function magFrom(h) { var m = /M\s*([\d.]+)/i.exec((h.name || "") + " " + (h.severity || "")); return m ? +m[1] : 6; }
  function severityOf(h) {
    var a = String(h.alert || "").toLowerCase();
    if (a === "red") return 5;
    if (a === "orange") return 4;
    if (h.type === "EQ") { var m = h.mag || magFrom(h); return m >= 7.5 ? 5 : m >= 7 ? 4 : 3; }
    return 3;
  }

  // Returns alert events, nearest/most severe first.
  function build(signals, net, tpls, opts) {
    opts = opts || {};
    if (!signals || !net || !tpls) return [];
    var ports = networkPorts(net), facs = (net.factories || []).filter(function (f) { return f.cap > 0 || f.standby; });
    // PortWatch events first: they carry the list of ports actually affected, so when the same
    // event also arrives from GDACS/USGS, the richer copy is the one kept.
    var hazards = (signals.disruptions || []).concat(signals.hazards || []);
    var seen = {}, out = [];
    hazards.forEach(function (h) {
      var key = keyOf(h);
      if (seen[key]) return; seen[key] = 1;
      var t = template(tpls, h); if (!t) return;
      var eff = { ports: {}, supply: {} }, near = [];
      ports.forEach(function (p) {
        var d = km(h, p), listed = (h.ports || []).indexOf(p.code) >= 0;
        if (t.port && (listed || d <= t.radiusKm)) { eff.ports[p.code] = { cap: t.port.cap, delay: t.port.delay }; near.push({ kind: "port", name: p.name, km: Math.round(d), listed: listed }); }
      });
      facs.forEach(function (f) {
        var d = km(h, f);
        if (t.supply != null && d <= (t.supplyRadiusKm || t.radiusKm)) { eff.supply[f.id] = t.supply; near.push({ kind: "factory", name: f.name, km: Math.round(d) }); }
      });
      // The canal's water comes from the Gatún watershed in Panama itself, so a drought counts
      // only when GDACS lists Panama among the affected countries (drought points are regional centroids).
      if (t.panama && Sea.WP.PANAMA && /panama/i.test((h.name || "") + " " + (h.country || ""))) {
        eff.choke = { PANAMA: { cap: t.panama.cap, delay: t.panama.delay } };
        near.push({ kind: "chokepoint", name: "Panama Canal", km: Math.round(km(h, Sea.WP.PANAMA)) });
      }
      if (!near.length) return;
      near.sort(function (a, b) { return a.km - b.km; });
      var id = "alert-" + String(h.src).toLowerCase() + "-" + (h.id || (h.type + "-" + h.from + "-" + Math.round(h.lat * 10) + "-" + Math.round(h.lng * 10)));
      var what = near.slice(0, 4).map(function (n) { return n.name + " (" + n.kind + (n.listed ? ", listed by PortWatch" : ", " + n.km + " km") + ")"; }).join(", ");
      out.push({
        id: id, kind: "alert", type: TYPE[h.type] || "natural", hazard: h.type, hz: key,
        name: (LABEL[h.type] || "Hazard") + ": " + (h.name.length > 70 ? h.name.slice(0, 68).replace(/[,\s]+\S*$/, "") + "…" : h.name), period: (h.from || "") + (h.to && h.to !== h.from ? " → " + h.to : ""),
        lat: h.lat, lng: h.lng, severity: severityOf(h),
        description: h.src + " " + (h.alert ? String(h.alert).toLowerCase() + " " : "") + "alert. Near your network: " + what + (near.length > 4 ? " and " + (near.length - 4) + " more" : "") +
          ". Modelled with the Atlas's " + (LABEL[h.type] || "hazard").toLowerCase() + " template — an assumption to adjust, not a forecast.",
        source: { label: h.src + " report", url: h.url || "https://www.gdacs.org/" },
        effects: eff, duration: { actual: t.duration.mode, min: t.duration.min, mode: t.duration.mode, max: t.duration.max }, annualProb: 0,
        nearest: near[0], nearby: near
      });
    });
    return out.sort(function (a, b) { return b.severity - a.severity || a.nearest.km - b.nearest.km; }).slice(0, opts.max || 12);
  }

  var api = { build: build, networkPorts: networkPorts, keyOf: keyOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasAlerts = api;
})(typeof window !== "undefined" ? window : globalThis);
