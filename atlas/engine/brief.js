/*
 * brief.js — "since your last visit": what changed in the live data that matters to this
 * network (v5.1).
 *
 * summarise(signals) keeps a small fingerprint of a snapshot (chokepoint and port ratios,
 * hazard keys). compare(prev, now, ctx) lists the changes — status crossings at chokepoints
 * and ports, new hazard alerts near the network — weighted by the network's exposure, most
 * important first. With no previous visit it describes today's picture instead.
 *
 * Pure. Browser global window.AtlasBrief; CommonJS for node.
 */
(function (root) {
  "use strict";
  function chokeBand(r) { return r == null ? "n/a" : r < 0.35 ? "avoided" : r < 0.85 ? "reduced" : r > 1.3 ? "elevated" : "normal"; }
  function portBand(r) { return r == null ? "n/a" : r < 0.35 ? "near-shut" : r < 0.6 ? "reduced" : "normal"; }
  var RANK = { avoided: 3, "near-shut": 3, reduced: 2, elevated: 1, normal: 0, "n/a": 0 };

  function summarise(signals) {
    if (!signals) return null;
    var s = { asOf: null, chokes: {}, ports: {}, hazards: [] };
    Object.keys(signals.chokepoints || {}).forEach(function (k) {
      var c = signals.chokepoints[k];
      if (c.baseline && c.baseline.container >= 1) s.chokes[k] = { name: c.name, ratio: c.ratio };
      if (!s.asOf || c.asOf > s.asOf) s.asOf = c.asOf;
    });
    Object.keys(signals.ports || {}).forEach(function (k) { s.ports[k] = { ratio: signals.ports[k].ratio }; });
    (signals.hazards || []).concat(signals.disruptions || []).forEach(function (h) { s.hazards.push(h.src + "|" + (h.id || h.name) + "|" + h.from); });
    return s;
  }

  /*
   * ctx: { exposure: [{wp, name, share}], chokeIds: {wp: portwatchId}, portFlow: {code: TEU/wk},
   *        portNames: {code: name}, alerts: [{name, hz, nearest:{name,km}}], alertKeys: {hazardKey: alert} }
   */
  function compare(prev, now, ctx) {
    var items = [];
    if (!now) return { items: [{ level: "info", text: "No live data snapshot available." }], first: true };
    var expByPw = {}; (ctx.exposure || []).forEach(function (e) { if (ctx.chokeIds[e.wp]) expByPw[ctx.chokeIds[e.wp]] = e; });
    var first = !prev;
    Object.keys(now.chokes).forEach(function (k) {
      var c = now.chokes[k], before = prev && prev.chokes[k], e = expByPw[k];
      var bNow = chokeBand(c.ratio), bPrev = before ? chokeBand(before.ratio) : null;
      var share = e ? Math.round(e.share * 100) : 0;
      var tail = share ? " — " + share + "% of your volume passes here" : "";
      if (first) {
        if (RANK[bNow] >= 2) items.push({ level: bNow === "avoided" ? "critical" : "warning", weight: (RANK[bNow] * 10) + share, text: c.name + " is " + bNow + " (" + Math.round(c.ratio * 100) + "% of normal container traffic)" + tail + "." });
      } else if (bPrev !== bNow) {
        var worse = RANK[bNow] > RANK[bPrev];
        items.push({ level: worse ? (bNow === "avoided" ? "critical" : "warning") : "good", weight: 30 + share, text: c.name + (worse ? " worsened" : " improved") + " from " + bPrev + " to " + bNow + " (" + Math.round((before.ratio || 0) * 100) + "% → " + Math.round(c.ratio * 100) + "% of normal)" + tail + "." });
      }
    });
    Object.keys(ctx.portFlow || {}).forEach(function (code) {
      var p = now.ports[code]; if (!p) return;
      var before = prev && prev.ports[code], bNow = portBand(p.ratio), bPrev = before ? portBand(before.ratio) : null;
      var name = (ctx.portNames || {})[code] || code, tail = " — " + Math.round(ctx.portFlow[code]) + " TEU/wk of yours goes through it";
      if (first) { if (RANK[bNow] >= 2) items.push({ level: "warning", weight: 20, text: name + " port is " + bNow + " (" + Math.round(p.ratio * 100) + "% of normal calls)" + tail + "." }); }
      else if (bPrev !== bNow) items.push({ level: RANK[bNow] > RANK[bPrev] ? "warning" : "good", weight: 25, text: name + " port went from " + bPrev + " to " + bNow + tail + "." });
    });
    var seen = {}; (prev ? prev.hazards : []).forEach(function (h) { seen[h] = 1; });
    (ctx.alerts || []).forEach(function (a) {
      var fresh = !prev || !(a.srcKey && seen[a.srcKey]);
      if (!fresh) return;
      items.push({ level: a.severity >= 4 ? "warning" : "info", weight: 15 + a.severity, text: (prev ? "New alert: " : "Alert: ") + a.name + " — near " + a.nearest.name + " (" + a.nearest.km + " km). Ready to model in the Live tab." });
    });
    items.sort(function (x, y) { return (y.weight || 0) - (x.weight || 0); });
    if (!items.length) items.push({ level: "good", text: prev ? "No material change for your network since your last visit (" + prev.asOf + ")." : "Nothing on your network is disrupted in today's data." });
    return { items: items, first: first, since: prev ? prev.asOf : null, asOf: now.asOf };
  }

  function markdown(brief, title) {
    var icon = { critical: "🔴", warning: "🟠", good: "🟢", info: "🔵" };
    return "# " + (title || "Disruption brief") + "\n\n" + (brief.first ? "Today's picture" : "Changes since " + brief.since) + " · live data to " + brief.asOf + "\n\n" +
      brief.items.map(function (i) { return "- " + (icon[i.level] || "-") + " " + i.text; }).join("\n") + "\n";
  }

  var api = { summarise: summarise, compare: compare, markdown: markdown };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasBrief = api;
})(typeof window !== "undefined" ? window : globalThis);
