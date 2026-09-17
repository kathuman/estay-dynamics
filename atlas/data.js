/*
 * Sample network + disruption + scenario data for the Global Disruption Atlas.
 * This mirrors the JSON files under data/ but is loaded as plain JS so the
 * prototype runs from a local file:// path with no server or build step.
 * Swap ATLAS_DATA for a live feed (AIS, GDACS, NOAA, ACLED, ERP buffer levels,
 * etc.) to move this from prototype to production.
 */
const ATLAS_DATA = {
  network: {
    ports: [
      { id: "shanghai", name: "Shanghai", lat: 31.2304, lng: 121.4737, throughputTEU: 47300000 },
      { id: "ningbo", name: "Ningbo-Zhoushan", lat: 29.8683, lng: 121.5440, throughputTEU: 33350000 },
      { id: "singapore", name: "Singapore", lat: 1.3521, lng: 103.8198, throughputTEU: 37200000 },
      { id: "rotterdam", name: "Rotterdam", lat: 51.9244, lng: 4.4777, throughputTEU: 14500000 },
      { id: "hamburg", name: "Hamburg", lat: 53.5459, lng: 9.9681, throughputTEU: 8300000 },
      { id: "la-lb", name: "Los Angeles / Long Beach", lat: 33.7550, lng: -118.2160, throughputTEU: 17300000 },
      { id: "busan", name: "Busan", lat: 35.1796, lng: 129.0756, throughputTEU: 22700000 },
      { id: "jebelali", name: "Jebel Ali (Dubai)", lat: 25.0118, lng: 55.0618, throughputTEU: 14100000 },
      { id: "nhavasheva", name: "Nhava Sheva (Mumbai)", lat: 18.9490, lng: 72.9525, throughputTEU: 6100000 },
      { id: "santos", name: "Santos", lat: -23.9608, lng: -46.3339, throughputTEU: 4700000 },
      { id: "piraeus", name: "Piraeus", lat: 37.9475, lng: 23.6347, throughputTEU: 5400000 },
      { id: "panama", name: "Balboa (Panama Canal)", lat: 8.9500, lng: -79.5667, throughputTEU: 3800000 },
      { id: "manzanillo", name: "Manzanillo (Mexico)", lat: 19.0546, lng: -104.3157, throughputTEU: 3900000 },
      { id: "capetown", name: "Cape Town", lat: -33.9249, lng: 18.4241, throughputTEU: 900000 },
      { id: "houston", name: "Houston", lat: 29.7604, lng: -95.3698, throughputTEU: 4200000 }
    ],
    warehouses: [
      { id: "dc-memphis", name: "Memphis Distribution Center", lat: 35.1495, lng: -90.0490, detail: "Central US regional DC, rail/air feeder from LA/LB" },
      { id: "dc-venlo", name: "Venlo European DC", lat: 51.3704, lng: 6.1724, detail: "European regional DC fed from Rotterdam" },
      { id: "dc-suzhou", name: "Suzhou Buffer Warehouse", lat: 31.2989, lng: 120.5853, detail: "Overflow buffer stock near Shanghai" }
    ],
    factories: [
      { id: "shenzhen", name: "Shenzhen Electronics Cluster", lat: 22.5431, lng: 114.0579, sector: "Electronics", feederPort: "shanghai" },
      { id: "chennai", name: "Chennai Auto & Components", lat: 13.0827, lng: 80.2707, sector: "Automotive", feederPort: "nhavasheva" },
      { id: "hcmc", name: "Ho Chi Minh City Apparel/Electronics", lat: 10.8231, lng: 106.6297, sector: "Apparel/Electronics", feederPort: "singapore" },
      { id: "wroclaw", name: "Wroclaw Industrial Park", lat: 51.1079, lng: 17.0385, sector: "Machinery", feederPort: "rotterdam" },
      { id: "monterrey", name: "Monterrey Manufacturing Hub", lat: 25.6866, lng: -100.3161, sector: "Automotive/Appliances", feederPort: "la-lb" },
      { id: "guadalajara", name: "Guadalajara Electronics Valley", lat: 20.6597, lng: -103.3496, sector: "Electronics", feederPort: "manzanillo" },
      { id: "penang", name: "Penang Semiconductor Cluster", lat: 5.4141, lng: 100.3288, sector: "Semiconductors", feederPort: "singapore" },
      { id: "bangalore", name: "Bangalore Tech & Components", lat: 12.9716, lng: 77.5946, sector: "Electronics", feederPort: "nhavasheva" }
    ],
    // teu is illustrative annual volume (containers/yr) — it's what turns an
    // extra-transit-day count into a dollar figure (see estimateCorridorCost
    // in app.js): daily value in transit = teu * $/TEU / 365.
    corridors: [
      { id: "shanghai-lalb", from: "shanghai", to: "la-lb", lane: "Trans-Pacific", baselineDays: 16, teu: 1900000 },
      { id: "ningbo-lalb", from: "ningbo", to: "la-lb", lane: "Trans-Pacific", baselineDays: 15, teu: 1400000 },
      { id: "busan-lalb", from: "busan", to: "la-lb", lane: "Trans-Pacific", baselineDays: 11, teu: 650000 },
      { id: "shanghai-rotterdam", from: "shanghai", to: "rotterdam", lane: "Asia-Europe (Suez)", baselineDays: 30, teu: 900000 },
      { id: "singapore-rotterdam", from: "singapore", to: "rotterdam", lane: "Asia-Europe (Suez)", baselineDays: 26, teu: 700000 },
      { id: "jebelali-rotterdam", from: "jebelali", to: "rotterdam", lane: "Middle East-Europe (Suez)", baselineDays: 18, teu: 350000 },
      { id: "nhavasheva-rotterdam", from: "nhavasheva", to: "rotterdam", lane: "India-Europe (Suez)", baselineDays: 22, teu: 300000 },
      { id: "singapore-jebelali", from: "singapore", to: "jebelali", lane: "Intra-Asia/ME", baselineDays: 9, teu: 250000 },
      { id: "santos-rotterdam", from: "santos", to: "rotterdam", lane: "South America-Europe", baselineDays: 17, teu: 220000 },
      { id: "shanghai-panama-santos", from: "shanghai", to: "panama", lane: "Asia-Panama-East Coast", baselineDays: 24, teu: 380000 },
      { id: "panama-houston", from: "panama", to: "houston", lane: "Panama-US Gulf", baselineDays: 6, teu: 150000 },
      { id: "shenzhen-shanghai", from: "shenzhen", to: "shanghai", lane: "Feeder", baselineDays: 2, teu: 500000 },
      { id: "chennai-nhavasheva", from: "chennai", to: "nhavasheva", lane: "Feeder", baselineDays: 3, teu: 180000 },
      { id: "hcmc-singapore", from: "hcmc", to: "singapore", lane: "Feeder", baselineDays: 2, teu: 220000 },
      { id: "wroclaw-rotterdam", from: "wroclaw", to: "rotterdam", lane: "Feeder (rail/road)", baselineDays: 2, teu: 90000 },
      { id: "monterrey-lalb", from: "monterrey", to: "la-lb", lane: "Feeder (rail/road)", baselineDays: 3, teu: 140000 },
      { id: "guadalajara-manzanillo", from: "guadalajara", to: "manzanillo", lane: "Feeder (rail/road)", baselineDays: 1, teu: 60000 },
      { id: "penang-singapore", from: "penang", to: "singapore", lane: "Feeder", baselineDays: 2, teu: 160000 },
      { id: "bangalore-nhavasheva", from: "bangalore", to: "nhavasheva", lane: "Feeder", baselineDays: 2, teu: 130000 },
      { id: "lalb-memphis", from: "la-lb", to: "dc-memphis", lane: "Distribution", baselineDays: 3, teu: 300000 },
      { id: "rotterdam-venlo", from: "rotterdam", to: "dc-venlo", lane: "Distribution", baselineDays: 1, teu: 250000 },
      { id: "shanghai-suzhou", from: "shanghai", to: "dc-suzhou", lane: "Distribution", baselineDays: 1, teu: 200000 }
    ]
  },

  // affectsCorridors is the curated, exact-fidelity list for the sample
  // network (kept so the prototype's visuals never change). affectedNodes /
  // affectedLaneTags are the SAME exposure expressed as a rule instead of a
  // list, so an imported corridor can be swept in too: route it through an
  // existing node id (e.g. "rotterdam"), or give its lane a matching tag
  // (e.g. "Suez"). An affectedNodes entry is either a plain node id (matches
  // either end of the corridor) or { id, role: "from"|"to" } to match only
  // one end — needed where direction matters (e.g. the LA/LB strike affects
  // inbound vessel discharge, not the outbound domestic feeder that happens
  // to touch the same port).
  //
  // Only added where a clean rule reproduces the curated list exactly —
  // Taiwan Strait and North Atlantic below don't reduce to one without
  // guessing, so they stay curated-only for now (still fully functional for
  // the sample network; just not yet extended to custom corridors).
  disruptions: [
    {
      id: "redsea-geo", type: "geopolitical", name: "Red Sea / Bab-el-Mandeb Security Alert",
      lat: 13.0, lng: 43.3, severity: 5,
      description: "Vessel attacks and rerouting advisories in the southern Red Sea are pushing carriers away from the Suez Canal approach.",
      affectsCorridors: ["shanghai-rotterdam", "singapore-rotterdam", "jebelali-rotterdam", "nhavasheva-rotterdam"],
      affectedLaneTags: ["suez"]
    },
    {
      id: "taiwanstrait-weather", type: "weather", name: "Typhoon Track - Taiwan Strait",
      lat: 23.5, lng: 121.0, severity: 4,
      description: "Tropical cyclone forecast to cross major East Asia shipping lanes, risking port closures at Shanghai and Ningbo.",
      affectsCorridors: ["shanghai-lalb", "ningbo-lalb", "shanghai-rotterdam", "shenzhen-shanghai"]
    },
    {
      id: "rotterdam-strike", type: "strike", name: "Rotterdam Dockworker Strike",
      lat: 51.9244, lng: 4.4777, severity: 3,
      description: "Union action over automation and pay is slowing container handling at Europe's largest port.",
      affectsCorridors: ["shanghai-rotterdam", "singapore-rotterdam", "jebelali-rotterdam", "nhavasheva-rotterdam", "santos-rotterdam", "wroclaw-rotterdam"],
      affectedNodes: [{ id: "rotterdam", role: "to" }]
    },
    {
      id: "panama-drought", type: "weather", name: "Panama Canal Draft Restrictions",
      lat: 8.95, lng: -79.5667, severity: 3,
      description: "Low reservoir levels are capping daily transits and vessel draft, creating queues and forcing cargo offloads.",
      affectsCorridors: ["shanghai-panama-santos", "panama-houston"],
      affectedNodes: ["panama"]
    },
    {
      id: "lalb-strike", type: "strike", name: "West Coast Port Labor Action",
      lat: 33.7550, lng: -118.2160, severity: 4,
      description: "Contract dispute at Los Angeles / Long Beach is causing intermittent slowdowns and vessel bunching.",
      affectsCorridors: ["shanghai-lalb", "ningbo-lalb", "busan-lalb", "monterrey-lalb"],
      affectedNodes: [{ id: "la-lb", role: "to" }]
    },
    {
      id: "northatlantic-weather", type: "weather", name: "North Atlantic Winter Storm System",
      lat: 54.5, lng: 2.0, severity: 2,
      description: "Gale-force conditions in the North Sea approach are delaying berthing windows at Hamburg and Rotterdam.",
      affectsCorridors: ["santos-rotterdam", "wroclaw-rotterdam"]
    }
  ],

  // disabledCorridors is the curated, exact-fidelity list, same deal as
  // affectsCorridors above. disabledNodes/disabledLaneTags generalize it the
  // same way — but note a scenario's disabled scope is often narrower than
  // its disruption's affected scope: panama-buffer only suspends the OUTBOUND
  // Panama->Gulf leg (the landbridge response), while the inbound Asia-Panama
  // leg stays merely at-risk (still shown, just not "suspended"). So these
  // are scenario-specific fields, not just re-reading respondsTo's disruption.
  scenarios: [
    {
      id: "baseline", name: "Baseline Network", shortLabel: "Baseline (no active response)",
      narrative: "The network is operating on its normal lanes and lead times. No rerouting, buffering, or alternate-sourcing actions are active.",
      extraTransitDays: 0, disabledCorridors: [], addedArcs: [], bufferSites: [], alternateSuppliers: []
    },
    {
      id: "redsea-reroute", name: "Red Sea Crisis — Cape of Good Hope Reroute", shortLabel: "Reroute: Suez → Cape of Good Hope",
      narrative: "In response to the Red Sea security alert, Asia–Europe and Middle East–Europe strings are diverted around the Cape of Good Hope. This adds roughly 10–14 days and 3,000+ nautical miles per voyage, and absorbs vessel capacity that would otherwise serve other lanes.",
      extraTransitDays: 12,
      respondsTo: "redsea-geo",
      reroute: { type: "via", via: "capetown" },
      disabledLaneTags: ["suez"],
      disabledCorridors: ["shanghai-rotterdam", "singapore-rotterdam", "jebelali-rotterdam", "nhavasheva-rotterdam"],
      addedArcs: [
        { id: "shanghai-capetown", from: "shanghai", to: "capetown", lane: "Cape Reroute", note: "Diverted around Cape of Good Hope" },
        { id: "singapore-capetown", from: "singapore", to: "capetown", lane: "Cape Reroute", note: "Diverted around Cape of Good Hope" },
        { id: "jebelali-capetown", from: "jebelali", to: "capetown", lane: "Cape Reroute", note: "Diverted around Cape of Good Hope" },
        { id: "nhavasheva-capetown", from: "nhavasheva", to: "capetown", lane: "Cape Reroute", note: "Diverted around Cape of Good Hope" },
        { id: "capetown-rotterdam", from: "capetown", to: "rotterdam", lane: "Cape Reroute", note: "Final leg into Northern Europe" }
      ],
      bufferSites: [{ portId: "rotterdam", note: "Safety stock raised ~2 weeks to cover extended transit" }],
      alternateSuppliers: []
    },
    {
      id: "panama-buffer", name: "Panama Canal Drought — Inventory Buffer + Rail Landbridge", shortLabel: "Buffer + Landbridge: Panama drought",
      narrative: "Low reservoir levels cap daily transits through Panama. Cargo bound for the Gulf and East Coast is shifted to a West Coast discharge plus rail landbridge, while distribution centers draw down pre-positioned buffer stock to cover the gap.",
      extraTransitDays: 6,
      respondsTo: "panama-drought",
      reroute: { type: "none" },
      disabledNodes: [{ id: "panama", role: "from" }],
      disabledCorridors: ["panama-houston"],
      addedArcs: [
        { id: "lalb-houston-landbridge", from: "la-lb", to: "houston", lane: "Rail Landbridge", note: "West Coast discharge + rail to Gulf, bypassing the canal" }
      ],
      bufferSites: [
        { portId: "houston", note: "14 days of safety stock activated for Gulf Coast distribution" },
        { portId: "la-lb", note: "Buffer inventory drawn down to cover landbridge lead time" }
      ],
      alternateSuppliers: []
    },
    {
      id: "lalb-altsupplier", name: "West Coast Port Strike — Alternate Gateway + Supplier Activation", shortLabel: "Reroute + alt-source: LA/LB strike",
      narrative: "Labor action at Los Angeles / Long Beach halts Trans-Pacific discharge. Volume is redirected through Manzanillo, Mexico, with rail feeder to Monterrey, while a qualified alternate electronics supplier in Guadalajara is activated to keep production running.",
      extraTransitDays: 8,
      respondsTo: "lalb-strike",
      reroute: { type: "altNode", node: "la-lb", altNode: "manzanillo" },
      disabledNodes: [{ id: "la-lb", role: "to" }],
      disabledCorridors: ["shanghai-lalb", "ningbo-lalb", "busan-lalb", "monterrey-lalb"],
      addedArcs: [
        { id: "shanghai-manzanillo", from: "shanghai", to: "manzanillo", lane: "Alt Gateway", note: "Redirected from LA/LB" },
        { id: "ningbo-manzanillo", from: "ningbo", to: "manzanillo", lane: "Alt Gateway", note: "Redirected from LA/LB" },
        { id: "manzanillo-monterrey", from: "manzanillo", to: "monterrey", lane: "Rail Feeder", note: "Replaces LA/LB rail feeder" }
      ],
      bufferSites: [{ portId: "manzanillo", note: "Surge capacity utilized as alternate West Coast gateway" }],
      alternateSuppliers: [{ factoryId: "guadalajara", note: "Qualified as alternate electronics source while LA/LB is disrupted" }]
    }
  ]
};
