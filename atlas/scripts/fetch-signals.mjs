#!/usr/bin/env node
/*
 * fetch-signals.mjs — builds atlas/data/signals.js, the Atlas's real-data snapshot.
 *
 * Runs daily in GitHub Actions (.github/workflows/atlas-signals.yml) and can be run by
 * hand: `node atlas/scripts/fetch-signals.mjs`. Needs Node 18+ (global fetch), no packages.
 *
 * Sources (all public, no keys):
 *   - IMF PortWatch — daily vessel transits through maritime chokepoints, daily container
 *     port calls for every port in the Atlas library, and port-disruption events (AIS-derived).
 *   - GDACS (EC JRC / UN OCHA) — orange/red natural-hazard alerts.
 *   - USGS — M6+ earthquakes in the last 30 days.
 *
 * The output is a plain JS global (ATLAS_SIGNALS) rather than JSON so the Atlas keeps
 * working from a local file:// path where fetch() of a sibling file is blocked.
 * A fetch that fails keeps the previous snapshot's section and records the error, so one
 * flaky upstream never blanks the page.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "data", "signals.js");

const PORTWATCH = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
// Chokepoints the Atlas routes through (see engine/seagraph.js `choke` ids).
const CHOKEPOINTS = {
  chokepoint1: "Suez Canal", chokepoint2: "Panama Canal", chokepoint4: "Bab el-Mandeb",
  chokepoint5: "Malacca Strait", chokepoint6: "Strait of Hormuz", chokepoint7: "Cape of Good Hope",
  chokepoint8: "Strait of Gibraltar", chokepoint9: "Dover Strait", chokepoint11: "Taiwan Strait",
  chokepoint12: "Korea Strait", chokepoint14: "Luzon Strait", chokepoint19: "Sunda Strait",
  chokepoint22: "Yucatan Channel", chokepoint23: "Windward Passage",
  chokepoint10: "Oresund Strait", chokepoint13: "Tsugaru Strait", chokepoint15: "Lombok Strait", chokepoint18: "Torres Strait"
};
// Baseline window for "normal" traffic: 2019-01-01 .. 2023-10-31 — before the Red Sea
// crisis; long enough that the 2020-21 COVID swings average out.
const BASE_FROM = "2019-01-01", BASE_TO = "2023-10-31";

async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "estay-dynamics-atlas/2 (+https://kathuman.github.io/estay-dynamics/atlas/)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e; await new Promise(res => setTimeout(res, 1500 * (i + 1))); }
  }
  throw last;
}

async function portwatchSeries(id) {
  // ArcGIS caps a page at ~2000 rows; page by offset.
  const rows = [];
  // The server's page size (maxRecordCount) can be smaller than what we ask for, so advance
  // by the rows actually returned, and stop only when a page comes back empty.
  for (let offset = 0; ; ) {
    const q = new URLSearchParams({
      where: `portid='${id}' AND date >= DATE '${BASE_FROM}'`,
      outFields: "date,n_container,n_total", orderByFields: "date ASC",
      resultOffset: String(offset), resultRecordCount: "2000", returnGeometry: "false", f: "json"
    });
    const j = await getJSON(`${PORTWATCH}?${q}`);
    if (j.error) throw new Error(j.error.message || "PortWatch error");
    const feats = j.features || [];
    feats.forEach(f => rows.push(f.attributes));
    if (!feats.length) break;
    offset += feats.length;
    if (!j.exceededTransferLimit && feats.length < 1000) break;
  }
  return rows.map(a => ({ date: typeof a.date === "number" ? new Date(a.date).toISOString().slice(0, 10) : String(a.date).slice(0, 10), c: a.n_container || 0, t: a.n_total || 0 }));
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function summarise(rows) {
  const base = rows.filter(r => r.date >= BASE_FROM && r.date <= BASE_TO);
  const baseC = mean(base.map(r => r.c)), baseT = mean(base.map(r => r.t));
  const last7 = rows.slice(-7), last28 = rows.slice(-28);
  // weekly (ISO-ish: 7-row buckets from the end) averages, newest last — keeps the file small
  const weeks = [];
  for (let end = rows.length; end - 7 >= 0; end -= 7) {
    const w = rows.slice(end - 7, end);
    weeks.unshift([w[w.length - 1].date, +mean(w.map(r => r.c)).toFixed(2), +mean(w.map(r => r.t)).toFixed(2)]);
  }
  return {
    asOf: rows.length ? rows[rows.length - 1].date : null,
    baseline: { container: +baseC.toFixed(2), total: +baseT.toFixed(2), from: BASE_FROM, to: BASE_TO },
    last7: { container: +mean(last7.map(r => r.c)).toFixed(2), total: +mean(last7.map(r => r.t)).toFixed(2) },
    last28: { container: +mean(last28.map(r => r.c)).toFixed(2), total: +mean(last28.map(r => r.t)).toFixed(2) },
    ratio: baseC > 0 ? +(mean(last7.map(r => r.c)) / baseC).toFixed(3) : null,
    weekly: weeks // [weekEndDate, avgContainerTransits/day, avgAllTransits/day]
  };
}

async function gdacs() {
  const to = new Date(), from = new Date(Date.now() - 21 * 864e5);
  const q = new URLSearchParams({
    eventlist: "TC;EQ;FL;VO;DR;WF", alertlevel: "orange;red",
    fromdate: from.toISOString().slice(0, 10), todate: to.toISOString().slice(0, 10)
  });
  const j = await getJSON(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?${q}`);
  return (j.features || []).map(f => {
    const p = f.properties || {}, g = f.geometry || {};
    const c = g.type === "Point" ? g.coordinates : (f.bbox ? [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2] : [0, 0]);
    return {
      src: "GDACS", type: p.eventtype, name: p.name || p.eventname, alert: p.alertlevel,
      from: (p.fromdate || "").slice(0, 10), to: (p.todate || "").slice(0, 10), lat: +c[1], lng: +c[0],
      country: p.country || "", url: (p.url && p.url.report) || "https://www.gdacs.org/"
    };
  }).filter(e => e.to >= from.toISOString().slice(0, 10));
}

async function usgs() {
  const j = await getJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson");
  const k = await getJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson");
  const seen = new Set(), out = [];
  [...(j.features || []), ...(k.features || [])].forEach(f => {
    if (seen.has(f.id)) return; seen.add(f.id);
    const p = f.properties, c = f.geometry.coordinates;
    if (p.mag < 6) return;
    out.push({ src: "USGS", type: "EQ", name: `M${p.mag.toFixed(1)} — ${p.place}`, alert: p.alert || "", from: new Date(p.time).toISOString().slice(0, 10), lat: c[1], lng: c[0], mag: p.mag, url: p.url });
  });
  return out.sort((a, b) => b.from.localeCompare(a.from));
}

function loadPrevious() {
  if (!existsSync(OUT)) return null;
  try {
    const txt = readFileSync(OUT, "utf8");
    return JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
  } catch { return null; }
}

const prev = loadPrevious();
const snap = { generated: new Date().toISOString(), chokepoints: {}, hazards: [], errors: [] };

for (const [id, name] of Object.entries(CHOKEPOINTS)) {
  try {
    const rows = await portwatchSeries(id);
    if (!rows.length) throw new Error("no rows");
    snap.chokepoints[id] = { name, ...summarise(rows) };
    console.log(`PortWatch ${name}: as of ${snap.chokepoints[id].asOf}, container ratio ${snap.chokepoints[id].ratio}`);
  } catch (e) {
    snap.errors.push(`PortWatch ${name}: ${e.message}`);
    if (prev && prev.chokepoints && prev.chokepoints[id]) snap.chokepoints[id] = { ...prev.chokepoints[id], stale: true };
  }
}
for (const [label, fn] of [["GDACS", gdacs], ["USGS", usgs]]) {
  try { const xs = await fn(); snap.hazards.push(...xs); console.log(`${label}: ${xs.length} event(s)`); }
  catch (e) {
    snap.errors.push(`${label}: ${e.message}`);
    if (prev) snap.hazards.push(...(prev.hazards || []).filter(h => h.src === label).map(h => ({ ...h, stale: true })));
  }
}
// ---- Ports: daily container port calls for every port in the Atlas library -------------
// The library is keyed by UN/LOCODE; PortWatch has its own port ids and stores LOCODEs as
// "NL RTM" (some non-standard, e.g. Shanghai = "CN SGH"). Match on LOCODE, else take the
// busiest container port within 40 km. A LOCODE hit with almost no container calls (e.g.
// "Sydney" = the harbour, not Port Botany) also falls back to the nearest busy port.
const Sea = createRequire(import.meta.url)("../engine/seagraph.js");
const ARC = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services";
const PORT_WEEKS_FROM = "2022-01-02"; // weekly history kept from here (a Sunday); baseline uses the full window

async function queryAll(layer, params) {
  const rows = [];
  for (let offset = 0; ; ) {
    const q = new URLSearchParams({ ...params, resultOffset: String(offset), resultRecordCount: "2000", returnGeometry: "false", f: "json" });
    const j = await getJSON(`${ARC}/${layer}/FeatureServer/0/query?${q}`);
    if (j.error) throw new Error(j.error.message || "ArcGIS error");
    const feats = j.features || [];
    feats.forEach(f => rows.push(f.attributes));
    if (!feats.length) break;
    offset += feats.length;
    if (!j.exceededTransferLimit && feats.length < 1000) break;
  }
  return rows;
}
const isoDay = v => (typeof v === "number" ? new Date(v).toISOString() : String(v)).slice(0, 10);

async function portMap() {
  const db = await queryAll("PortWatch_ports_database", { where: "1=1", outFields: "portid,portname,LOCODE,lat,lon,vessel_count_container" });
  const byLocode = {};
  db.forEach(r => (r.LOCODE || "").split(/[;,]/).forEach(l => { const k = l.replace(/\s/g, "").toUpperCase(); if (k) byLocode[k] = r; }));
  const out = {};
  for (const [code, p] of Object.entries(Sea.PORTS)) {
    let r = byLocode[code];
    if (!r || (r.vessel_count_container || 0) < 50) {
      let best = null;
      db.forEach(x => {
        const km = Sea.gcNm(p, { lat: x.lat, lng: x.lon }) * 1.852;
        if (km < 40 && (x.vessel_count_container || 0) > 50 && (!best || x.vessel_count_container > best.vessel_count_container)) best = x;
      });
      r = best || r;
    }
    if (r) out[code] = { portid: r.portid, pwName: r.portname };
  }
  return out;
}

async function portSeries(portid) {
  const rows = await queryAll("Daily_Ports_Data", { where: `portid='${portid}' AND date >= DATE '${BASE_FROM}'`, outFields: "date,portcalls_container", orderByFields: "date ASC" });
  return rows.map(a => ({ date: isoDay(a.date), c: a.portcalls_container || 0 }));
}

function summarisePort(rows) {
  const base = rows.filter(r => r.date >= BASE_FROM && r.date <= BASE_TO);
  const baseC = mean(base.map(r => r.c));
  const last14 = rows.slice(-14);
  // weekly averages binned by calendar week from PORT_WEEKS_FROM (robust to missing days)
  const t0 = Date.parse(PORT_WEEKS_FROM + "T00:00:00Z"), sums = [], counts = [];
  rows.forEach(r => {
    const k = Math.floor((Date.parse(r.date + "T00:00:00Z") - t0) / (7 * 864e5));
    if (k < 0) return;
    sums[k] = (sums[k] || 0) + r.c; counts[k] = (counts[k] || 0) + 1;
  });
  const w = [];
  for (let k = 0; k < sums.length; k++) w.push(counts[k] ? +(sums[k] / counts[k]).toFixed(1) : null);
  return {
    asOf: rows.length ? rows[rows.length - 1].date : null,
    baseline: +baseC.toFixed(2), last14: +mean(last14.map(r => r.c)).toFixed(2),
    ratio: baseC >= 0.3 ? +(mean(last14.map(r => r.c)) / baseC).toFixed(3) : null, // too few calls to judge below ~2 a week
    weekStart: PORT_WEEKS_FROM, weekly: w
  };
}

snap.ports = {};
try {
  const map = await portMap();
  const codes = Object.keys(map);
  // a few at a time — polite to the server, still quick
  for (let i = 0; i < codes.length; i += 4) {
    await Promise.all(codes.slice(i, i + 4).map(async code => {
      try {
        const rows = await portSeries(map[code].portid);
        if (!rows.length) throw new Error("no rows");
        snap.ports[code] = { ...map[code], ...summarisePort(rows) };
      } catch (e) {
        snap.errors.push(`PortWatch port ${code}: ${e.message}`);
        if (prev && prev.ports && prev.ports[code]) snap.ports[code] = { ...prev.ports[code], stale: true };
      }
    }));
  }
  console.log(`PortWatch ports: ${Object.keys(snap.ports).length} of ${Object.keys(Sea.PORTS).length} library ports`);

  // ---- PortWatch disruption events (GDACS-based) that touched a library port, last 60 days
  const since = Date.now() - 60 * 864e5;
  const byPortid = {}; codes.forEach(c => { byPortid[map[c].portid] = c; });
  const evs = await queryAll("portwatch_disruptions_database", { where: "1=1", outFields: "eventid,eventtype,eventname,alertlevel,country,fromdate,todate,severitytext,lat,long,affectedports", orderByFields: "fromdate DESC" });
  snap.disruptions = evs.filter(e => Number(e.todate || e.fromdate) >= since).map(e => ({
    src: "PortWatch", id: String(e.eventid), type: e.eventtype, name: e.eventname, alert: e.alertlevel, country: e.country,
    from: isoDay(Number(e.fromdate)), to: isoDay(Number(e.todate || e.fromdate)), lat: +e.lat, lng: +e.long, severity: e.severitytext,
    ports: String(e.affectedports || "").split(/;\s*/).map(p => byPortid[p.trim()]).filter(Boolean),
    url: "https://portwatch.imf.org/pages/port-disruptions"
  }));
  console.log(`PortWatch disruptions: ${snap.disruptions.length} in the last 60 days, ${snap.disruptions.filter(d => d.ports.length).length} touching library ports`);
} catch (e) {
  snap.errors.push(`PortWatch ports: ${e.message}`);
  if (prev) { snap.ports = prev.ports || {}; snap.disruptions = prev.disruptions || []; }
}

snap.sources = {
  portwatch: { label: "IMF PortWatch — daily chokepoint transits and port calls", url: "https://portwatch.imf.org/" },
  gdacs: { label: "GDACS — Global Disaster Alert and Coordination System", url: "https://www.gdacs.org/" },
  usgs: { label: "USGS Earthquake Hazards Program", url: "https://earthquake.usgs.gov/" }
};

// Only rewrite the file when the data itself changed. `generated` then means "when the data
// last changed", and the daily job doesn't commit a timestamp-only diff.
const pick = x => JSON.stringify({ c: x.chokepoints, h: x.hazards, p: x.ports, d: x.disruptions });
const sameData = prev && pick(prev) === pick(snap);
if (sameData) {
  console.log(`No data change since ${prev.generated}; left ${OUT} untouched.${snap.errors.length ? ` Errors: ${snap.errors.join("; ")}` : ""}`);
} else {
  writeFileSync(OUT,
    "/* Generated by atlas/scripts/fetch-signals.mjs — do not edit by hand. */\n" +
    "var ATLAS_SIGNALS = " + JSON.stringify(snap) + ";\n" +
    "if (typeof module !== 'undefined' && module.exports) module.exports = ATLAS_SIGNALS;\n");
  console.log(`Wrote ${OUT}${snap.errors.length ? ` with ${snap.errors.length} error(s): ${snap.errors.join("; ")}` : ""}`);
}
