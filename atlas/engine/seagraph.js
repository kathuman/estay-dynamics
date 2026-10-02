/*
 * seagraph.js — a compact maritime routing network for the Global Disruption Atlas.
 *
 * Ships don't sail great circles between ports: they follow sea lanes that thread a
 * handful of chokepoints (Suez, Bab-el-Mandeb, Malacca, Panama, Gibraltar...). This
 * file holds a hand-built waypoint graph of those lanes (87 waypoints, each
 * edge checked to stay off the continents at globe scale), a library of major container
 * ports keyed by UN/LOCODE, and a Dijkstra router over it.
 *
 * Why it matters: when a chokepoint closes, the reroute, the extra distance and the
 * extra days all fall out of the graph — nothing is hand-curated per lane. Closing
 * Bab-el-Mandeb sends Asia–Europe services round the Cape of Good Hope by itself.
 *
 * Waypoints flagged `choke` are mapped to IMF PortWatch chokepoint ids, so live transit
 * data (data/signals.js) can throttle them.
 *
 * Pure, no DOM. Works as a browser global (window.AtlasSea) and as a CommonJS module
 * (tests run under `node --test`).
 */
(function (root) {
  "use strict";

  // ---- Waypoints: [lat, lng]. `choke` = PortWatch chokepoint id, `cname` = display name.
  var WP = {
    // East Asia
    YS: { lat: 35.0, lng: 123.0 },               // Yellow Sea
    ECS: { lat: 30.8, lng: 123.2 },              // East China Sea off the Yangtze
    ECS2: { lat: 32.0, lng: 127.5 },             // NE East China Sea
    KOREA: { lat: 34.0, lng: 128.6, choke: "chokepoint12", cname: "Korea Strait" },
    SJ: { lat: 30.0, lng: 132.0 },               // south of Kyushu
    JPE: { lat: 34.3, lng: 141.5 },              // off Tokyo Bay
    TWS: { lat: 24.4, lng: 119.6, choke: "chokepoint11", cname: "Taiwan Strait" },
    TWE: { lat: 23.5, lng: 123.0 },              // east of Taiwan
    LUZON: { lat: 21.3, lng: 121.0, choke: "chokepoint14", cname: "Luzon Strait" },
    SCSN: { lat: 21.6, lng: 115.4 },             // northern South China Sea (off Hong Kong)
    SCSS: { lat: 8.0, lng: 109.5 },              // southern South China Sea
    SGP: { lat: 1.2, lng: 104.0 },               // Singapore Strait
    MAL: { lat: 2.6, lng: 101.2, choke: "chokepoint5", cname: "Malacca Strait" },
    MALN: { lat: 5.6, lng: 98.6 },               // northern Malacca Strait
    ANDA: { lat: 6.5, lng: 95.4 },               // Andaman Sea exit, north of Aceh
    SUNDA: { lat: -6.0, lng: 105.8, choke: "chokepoint19", cname: "Sunda Strait" },
    // Indian Ocean
    LKS: { lat: 5.3, lng: 80.5 },                // south of Sri Lanka
    MUM: { lat: 18.5, lng: 71.6 },               // off Mumbai
    ARABC: { lat: 15.0, lng: 57.0 },             // central Arabian Sea
    HADD: { lat: 22.0, lng: 61.0 },              // off Ras al Hadd
    HORMUZ: { lat: 26.6, lng: 56.6, choke: "chokepoint6", cname: "Strait of Hormuz" },
    PG: { lat: 25.9, lng: 55.3 },                // Persian Gulf off Dubai
    GOA: { lat: 12.2, lng: 47.0 },               // Gulf of Aden
    IOC: { lat: -10.0, lng: 70.0 },              // central Indian Ocean
    IOW: { lat: -10.0, lng: 58.0 },              // western Indian Ocean
    MADS: { lat: -28.0, lng: 46.0 },             // south of Madagascar
    AGUL: { lat: -36.5, lng: 22.0 },             // off Cape Agulhas
    CAPE: { lat: -35.0, lng: 18.3, choke: "chokepoint7", cname: "Cape of Good Hope" },
    // Red Sea / Suez / Mediterranean
    BAM: { lat: 12.6, lng: 43.35, choke: "chokepoint4", cname: "Bab el-Mandeb" },
    RSC: { lat: 20.0, lng: 38.5 },               // central Red Sea
    RSN: { lat: 27.5, lng: 34.4 },               // northern Red Sea
    SUEZS: { lat: 29.8, lng: 32.6 },             // Gulf of Suez
    SUEZ: { lat: 30.6, lng: 32.33, choke: "chokepoint1", cname: "Suez Canal" },
    PSAID: { lat: 31.6, lng: 32.35 },            // off Port Said
    MEDE: { lat: 34.0, lng: 26.0 },              // south of Crete
    KYTH: { lat: 35.9, lng: 23.4 },              // Kythira strait
    MALTA: { lat: 35.4, lng: 15.0 },
    SIC: { lat: 37.4, lng: 11.6 },               // Strait of Sicily
    ALG: { lat: 37.4, lng: 3.0 },                // off Algiers
    ALB: { lat: 36.0, lng: -2.5 },               // Alboran Sea
    GIB: { lat: 35.95, lng: -5.55, choke: "chokepoint8", cname: "Strait of Gibraltar" },
    GIBW: { lat: 36.0, lng: -6.8 },
    // NE Atlantic / North Sea
    STV: { lat: 36.8, lng: -9.8 },               // off Cape St Vincent
    FIN: { lat: 43.2, lng: -10.0 },              // off Finisterre
    USH: { lat: 48.6, lng: -5.8 },               // off Ushant
    CHAN: { lat: 50.0, lng: -2.5 },              // English Channel
    DOVER: { lat: 51.0, lng: 1.45, choke: "chokepoint9", cname: "Dover Strait" },
    NS: { lat: 52.0, lng: 3.4 },                 // southern North Sea
    NS2: { lat: 53.6, lng: 4.5 },
    GB: { lat: 54.0, lng: 7.8 },                 // German Bight
    // Atlantic
    CAN: { lat: 27.0, lng: -19.0 },              // SW of the Canaries
    CVS: { lat: 12.0, lng: -22.0 },              // south-east of Cape Verde
    WAF: { lat: 4.0, lng: -12.0 },               // off Liberia
    GOG: { lat: -2.0, lng: 2.0 },                // Gulf of Guinea
    ANG: { lat: -15.0, lng: 9.0 },               // off Angola
    SWA: { lat: -28.0, lng: 13.5 },              // off Namibia
    ATLEQ: { lat: 2.0, lng: -25.0 },             // equatorial Atlantic
    BRNE: { lat: -5.0, lng: -33.5 },             // off Natal (Brazil's NE corner)
    BRE: { lat: -14.0, lng: -36.5 },             // off Salvador
    CFRIO: { lat: -23.5, lng: -41.5 },           // off Cabo Frio
    SANTO: { lat: -24.3, lng: -46.0 },           // off Santos
    ATLM: { lat: 35.0, lng: -40.0 },             // mid-Atlantic
    ATLW: { lat: 27.5, lng: -73.0 },             // western Atlantic, NE of the Bahamas
    NYO: { lat: 40.2, lng: -72.8 },              // off New York
    SAVO: { lat: 31.6, lng: -80.2 },             // off Savannah
    FLN: { lat: 27.5, lng: -79.6 },              // northern Florida Strait
    FLM: { lat: 25.5, lng: -79.75 },             // Florida Strait off Miami
    FLS: { lat: 24.0, lng: -81.0 },              // south of the Keys
    GOM: { lat: 25.0, lng: -87.0 },              // Gulf of Mexico
    HOUO: { lat: 28.6, lng: -94.6 },             // off Galveston
    YUC: { lat: 21.6, lng: -85.9, choke: "chokepoint22", cname: "Yucatan Channel" },
    CARIB: { lat: 13.0, lng: -78.0 },            // central Caribbean
    WIND: { lat: 20.0, lng: -73.9, choke: "chokepoint23", cname: "Windward Passage" },
    COLON: { lat: 9.7, lng: -79.9 },             // Panama, Atlantic side
    PANAMA: { lat: 9.1, lng: -79.7, choke: "chokepoint2", cname: "Panama Canal" },
    BALBO: { lat: 8.4, lng: -79.4 },             // Gulf of Panama
    PMALA: { lat: 7.0, lng: -80.3 },             // off Punta Mala
    CRICA: { lat: 7.5, lng: -84.0 },             // off Costa Rica
    PCA: { lat: 12.0, lng: -90.0 },              // off Central America
    PSE: { lat: 15.0, lng: -110.0 },             // eastern tropical Pacific
    MZOO: { lat: 18.7, lng: -104.6 },            // off Manzanillo
    CABO: { lat: 22.5, lng: -110.5 },            // off Cabo San Lucas
    BAJA: { lat: 28.0, lng: -116.0 },            // off Baja California
    LAO: { lat: 33.3, lng: -118.6 },             // off San Pedro Bay
    PACE: { lat: 30.0, lng: -140.0 },            // NE Pacific
    NP1: { lat: 44.0, lng: 170.0 },              // North Pacific (west)
    NP2: { lat: 44.0, lng: -150.0 }              // North Pacific (east)
  };

  // ---- Sea edges (undirected). Each one was laid out to stay at sea at globe scale.
  var EDGES = [
    ["YS", "ECS"], ["YS", "ECS2"], ["ECS", "ECS2"], ["ECS2", "KOREA"], ["ECS2", "SJ"], ["KOREA", "SJ"],
    ["SJ", "JPE"], ["JPE", "NP1"], ["NP1", "NP2"], ["NP2", "LAO"], ["NP2", "PACE"], ["JPE", "PACE"],
    ["PACE", "BAJA"], ["PACE", "PSE"], ["PACE", "LAO"],
    ["ECS", "TWS"], ["ECS", "TWE"], ["TWE", "LUZON"], ["TWS", "SCSN"], ["LUZON", "SCSN"], ["TWE", "SJ"],
    ["SCSN", "SCSS"], ["SCSS", "SGP"], ["SGP", "MAL"], ["MAL", "MALN"], ["MALN", "ANDA"], ["SGP", "SUNDA"],
    ["ANDA", "LKS"], ["LKS", "MUM"], ["LKS", "ARABC"], ["LKS", "GOA"], ["LKS", "IOC"], ["SUNDA", "IOC"],
    ["MUM", "ARABC"], ["MUM", "IOW"], ["ARABC", "GOA"], ["ARABC", "HADD"], ["HADD", "HORMUZ"], ["HORMUZ", "PG"],
    ["ARABC", "IOW"], ["IOC", "MADS"], ["LKS", "MADS"], ["SUNDA", "MADS"], ["IOW", "MADS"], ["MADS", "AGUL"], ["AGUL", "CAPE"],
    ["GOA", "BAM"], ["BAM", "RSC"], ["RSC", "RSN"], ["RSN", "SUEZS"], ["SUEZS", "SUEZ"], ["SUEZ", "PSAID"],
    ["PSAID", "MEDE"], ["MEDE", "KYTH"], ["MEDE", "MALTA"], ["KYTH", "MALTA"], ["MALTA", "SIC"], ["SIC", "ALG"],
    ["ALG", "ALB"], ["ALB", "GIB"], ["GIB", "GIBW"], ["GIBW", "STV"], ["GIBW", "CAN"],
    ["STV", "FIN"], ["FIN", "USH"], ["USH", "CHAN"], ["CHAN", "DOVER"], ["DOVER", "NS"], ["NS", "NS2"], ["NS2", "GB"],
    ["STV", "CAN"], ["FIN", "CAN"], ["FIN", "ATLM"], ["USH", "ATLM"], ["STV", "ATLM"],
    ["CAN", "CVS"], ["CVS", "WAF"], ["WAF", "GOG"], ["GOG", "ANG"], ["ANG", "SWA"], ["SWA", "CAPE"],
    ["CVS", "ATLEQ"], ["ATLEQ", "BRNE"], ["BRNE", "BRE"], ["BRE", "CFRIO"], ["CFRIO", "SANTO"],
    ["CAPE", "SANTO"], ["CAPE", "BRE"],
    ["ATLM", "ATLW"], ["ATLM", "NYO"], ["ATLW", "NYO"], ["ATLW", "SAVO"], ["ATLW", "FLN"], ["ATLW", "WIND"],
    ["NYO", "SAVO"], ["SAVO", "FLN"], ["FLN", "FLM"], ["FLM", "FLS"], ["FLS", "GOM"], ["GOM", "HOUO"], ["GOM", "YUC"],
    ["YUC", "CARIB"], ["WIND", "CARIB"], ["CARIB", "COLON"], ["COLON", "PANAMA"], ["PANAMA", "BALBO"],
    ["CVS", "CARIB"], ["ATLEQ", "CARIB"], ["BRNE", "CARIB"],
    ["BALBO", "PMALA"], ["PMALA", "CRICA"], ["CRICA", "PCA"], ["PCA", "PSE"], ["PCA", "MZOO"], ["PSE", "MZOO"],
    ["MZOO", "CABO"], ["CABO", "BAJA"], ["BAJA", "LAO"], ["PSE", "CABO"]
  ];

  // ---- Port library, keyed by UN/LOCODE. `sea` = the waypoint(s) the port opens onto.
  // `teu` = approximate annual container throughput (2022, rounded) where well known.
  var PORTS = {
    CNSHA: { name: "Shanghai", lat: 31.23, lng: 121.47, sea: ["ECS"], teu: 47300000 },
    CNNGB: { name: "Ningbo-Zhoushan", lat: 29.87, lng: 121.54, sea: ["ECS"], teu: 33350000 },
    CNYTN: { name: "Yantian (Shenzhen)", lat: 22.57, lng: 114.27, sea: ["SCSN"] },
    CNTAO: { name: "Qingdao", lat: 36.07, lng: 120.38, sea: ["YS"] },
    KRPUS: { name: "Busan", lat: 35.10, lng: 129.04, sea: ["KOREA"], teu: 22100000 },
    JPTYO: { name: "Tokyo", lat: 35.62, lng: 139.79, sea: ["JPE"] },
    TWKHH: { name: "Kaohsiung", lat: 22.61, lng: 120.28, sea: ["TWS", "LUZON"] },
    VNCMT: { name: "Cai Mep", lat: 10.55, lng: 107.03, sea: ["SCSS"] },
    SGSIN: { name: "Singapore", lat: 1.26, lng: 103.84, sea: ["SGP"], teu: 37300000 },
    MYTPP: { name: "Tanjung Pelepas", lat: 1.36, lng: 103.55, sea: ["SGP"] },
    MYPKG: { name: "Port Klang", lat: 3.0, lng: 101.39, sea: ["MAL"] },
    LKCMB: { name: "Colombo", lat: 6.95, lng: 79.84, sea: ["LKS"] },
    INNSA: { name: "Nhava Sheva (Mumbai)", lat: 18.95, lng: 72.95, sea: ["MUM"], teu: 6000000 },
    AEJEA: { name: "Jebel Ali (Dubai)", lat: 25.01, lng: 55.06, sea: ["PG"], teu: 14000000 },
    EGPSD: { name: "Port Said", lat: 31.26, lng: 32.30, sea: ["PSAID"] },
    GRPIR: { name: "Piraeus", lat: 37.94, lng: 23.63, sea: ["KYTH"], teu: 5000000 },
    MAPTM: { name: "Tanger Med", lat: 35.89, lng: -5.50, sea: ["GIB"] },
    ESALG: { name: "Algeciras", lat: 36.13, lng: -5.44, sea: ["GIB"] },
    NLRTM: { name: "Rotterdam", lat: 51.95, lng: 4.14, sea: ["NS"], teu: 14500000 },
    BEANR: { name: "Antwerp-Bruges", lat: 51.27, lng: 4.33, sea: ["NS"] },
    DEHAM: { name: "Hamburg", lat: 53.54, lng: 9.97, sea: ["GB"], teu: 8300000 },
    GBFXT: { name: "Felixstowe", lat: 51.95, lng: 1.32, sea: ["NS", "DOVER"] },
    ZACPT: { name: "Cape Town", lat: -33.91, lng: 18.43, sea: ["CAPE"] },
    BRSSZ: { name: "Santos", lat: -23.96, lng: -46.33, sea: ["SANTO"], teu: 5000000 },
    USNYC: { name: "New York / New Jersey", lat: 40.67, lng: -74.05, sea: ["NYO"] },
    USSAV: { name: "Savannah", lat: 32.08, lng: -81.09, sea: ["SAVO"] },
    USHOU: { name: "Houston", lat: 29.73, lng: -95.27, sea: ["HOUO"] },
    PABLB: { name: "Balboa (Panama)", lat: 8.95, lng: -79.57, sea: ["BALBO"] },
    MXZLO: { name: "Manzanillo (Mexico)", lat: 19.05, lng: -104.32, sea: ["MZOO"] },
    USLAX: { name: "Los Angeles / Long Beach", lat: 33.74, lng: -118.25, sea: ["LAO"], teu: 19000000 }
  };

  var NM_PER_RAD = 3440.065; // nautical miles per radian of Earth arc
  var D2R = Math.PI / 180;

  function gcNm(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lng - a.lng) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * NM_PER_RAD * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Adjacency list over waypoints, built once.
  var ADJ = {};
  Object.keys(WP).forEach(function (k) { ADJ[k] = []; });
  EDGES.forEach(function (e) {
    var a = e[0], b = e[1];
    if (!WP[a] || !WP[b]) throw new Error("seagraph: unknown waypoint in edge " + a + "-" + b);
    var d = gcNm(WP[a], WP[b]);
    ADJ[a].push({ to: b, nm: d });
    ADJ[b].push({ to: a, nm: d });
  });

  // Chokepoint lookup tables.
  var CHOKES = {};
  Object.keys(WP).forEach(function (k) { if (WP[k].choke) CHOKES[k] = { wp: k, portwatch: WP[k].choke, name: WP[k].cname, lat: WP[k].lat, lng: WP[k].lng }; });

  // Nearest waypoints to an arbitrary coordinate — used to attach a port that isn't in the
  // library (e.g. one a user imports). Returns up to `n` waypoint keys, nearest first.
  function nearestWaypoints(lat, lng, n) {
    var p = { lat: lat, lng: lng };
    return Object.keys(WP)
      .map(function (k) { return { k: k, d: gcNm(p, WP[k]) }; })
      .sort(function (a, b) { return a.d - b.d; })
      .slice(0, n || 1)
      .map(function (x) { return x.k; });
  }

  function portInfo(code, extraPorts) {
    return (extraPorts && extraPorts[code]) || PORTS[code] || null;
  }

  /*
   * route(fromPort, toPort, opts) -> { ok, nm, path:[[lat,lng]...], via:[waypoint keys], chokes:[wp keys] }
   *   opts.closed: { WPKEY: true } — waypoints that can't be transited (a closed chokepoint)
   *   opts.avoid: same shape — waypoints this service can't use for other reasons (e.g.
   *     ultra-large container ships on Asia–Europe strings are too big for the Panama Canal)
   *   opts.ports: extra port records (same shape as PORTS) for user-imported ports
   * Dijkstra from the origin port's sea waypoints to the destination's. Closing the
   * waypoint a port opens onto genuinely cuts the port off (Hormuz isolates Jebel Ali).
   */
  function route(fromCode, toCode, opts) {
    opts = opts || {};
    var closed = {};
    [opts.closed, opts.avoid].forEach(function (m) { if (m) Object.keys(m).forEach(function (k) { if (m[k]) closed[k] = true; }); });
    var A = portInfo(fromCode, opts.ports), B = portInfo(toCode, opts.ports);
    if (!A || !B) return { ok: false, reason: "unknown port " + (!A ? fromCode : toCode) };
    if (fromCode === toCode) return { ok: true, nm: 0, path: [[A.lat, A.lng]], via: [], chokes: [] };
    var srcs = A.sea || nearestWaypoints(A.lat, A.lng, 2);
    var dsts = B.sea || nearestWaypoints(B.lat, B.lng, 2);
    var dist = {}, prev = {}, done = {};
    var heap = [];
    function push(k, d) { heap.push([d, k]); }
    srcs.forEach(function (k) {
      if (closed[k]) return;
      var d = gcNm(A, WP[k]);
      if (dist[k] === undefined || d < dist[k]) { dist[k] = d; prev[k] = null; push(k, d); }
    });
    var target = {};
    dsts.forEach(function (k) { target[k] = gcNm(WP[k], B); });
    var best = Infinity, bestEnd = null;
    while (heap.length) {
      // small graph: linear-scan priority queue is fine and keeps this dependency-free
      var bi = 0;
      for (var i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
      var top = heap.splice(bi, 1)[0], du = top[0], u = top[1];
      if (done[u]) continue;
      done[u] = true;
      if (du >= best) break;
      if (target[u] !== undefined && du + target[u] < best) { best = du + target[u]; bestEnd = u; }
      ADJ[u].forEach(function (e) {
        if (closed[e.to] || done[e.to]) return;
        var nd = du + e.nm;
        if (dist[e.to] === undefined || nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; push(e.to, nd); }
      });
    }
    if (!bestEnd) return { ok: false, reason: "no open sea route", nm: Infinity };
    var via = [];
    for (var k = bestEnd; k !== null && k !== undefined; k = prev[k]) via.unshift(k);
    var path = [[A.lat, A.lng]].concat(via.map(function (w) { return [WP[w].lat, WP[w].lng]; }), [[B.lat, B.lng]]);
    return { ok: true, nm: best, path: path, via: via, chokes: via.filter(function (w) { return !!WP[w].choke; }) };
  }

  var api = { WP: WP, EDGES: EDGES, PORTS: PORTS, CHOKES: CHOKES, gcNm: gcNm, route: route, nearestWaypoints: nearestWaypoints };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasSea = api;
})(typeof window !== "undefined" ? window : this);
