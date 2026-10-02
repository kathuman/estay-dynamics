// Land-crossing check for the sea graph: samples every lane segment along its great circle
// and tests each sample against the vendored country polygons (Natural Earth, coarse).
// Samples near a waypoint or port are skipped (coastlines and straits are narrower than the
// polygons' resolution). Used by tests/seagraph-land.test.js and runnable on its own:
//   node atlas/tests/landcheck.js
const path = require("node:path");
const fs = require("node:fs");
const Sea = require("../engine/seagraph.js");

function loadCountries() {
  const src = fs.readFileSync(path.join(__dirname, "..", "vendor", "countries.js"), "utf8");
  const json = src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1);
  return JSON.parse(json).features;
}
const D2R = Math.PI / 180;
function slerp(a, b, t) {
  const p1 = a.lat * D2R, l1 = a.lng * D2R, p2 = b.lat * D2R, l2 = b.lng * D2R;
  const A = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)];
  const B = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
  const ang = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (ang < 1e-9) return { lat: a.lat, lng: a.lng };
  const s1 = Math.sin((1 - t) * ang) / Math.sin(ang), s2 = Math.sin(t * ang) / Math.sin(ang);
  const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
  return { lat: Math.atan2(z, Math.hypot(x, y)) / D2R, lng: Math.atan2(y, x) / D2R };
}
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt.lat) !== (yj > pt.lat) && pt.lng < (xj - xi) * (pt.lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function makeLandTest(features) {
  const polys = [];
  features.forEach(f => {
    const g = f.geometry, list = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    list.forEach(p => {
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      p[0].forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
      polys.push({ name: f.properties.name, rings: p, minX, maxX, minY, maxY });
    });
  });
  return pt => {
    for (const p of polys) {
      if (pt.lng < p.minX || pt.lng > p.maxX || pt.lat < p.minY || pt.lat > p.maxY) continue;
      if (inRing(pt, p.rings[0]) && !p.rings.slice(1).some(h => inRing(pt, h))) return p.name;
    }
    return null;
  };
}

// Returns [{edge:"A-B", country, at:{lat,lng}, landNm}] for every segment that runs over land
// for more than `minLandNm` away from its endpoints' tolerance zones.
function check(opts = {}) {
  const tolNm = opts.tolNm == null ? 40 : opts.tolNm, minLandNm = opts.minLandNm == null ? 30 : opts.minLandNm, step = 5;
  const land = makeLandTest(loadCountries());
  const out = [];
  const segs = Sea.EDGES.map(([a, b]) => ({ name: a + "-" + b, A: Sea.WP[a], B: Sea.WP[b], tolA: tolNm, tolB: tolNm }));
  if (opts.ports !== false) Object.keys(Sea.PORTS).forEach(code => {
    const p = Sea.PORTS[code];
    (p.sea || []).forEach(w => segs.push({ name: code + "-" + w, A: p, B: Sea.WP[w], tolA: p.accessNm || 60, tolB: tolNm }));
  });
  segs.forEach(s => {
    const nm = Sea.gcNm(s.A, s.B), n = Math.max(2, Math.ceil(nm / step));
    let run = 0, worst = 0, at = null, country = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, d = t * nm;
      if (d < s.tolA || nm - d < s.tolB) { run = 0; continue; }
      const pt = slerp(s.A, s.B, t), c = land(pt);
      if (c) { run += nm / n; if (run > worst) { worst = run; at = pt; country = c; } } else run = 0;
    }
    if (worst > minLandNm) out.push({ edge: s.name, country, at: { lat: +at.lat.toFixed(2), lng: +at.lng.toFixed(2) }, landNm: Math.round(worst) });
  });
  return out;
}
module.exports = { check };
if (require.main === module) {
  const bad = check();
  console.log(bad.length ? bad.map(b => `${b.edge.padEnd(16)} ${b.landNm} nm over ${b.country} near ${b.at.lat},${b.at.lng}`).join("\n") : "No lane crosses land.");
}
