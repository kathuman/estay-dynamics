/*
 * describe.js — turn a plain-language description into a structured disruption (v5.1).
 *
 * "Busan port strike for three weeks, half capacity" ->
 *   { type: "strike", effects: { ports: { KRPUS: { cap: 0.5 } } }, duration: 21 days }
 *
 * Deterministic phrase matching, not an AI model: it recognises places (ports, chokepoints,
 * seas, suppliers, factories), the kind of event, severity words, durations and rate
 * shocks, and says what it matched and what it assumed, so the user reviews the event
 * before adding it. Anything it can't place is reported, never guessed.
 *
 * Pure. Browser global window.AtlasDescribe; CommonJS for node.
 */
(function (root) {
  "use strict";
  var Sea = root.AtlasSea || (typeof require === "function" ? require("./seagraph.js") : null);
  var Ship = root.AtlasShipments || (typeof require === "function" ? require("./shipments.js") : null);

  var KINDS = [
    { type: "strike", re: /\b(strike|strikes|walk ?out|stoppage|industrial action|labou?r (dispute|action))\b/, port: 0, label: "Strike", days: 7 },
    { type: "weather", re: /\b(typhoon|hurricane|cyclone|storm)\b/, port: 0, supply: 0.6, label: "Storm", days: 4 },
    { type: "weather", re: /\b(flood|floods|flooding)\b/, port: 0.7, supply: 0.4, supplier: 0.3, label: "Flood", days: 30 },
    { type: "earthquake", re: /\b(earthquake|quake|tsunami)\b/, port: 0.5, supply: 0.5, supplier: 0.3, label: "Earthquake", days: 21 },
    { type: "congestion", re: /\b(congest\w*|backlog|queue\w*|gridlock)\b/, port: 0.7, delay: 10, label: "Congestion", days: 60 },
    { type: "cyber", re: /\b(cyber\w*|ransomware|hack\w*|it outage|system outage)\b/, port: 0.2, delay: 3, label: "Cyberattack", days: 7 },
    { type: "geopolitical", re: /\b(attack\w*|war|conflict|missile\w*|blockade\w*|sanction\w*|piracy|houthi)\b/, closed: true, port: 0.3, label: "Conflict", days: 90 },
    { type: "weather", re: /\b(drought|low water)\b/, choke: 0.8, delay: 4, label: "Drought", days: 180 },
    { type: "pandemic", re: /\b(lockdown|covid|outbreak|pandemic|quarantine)\b/, port: 0.7, supply: 0.5, label: "Lockdown", days: 45 },
    { type: "accident", re: /\b(fire|explosion|outage|breakdown|grounding|grounded|collapse)\b/, port: 0.3, supply: 0.2, supplier: 0.2, label: "Outage", days: 14 },
    { type: "geopolitical", re: /\b(closed?|closure|blocked|shut( down)?)\b/, closed: true, port: 0, label: "Closure", days: 14 }
  ];
  var CHOKE_WORDS = {
    BAM: /\b(bab[- ]?el[- ]?mandeb|red sea|houthi\w*)\b/, SUEZ: /\bsuez\b/, PANAMA: /\bpanama( canal)?\b/, MAL: /\bmalacca\b/, HORMUZ: /\bhormuz\b/,
    TWS: /\btaiwan strait\b/, GIB: /\bgibraltar\b/, DOVER: /\b(dover|english channel)\b/, KOREA: /\bkorea strait\b/, LUZON: /\bluzon strait\b/,
    SUNDA: /\bsunda\b/, LOMBOK: /\blombok\b/, TORR: /\btorres strait\b/, ORES: /\b(oresund|øresund|danish straits)\b/, TSUG: /\btsugaru\b/,
    YUC: /\byucatan\b/, WIND: /\bwindward passage\b/, CAPE: /\bcape of good hope\b/
  };
  var NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fortnight: 2, couple: 2, few: 3, several: 4 };
  var UNIT = { day: 1, days: 1, week: 7, weeks: 7, fortnight: 14, month: 30, months: 30, year: 365, years: 365 };

  function duration(t) {
    if (/\bfortnight\b/.test(t)) return 14;
    var m = /\b(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple of|few|several)\s+(day|days|week|weeks|month|months|year|years)\b/.exec(t);
    if (!m) return null;
    var n = parseFloat(m[1]); if (isNaN(n)) n = NUM[m[1].replace(" of", "")] || 1;
    return Math.round(n * UNIT[m[2]]);
  }
  function severity(t) {
    var m = /\b(?:at|to|down to|only)\s+(\d{1,3})\s*%/.exec(t) || /\b(\d{1,3})\s*%\s*(?:of\s+)?(?:capacity|normal|output)\b/.exec(t);
    if (m) return Math.max(0, Math.min(1, +m[1] / 100));
    if (/\b(half|50 ?percent)\b/.test(t)) return 0.5;
    if (/\b(a third|one third)\b/.test(t)) return 0.33;
    if (/\b(partial\w*|reduced|slow\w*|disrupted|limited)\b/.test(t)) return 0.6;
    if (/\b(complete\w*|total\w*|full\w*|entirely|fully|all)\b/.test(t)) return 0;
    return null;
  }
  function rateShock(t) {
    if (/\brates?\b[^.]*\b(triple|treble)\w*/.test(t)) return 2;
    if (/\brates?\b[^.]*\bdouble\w*/.test(t)) return 1;
    var m = /\brates?\b[^.]*\b(?:up|rise|rising|jump|jumps|increase|increases|climb)\w*\s+(?:by\s+)?(\d{1,3})\s*%/.exec(t);
    return m ? +m[1] / 100 : null;
  }

  // Ports: try 1–3 word windows against the shipment importer's matcher (codes and names)
  function findPorts(text) {
    var words = text.replace(/[^a-zA-Z0-9 /-]/g, " ").split(/\s+/).filter(Boolean), found = {};
    for (var n = 3; n >= 1; n--) for (var i = 0; i + n <= words.length; i++) {
      var phrase = words.slice(i, i + n).join(" ");
      if (phrase.length < 4 && !/^[A-Z]{5}$/.test(phrase)) continue;
      if (/^(port|ports|the|strike|closed|for|weeks?|days?|months?|half|rates?|at|and|of|in|on|with|due|near|red|sea|canal|strait)$/i.test(phrase)) continue;
      var c = Ship.matchPort(phrase);
      if (c && !found[c]) found[c] = phrase;
    }
    return found;
  }

  function parse(text, data, net) {
    var raw = String(text || "").trim(), t = raw.toLowerCase(), notes = [], matched = [];
    if (!raw) return { event: null, notes: ["Describe what happens, where, and for how long."], matched: [] };
    var kind = KINDS.filter(function (k) { return k.re.test(t); })[0] || null;
    if (!kind) notes.push("No event type recognised — treated as a capacity cut.");
    kind = kind || { type: "accident", port: 0.5, supply: 0.5, supplier: 0.5, label: "Disruption", days: 14 };
    var sev = severity(t), eff = { closed: [], choke: {}, ports: {}, supply: {}, suppliers: {} };
    // chokepoints
    Object.keys(CHOKE_WORDS).forEach(function (w) {
      if (!CHOKE_WORDS[w].test(t) || !Sea.CHOKES[w]) return;
      var name = Sea.CHOKES[w].name;
      if (kind.choke != null && sev == null) { eff.choke[w] = { cap: kind.choke, delay: kind.delay || 0 }; matched.push(name + " at " + Math.round(kind.choke * 100) + "% capacity"); }
      else if (kind.closed || sev === 0 || (sev == null && kind.port === 0)) { eff.closed.push(w); matched.push(name + " closed"); }
      else { var cap = sev != null ? sev : 0.6; eff.choke[w] = { cap: cap, delay: kind.delay || Math.round((1 - cap) * 8) }; matched.push(name + " at " + Math.round(cap * 100) + "% capacity"); }
    });
    // ports (skip words already used for chokepoints such as "Panama")
    var ports = findPorts(raw);
    Object.keys(ports).forEach(function (code) {
      if (code === "PABLB" && eff.closed.concat(Object.keys(eff.choke)).indexOf("PANAMA") >= 0) return;
      var cap = sev != null ? sev : (kind.port != null ? kind.port : 0.5);
      eff.ports[code] = { cap: cap, delay: kind.delay || 0 };
      matched.push(Sea.PORTS[code].name + " port at " + Math.round(cap * 100) + "% capacity");
    });
    // suppliers and factories by distinctive name words
    function distinct(name) { return name.toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z]+/).filter(function (w) { return w.length > 4 && !/^(cluster|industrial|assembly|manufacturing|electronics|components|semiconductor|standby|second|source|specialty|chemicals|storage|display|panels|park|zone|export)$/.test(w); }); }
    (net.suppliers || []).forEach(function (s) {
      var hit = distinct(s.name).some(function (w) { return t.indexOf(w) >= 0; }) || (/\b(chip|fab|fabs|semiconductor)\b/.test(t) && /\btaiwan|hsinchu|tsmc\b/.test(t) && s.id === "s-hsinchu");
      if (!hit) return;
      var f = sev != null ? sev : (kind.supplier != null ? kind.supplier : 0.3);
      eff.suppliers[s.id] = f; matched.push(s.name + " output " + Math.round(f * 100) + "%");
    });
    net.factories.forEach(function (fa) {
      if (!distinct(fa.name).some(function (w) { return t.indexOf(w) >= 0; })) return;
      var f = sev != null ? sev : (kind.supply != null ? kind.supply : 0.5);
      eff.supply[fa.id] = f; matched.push(fa.name + " output " + Math.round(f * 100) + "%");
    });
    var up = rateShock(t);
    if (up != null) { eff.uplift = { "*": up }; matched.push("Freight rates +" + Math.round(up * 100) + "% on all trades"); }
    var nPlaces = eff.closed.length + Object.keys(eff.choke).length + Object.keys(eff.ports).length + Object.keys(eff.supply).length + Object.keys(eff.suppliers).length;
    if (!nPlaces) { notes.push("No port, chokepoint, supplier or factory recognised — name one (e.g. “Rotterdam”, “Suez”, “Hsinchu fabs”, or a UN/LOCODE like NLRTM)."); return { event: null, notes: notes, matched: matched }; }
    var d = duration(t);
    var art = function (w) { return (/^[aeiou]/i.test(w) ? "an " : "a ") + w.toLowerCase(); };
    if (d == null) { d = kind.days || 14; notes.push("No duration given — assumed " + d + " days for " + art(kind.label) + "."); }
    if (sev == null) notes.push("No severity given — used the typical impact of " + art(kind.label) + ".");
    if (/\bpeak season\b/.test(t)) notes.push("“Peak season” noted; demand is held at normal levels in this model.");
    // a representative map position: first matched place
    var pos = eff.closed[0] ? Sea.CHOKES[eff.closed[0]] : Object.keys(eff.choke)[0] ? Sea.CHOKES[Object.keys(eff.choke)[0]]
      : Object.keys(eff.ports)[0] ? Sea.PORTS[Object.keys(eff.ports)[0]] : Object.keys(eff.suppliers)[0] ? net.suppliers.filter(function (s) { return s.id === Object.keys(eff.suppliers)[0]; })[0]
      : net.factories.filter(function (f) { return f.id === Object.keys(eff.supply)[0]; })[0];
    var id = "you-" + raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/-$/, "") + "-" + (Date.now() % 100000);
    return {
      event: { id: id, kind: "custom", type: kind.type, name: raw.length > 70 ? raw.slice(0, 68) + "…" : raw, period: "Your scenario", lat: pos ? pos.lat : 0, lng: pos ? pos.lng : 0,
        severity: Math.min(5, 2 + nPlaces), description: "From your description: “" + raw + "”.", effects: eff,
        duration: { actual: d, min: Math.max(1, Math.round(d / 2)), mode: d, max: d * 2 }, annualProb: 0, source: null },
      notes: notes, matched: matched
    };
  }

  var api = { parse: parse, duration: duration, severity: severity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasDescribe = api;
})(typeof window !== "undefined" ? window : globalThis);
