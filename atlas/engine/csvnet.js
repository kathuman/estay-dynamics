/*
 * csvnet.js — turn two CSV files (nodes, lanes) into an Atlas engine network.
 * Pure: no DOM. Browser global window.AtlasCsv; CommonJS for node --test.
 *
 * nodes.csv: id, name, type (factory|dc|port), lat, lng, capacity_teu_wk, demand_teu_wk,
 *            buffer_days, cost_premium
 * lanes.csv: from, to, mode (sea|road|rail|barge), capacity_teu_wk, rate_per_teu, days, trade
 * Sea lanes run port to port (days come from the sea graph). Other modes run
 * factory->port, port->DC or factory->DC; missing days are estimated from distance.
 * Ports may be library UN/LOCODEs (no row needed) or custom rows with coordinates.
 */
(function (root) {
  "use strict";
  var Sea = root.AtlasSea || (typeof require === "function" ? require("./seagraph.js") : null);

  var NODES_TEMPLATE = [
    "id,name,type,lat,lng,capacity_teu_wk,demand_teu_wk,buffer_days,cost_premium",
    "f-dhaka,Dhaka garment cluster,factory,23.81,90.41,300,,,0",
    "f-binhduong,Binh Duong apparel,factory,11.00,106.65,200,,,150",
    "f-izmir,Izmir textiles,factory,38.42,27.14,120,,,900",
    "dc-madrid,Madrid DC,dc,40.42,-3.70,,250,10,",
    "dc-poznan,Poznan DC,dc,52.41,16.93,,200,10,",
    "BDCGP,Chittagong,port,22.31,91.80,,,,",
    "ESVLC,Valencia,port,39.44,-0.32,,,,"
  ].join("\n") + "\n";
  var LANES_TEMPLATE = [
    "from,to,mode,capacity_teu_wk,rate_per_teu,days,trade",
    "f-dhaka,BDCGP,road,,250,2,",
    "f-binhduong,VNCMT,road,,160,1,",
    "f-izmir,dc-madrid,road,,2600,6,",
    "f-izmir,dc-poznan,road,,1900,4,",
    "BDCGP,ESVLC,sea,250,1100,,IE",
    "BDCGP,NLRTM,sea,200,1150,,IE",
    "VNCMT,ESVLC,sea,150,1000,,AM",
    "VNCMT,NLRTM,sea,200,950,,AE",
    "ESVLC,dc-madrid,road,,350,1,",
    "NLRTM,dc-poznan,road,,700,2,",
    "NLRTM,dc-madrid,road,,1100,3,"
  ].join("\n") + "\n";

  function splitCSVLine(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); return out;
  }
  function parseCSV(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter(l => l.trim());
    if (!lines.length) return [];
    const hdr = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    return lines.slice(1).map(l => { const c = splitCSVLine(l), o = {}; hdr.forEach((h, i) => { o[h] = (c[i] || "").trim(); }); return o; });
  }
  // Build an engine network from the two CSVs. Returns {net, errors[], warnings[]}.
  // suppliersText (optional): id,name,tier,lat,lng,feeds — feeds as "f-a:0.8;f-b:0.5" (share of
  // each site's output that needs this supplier's parts; targets can be factories or suppliers)
  function buildCustomNet(nodesText, lanesText, suppliersText) {
    const errors = [], warnings = [];
    const net = { name: "My network", factories: [], dcs: [], services: [], ports: {} };
    parseCSV(nodesText || "").forEach((r, i) => {
      const line = i + 2, type = (r.type || "").toLowerCase(), lat = parseFloat(r.lat), lng = parseFloat(r.lng);
      if (!r.id) { errors.push(`nodes row ${line}: missing id`); return; }
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        if (type === "port" && Sea.PORTS[r.id]) return; // library port: coordinates optional
        errors.push(`nodes row ${line}: bad lat/lng`); return;
      }
      if (type === "factory") net.factories.push({ id: r.id, name: r.name || r.id, lat, lng, cap: +r.capacity_teu_wk || 0, prodCost: +r.cost_premium || 0, exports: [], direct: [] });
      else if (type === "dc" || type === "warehouse") net.dcs.push({ id: r.id, name: r.name || r.id, lat, lng, demand: +r.demand_teu_wk || 0, bufferDays: r.buffer_days === "" ? 10 : +r.buffer_days, imports: [] });
      else if (type === "port") net.ports[r.id] = { name: r.name || r.id, lat, lng, sea: Sea.nearestWaypoints(lat, lng, 2) };
      else errors.push(`nodes row ${line}: type must be factory, dc or port`);
    });
    const isF = id => net.factories.find(f => f.id === id), isD = id => net.dcs.find(d => d.id === id), isP = id => net.ports[id] || Sea.PORTS[id];
    parseCSV(lanesText || "").forEach((r, i) => {
      const line = i + 2, mode = (r.mode || "road").toLowerCase(), cap = +r.capacity_teu_wk || 0, rate = +r.rate_per_teu || 0;
      const a = r.from, b = r.to;
      const coord = id => isF(id) || isD(id) || isP(id);
      if (!coord(a) || !coord(b)) { errors.push(`lanes row ${line}: unknown ${!coord(a) ? a : b} (define it in nodes, or use a library UN/LOCODE)`); return; }
      let days = parseFloat(r.days);
      if (!Number.isFinite(days) && mode !== "sea") { const A = coord(a), B = coord(b); days = Math.max(1, Math.round(Sea.gcNm(A, B) * 1.852 * 1.3 / 600)); warnings.push(`lanes row ${line}: no days given, estimated ${days}`); }
      if (mode === "sea") {
        if (!isP(a) || !isP(b)) { errors.push(`lanes row ${line}: sea lanes must run port to port`); return; }
        net.services.push({ id: `s-${a}-${b}-${i}`, from: a, to: b, trade: r.trade || "", cap: cap || 100, rate: rate || 1000 });
      } else if (isF(a) && isP(b)) isF(a).exports.push({ port: b, days, cost: rate, mode });
      else if (isP(a) && isD(b)) isD(b).imports.push({ port: a, days, cost: rate, mode });
      else if (isF(a) && isD(b)) isF(a).direct.push({ dc: b, days, cost: rate, mode });
      else errors.push(`lanes row ${line}: ${mode} lanes go factory→port, port→DC or factory→DC`);
    });
    // library ports referenced by sea lanes need to be known to the router; custom ones carry their own attachment
    if (!net.factories.length) errors.push("no factories");
    if (!net.dcs.length) errors.push("no DCs");
    if (!net.services.length && !net.factories.some(f => f.direct.length)) warnings.push("no lanes connect factories to DCs yet");
    if (suppliersText) {
      net.suppliers = [];
      parseCSV(suppliersText).forEach(function (r, i) {
        var lat = parseFloat(r.lat), lng = parseFloat(r.lng), feeds = {};
        String(r.feeds || "").split(/[;|]/).forEach(function (kv) { var p = kv.split(":"); var v = parseFloat(p[1]); if (p[0] && p[0].trim() && v > 0) feeds[p[0].trim()] = Math.min(1, v); });
        if (!r.id || !Number.isFinite(lat) || !Number.isFinite(lng)) { errors.push("suppliers row " + (i + 2) + ": needs id, lat and lng"); return; }
        Object.keys(feeds).forEach(function (k) { if (!isF(k) && !String(k).match(/^[\w-]+$/)) errors.push("suppliers row " + (i + 2) + ": bad target " + k); });
        net.suppliers.push({ id: r.id, name: r.name || r.id, tier: +r.tier || 2, lat: lat, lng: lng, feeds: feeds, what: r.what || "" });
      });
      net.suppliers.forEach(function (s) { Object.keys(s.feeds).forEach(function (k) { if (!isF(k) && !net.suppliers.some(function (x) { return x.id === k; })) warnings.push("supplier " + s.id + " feeds unknown site " + k); }); });
    }
    if (!Object.keys(net.ports).length) delete net.ports;
    return { net, errors, warnings };
  }

  var SUPPLIERS_TEMPLATE = [
    "id,name,tier,lat,lng,what,feeds",
    "s-fabric,Zhejiang fabric mills,2,30.0,120.6,Woven fabric,f-dhaka:0.6;f-binhduong:0.5",
    "s-zips,Guangdong trims & zips,2,22.8,113.3,Zips and trims,f-dhaka:0.3;f-binhduong:0.4;f-izmir:0.2",
    "s-dye,Dyestuff chemicals (India),3,21.2,72.8,Dyes,s-fabric:0.5"
  ].join(String.fromCharCode(10)) + String.fromCharCode(10);
  var api = { SUPPLIERS_TEMPLATE: SUPPLIERS_TEMPLATE, NODES_TEMPLATE: NODES_TEMPLATE, LANES_TEMPLATE: LANES_TEMPLATE, splitCSVLine: splitCSVLine, parseCSV: parseCSV, buildCustomNet: buildCustomNet };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasCsv = api;
})(typeof window !== "undefined" ? window : globalThis);
