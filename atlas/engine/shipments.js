/*
 * shipments.js — build an Atlas network from a shipment-history export (v5).
 *
 * Most companies can't hand over a network model, but every ERP/TMS can export shipments.
 * One row per shipment (or per container) with: origin (supplier/factory), destination
 * (DC/warehouse), port of loading, port of discharge, volume, date, and optionally product
 * family and coordinates. This module
 *   1. parses CSV/TSV/semicolon text,
 *   2. guesses which column is which from common ERP/TMS header names (the user confirms),
 *   3. matches ports to the library by UN/LOCODE or common name ("Long Beach", "JNPT", …),
 *   4. aggregates to average weekly volumes and builds factories, DCs (with a product mix),
 *      sea lanes and inland legs. Capacities get headroom over observed volume; ocean rates and
 *      inland days are distance-based estimates — editable later, and stated as estimates.
 *
 * Pure. Browser global window.AtlasShipments; CommonJS for node.
 */
(function (root) {
  "use strict";
  var Sea = root.AtlasSea || (typeof require === "function" ? require("./seagraph.js") : null);

  // ---------------------------------------------------------------- parsing
  function splitLine(line, sep) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); return out.map(function (s) { return s.trim(); });
  }
  function parse(text) {
    var lines = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n").filter(function (l) { return l.trim(); });
    if (!lines.length) return { headers: [], rows: [] };
    var first = lines[0], sep = [",", ";", "\t", "|"].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var headers = splitLine(first, sep);
    var rows = lines.slice(1).map(function (l) { var c = splitLine(l, sep), o = {}; headers.forEach(function (h, i) { o[h] = c[i] == null ? "" : c[i]; }); return o; });
    return { headers: headers, rows: rows, sep: sep };
  }

  // ---------------------------------------------------------------- column detection
  var FIELDS = {
    date: /^(ship(ment)?[ _]?date|etd|atd|departure([ _]date)?|date|load(ing)?[ _]date|week)$/i,
    origin: /^(origin|supplier|vendor|shipper|factory|plant|ship[ _]?from|origin[ _]?(site|name|facility))$/i,
    destination: /^(destination|consignee|dc|warehouse|ship[ _]?to|customer[ _]?site|destination[ _]?(site|name|dc|facility)|.*\bdc\b.*)$/i,
    pol: /^(pol|port[ _]?of[ _]?loading|load(ing)?[ _]?port|origin[ _]?port|export[ _]?port)$/i,
    pod: /^(pod|port[ _]?of[ _]?discharge|discharge[ _]?port|dest(ination)?[ _]?port|import[ _]?port)$/i,
    teu: /^(teu|teus|containers?[ _]?\(?teu\)?|volume[ _]?\(?teu\)?|qty[ _]?teu|feu|containers|qty)$/i,
    product: /^(product([ _]?family)?|family|category|commodity|segment|sku[ _]?group|business[ _]?unit)$/i,
    originLat: /^(origin|supplier|factory|plant)[ _]?lat(itude)?$/i, originLng: /^(origin|supplier|factory|plant)[ _]?(lng|lon|long|longitude)$/i,
    destLat: /^(destination|dc|warehouse|consignee)[ _]?lat(itude)?$/i, destLng: /^(destination|dc|warehouse|consignee)[ _]?(lng|lon|long|longitude)$/i
  };
  function detect(headers) {
    var m = {};
    Object.keys(FIELDS).forEach(function (f) {
      var h = headers.filter(function (x) { return FIELDS[f].test(x.trim()); })[0];
      if (h) m[f] = h;
    });
    if (m.teu && /feu/i.test(m.teu)) m.teuFactor = 2;
    return m;
  }

  // ---------------------------------------------------------------- port matching
  var ALIASES = {
    "long beach": "USLAX", "los angeles": "USLAX", "la/lb": "USLAX", "san pedro": "USLAX", "lgb": "USLAX",
    "shenzhen": "CNYTN", "yantian": "CNYTN", "shekou": "CNYTN", "hong kong": "HKHKG", "guangzhou": "CNNSA", "nansha": "CNNSA",
    "ningbo": "CNNGB", "zhoushan": "CNNGB", "shanghai": "CNSHA", "yangshan": "CNSHA", "tianjin": "CNTXG", "xingang": "CNTXG",
    "pusan": "KRPUS", "busan": "KRPUS", "jnpt": "INNSA", "nhava sheva": "INNSA", "mumbai": "INNSA", "jawaharlal nehru": "INNSA",
    "ho chi minh": "VNCMT", "cai mep": "VNCMT", "vung tau": "VNCMT", "saigon": "VNCMT", "haiphong": "VNHPH", "hai phong": "VNHPH",
    "antwerp": "BEANR", "antwerpen": "BEANR", "new york": "USNYC", "newark": "USNYC", "new jersey": "USNYC", "elizabeth": "USNYC",
    "tacoma": "USSEA", "seattle": "USSEA", "oakland": "USOAK", "tanjung priok": "IDJKT", "jakarta": "IDJKT", "chittagong": "BDCGP", "chattogram": "BDCGP",
    "tangier": "MAPTM", "tanger": "MAPTM", "le havre": "FRLEH", "fos": "FRMRS", "marseille": "FRMRS", "genova": "ITGOA", "genoa": "ITGOA",
    "piraeus": "GRPIR", "felixstowe": "GBFXT", "london gateway": "GBLGP", "southampton": "GBSOU", "bremerhaven": "DEBRV", "hamburg": "DEHAM",
    "rotterdam": "NLRTM", "valencia": "ESVLC", "barcelona": "ESBCN", "algeciras": "ESALG", "jebel ali": "AEJEA", "dubai": "AEJEA",
    "manzanillo": "MXZLO", "lazaro cardenas": "MXLZC", "santos": "BRSSZ", "durban": "ZADUR", "laem chabang": "THLCH", "port klang": "MYPKG",
    "tanjung pelepas": "MYTPP", "colombo": "LKCMB", "kaohsiung": "TWKHH", "keelung": "TWKEL", "singapore": "SGSIN", "savannah": "USSAV",
    "houston": "USHOU", "charleston": "USCHS", "norfolk": "USORF", "baltimore": "USBAL", "miami": "USMIA", "vancouver": "CAVAN", "prince rupert": "CAPRR"
  };
  function norm(s) { return String(s || "").toLowerCase().replace(/\b(port|of|the|terminal|container|harbou?r)\b/g, " ").replace(/[^a-z0-9/ ]/g, " ").replace(/\s+/g, " ").trim(); }
  function matchPort(value) {
    var v = String(value || "").trim(); if (!v) return null;
    var code = v.toUpperCase().replace(/\s/g, "");
    if (Sea.PORTS[code]) return code;
    var n = norm(v);
    if (ALIASES[n]) return ALIASES[n];
    var hit = null;
    Object.keys(ALIASES).forEach(function (a) { if (!hit && (n.indexOf(a) >= 0)) hit = ALIASES[a]; });
    if (hit) return hit;
    Object.keys(Sea.PORTS).forEach(function (c) { if (!hit && norm(Sea.PORTS[c].name).split(/[ /(]/)[0] === n.split(" ")[0] && n.length > 3) hit = c; });
    return hit;
  }

  // ---------------------------------------------------------------- regions -> trade codes
  function region(p) {
    if (p.lng > 95 || (p.lng > 60 && p.lat < 0 && p.lng > 95)) return "asia";
    if (p.lng > 60) return "india";
    if (p.lng > 30 && p.lat > 10 && p.lat < 32) return "me";
    if (p.lng > -15 && p.lat > 30) return p.lat < 45 && p.lng > -6 ? "med" : "neu";
    if (p.lng < -100 && p.lat > 22) return "uswc";
    if (p.lng < -60 && p.lat > 24) return "usec";
    if (p.lng < -85 && p.lat > 14) return "mx";
    if (p.lng < -30 && p.lat < 0) return "sam";
    return "other";
  }
  function tradeOf(a, b) {
    var ra = region(a), rb = region(b);
    if (ra === "asia") return rb === "uswc" ? "TPWC" : rb === "usec" ? "TPEC" : rb === "mx" ? "MX" : rb === "neu" ? "AE" : rb === "med" ? "AM" : "";
    if (ra === "india") return rb === "neu" || rb === "med" ? "IE" : rb === "usec" ? "IU" : "";
    if (ra === "me") return rb === "neu" || rb === "med" ? "ME" : "";
    if (ra === "sam") return rb === "neu" || rb === "med" ? "SAE" : "";
    return "";
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "x"; }
  function parseDate(s) { var t = Date.parse(s); if (!isNaN(t)) return t; var m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(String(s).trim()); if (m) { var y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return Date.UTC(y, +m[2] - 1, +m[1]); } return null; }

  // ---------------------------------------------------------------- build
  function build(parsed, mapping, options) {
    options = options || {};
    var rows = parsed.rows || [], mp = mapping || {}, warnings = [], unresolved = {};
    ["origin", "destination", "pol", "pod", "teu"].forEach(function (f) { if (!mp[f]) warnings.push("no column mapped for " + f); });
    if (warnings.length) return { network: null, warnings: warnings, stats: { rows: rows.length } };
    var k = mp.teuFactor || 1, minT = Infinity, maxT = -Infinity;
    var fac = {}, dcs = {}, lanes = {}, products = {}, teuTotal = 0, used = 0;
    rows.forEach(function (r) {
      var teu = parseFloat(String(r[mp.teu]).replace(",", ".")) * k;
      if (!(teu > 0)) return;
      var pol = matchPort(r[mp.pol]), pod = matchPort(r[mp.pod]);
      if (!pol) { unresolved[r[mp.pol]] = (unresolved[r[mp.pol]] || 0) + teu; return; }
      if (!pod) { unresolved[r[mp.pod]] = (unresolved[r[mp.pod]] || 0) + teu; return; }
      if (mp.date) { var t = parseDate(r[mp.date]); if (t != null) { minT = Math.min(minT, t); maxT = Math.max(maxT, t); } }
      var o = r[mp.origin] || ("Supplier at " + Sea.PORTS[pol].name), d = r[mp.destination] || ("DC near " + Sea.PORTS[pod].name);
      var prod = mp.product ? (r[mp.product] || "Other") : null;
      var F = fac[o] = fac[o] || { name: o, teu: 0, ports: {}, products: {}, lat: null, lng: null };
      F.teu += teu; F.ports[pol] = (F.ports[pol] || 0) + teu; if (prod) F.products[prod] = 1;
      if (mp.originLat && r[mp.originLat] !== "") { F.lat = +r[mp.originLat]; F.lng = +r[mp.originLng]; }
      var Dd = dcs[d] = dcs[d] || { name: d, teu: 0, ports: {}, mix: {}, lat: null, lng: null };
      Dd.teu += teu; Dd.ports[pod] = (Dd.ports[pod] || 0) + teu; if (prod) Dd.mix[prod] = (Dd.mix[prod] || 0) + teu;
      if (mp.destLat && r[mp.destLat] !== "") { Dd.lat = +r[mp.destLat]; Dd.lng = +r[mp.destLng]; }
      var lk = pol + ">" + pod; lanes[lk] = (lanes[lk] || 0) + teu;
      if (prod) products[prod] = (products[prod] || 0) + teu;
      teuTotal += teu; used++;
    });
    var weeks = isFinite(minT) && maxT > minT ? Math.max(1, (maxT - minT) / (7 * 864e5) + 1) : (options.weeks || 52);
    var perWk = function (x) { return x / weeks; };
    var headroom = options.headroom || 1.25;
    var near = function (code, i) { var p = Sea.PORTS[code]; return { lat: p.lat + 0.25 * Math.cos(i), lng: p.lng + 0.25 * Math.sin(i) }; };
    var inlandDays = function (a, b) { return Math.max(1, Math.round(Sea.gcNm(a, b) * 1.852 * 1.3 / 600)); };

    var net = { name: options.name || "Network from shipment history", factories: [], dcs: [], services: [], source: "shipments" };
    var pdefs = Object.keys(products);
    if (pdefs.length > 1) net.productDefs = pdefs.map(function (name) { return { id: slug(name), name: name, valuePerTeu: options.valuePerTeu || 45000, lostSaleCostPerTeu: options.lostSaleCostPerTeu || 18000, fillTarget: 0.95, air: false, critical: false }; });
    Object.keys(fac).forEach(function (o, i) {
      var F = fac[o], main = Object.keys(F.ports).sort(function (a, b) { return F.ports[b] - F.ports[a]; })[0];
      var loc = F.lat != null && isFinite(F.lat) ? { lat: F.lat, lng: F.lng } : near(main, i);
      net.factories.push({ id: "f-" + slug(o), name: o, lat: loc.lat, lng: loc.lng, cap: Math.round(perWk(F.teu) * headroom), prodCost: 0,
        products: net.productDefs ? Object.keys(F.products).map(slug) : undefined,
        exports: Object.keys(F.ports).map(function (pc) { return { port: pc, days: inlandDays(loc, Sea.PORTS[pc]), cost: 250, mode: "road" }; }) });
    });
    Object.keys(dcs).forEach(function (d, i) {
      var Dd = dcs[d], main = Object.keys(Dd.ports).sort(function (a, b) { return Dd.ports[b] - Dd.ports[a]; })[0];
      var loc = Dd.lat != null && isFinite(Dd.lat) ? { lat: Dd.lat, lng: Dd.lng } : near(main, i + 3);
      var dc = { id: "dc-" + slug(d), name: d, lat: loc.lat, lng: loc.lng, demand: Math.round(perWk(Dd.teu)), bufferDays: options.bufferDays || 10,
        imports: Object.keys(Dd.ports).map(function (pc) { return { port: pc, days: inlandDays(Sea.PORTS[pc], loc), cost: 500, mode: "road" }; }) };
      if (net.productDefs) { dc.mix = {}; Object.keys(Dd.mix).forEach(function (p) { dc.mix[slug(p)] = Math.round(perWk(Dd.mix[p])); }); dc.demand = Object.keys(dc.mix).reduce(function (a, p) { return a + dc.mix[p]; }, 0); }
      net.dcs.push(dc);
    });
    Object.keys(lanes).forEach(function (lk) {
      var pr = lk.split(">"), a = Sea.PORTS[pr[0]], b = Sea.PORTS[pr[1]];
      var r = Sea.route(pr[0], pr[1]), nm = r.ok ? r.nm : Sea.gcNm(a, b);
      net.services.push({ id: "s-" + pr[0].toLowerCase() + "-" + pr[1].toLowerCase(), from: pr[0], to: pr[1], trade: tradeOf(a, b),
        cap: Math.round(perWk(lanes[lk]) * 1.3) || 1, rate: Math.round(Math.min(2500, 400 + 0.12 * nm) / 10) * 10, ulcv: false });
    });
    var un = Object.keys(unresolved).sort(function (a, b) { return unresolved[b] - unresolved[a]; });
    if (un.length) warnings.push(un.length + " port name(s) not recognised and skipped: " + un.slice(0, 5).map(function (u) { return "'" + u + "'"; }).join(", ") + (un.length > 5 ? "…" : "") + " — use UN/LOCODEs");
    return { network: net, warnings: warnings,
      stats: { rows: rows.length, used: used, teu: teuTotal, weeks: Math.round(weeks * 10) / 10, factories: net.factories.length, dcs: net.dcs.length, lanes: net.services.length,
        products: pdefs.length, unresolved: un.map(function (u) { return { name: u, teu: unresolved[u] }; }) } };
  }

  // A sample export generated from a network's baseline plan: 26 weeks of weekly shipments,
  // with the port names an ERP typically holds, so people can try the importer end to end.
  // names (optional): {productId: "Display name"} so the export carries readable family names
  function sampleCsv(net, plan, weeks, names) {
    weeks = weeks || 26;
    var rng = (function (a) { return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(7);
    var fById = {}, dById = {}; net.factories.forEach(function (f) { fById[f.id] = f; }); net.dcs.forEach(function (d) { dById[d.id] = d; });
    var lines = ["Ship Date,Supplier,Supplier Lat,Supplier Lng,Port of Loading,Port of Discharge,Consignee DC,DC Lat,DC Lng,Product Family,TEU"];
    var start = Date.UTC(2026, 2, 2);
    plan.paths.forEach(function (pt) {
      if (pt.short || !pt.service) return;
      var f = fById[pt.factory], d = dById[pt.dc]; if (!f || !d) return;
      var pol = Sea.PORTS[pt.service.from].name, pod = Sea.PORTS[pt.service.to].name;
      for (var w = 0; w < weeks; w++) {
        var teu = Math.max(1, Math.round(pt.flow * (0.85 + 0.3 * rng())));
        var date = new Date(start + (w * 7 + Math.floor(rng() * 5)) * 864e5).toISOString().slice(0, 10);
        lines.push([date, '"' + f.name + '"', f.lat, f.lng, '"' + pol + '"', '"' + pod + '"', '"' + d.name + '"', d.lat, d.lng, pt.product === "all" ? "" : '"' + ((names && names[pt.product]) || pt.product) + '"', teu].join(","));
      }
    });
    return lines.join("\n") + "\n";
  }

  var api = { parse: parse, detect: detect, matchPort: matchPort, build: build, tradeOf: tradeOf, sampleCsv: sampleCsv, FIELDS: Object.keys(FIELDS) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasShipments = api;
})(typeof window !== "undefined" ? window : globalThis);
