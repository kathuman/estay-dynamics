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
    corridors: [
      { id: "shanghai-lalb", from: "shanghai", to: "la-lb", lane: "Trans-Pacific", baselineDays: 16 },
      { id: "ningbo-lalb", from: "ningbo", to: "la-lb", lane: "Trans-Pacific", baselineDays: 15 },
      { id: "busan-lalb", from: "busan", to: "la-lb", lane: "Trans-Pacific", baselineDays: 11 },
      { id: "shanghai-rotterdam", from: "shanghai", to: "rotterdam", lane: "Asia-Europe (Suez)", baselineDays: 30 },
      { id: "singapore-rotterdam", from: "singapore", to: "rotterdam", lane: "Asia-Europe (Suez)", baselineDays: 26 },
      { id: "jebelali-rotterdam", from: "jebelali", to: "rotterdam", lane: "Middle East-Europe (Suez)", baselineDays: 18 },
      { id: "nhavasheva-rotterdam", from: "nhavasheva", to: "rotterdam", lane: "India-Europe (Suez)", baselineDays: 22 },
      { id: "singapore-jebelali", from: "singapore", to: "jebelali", lane: "Intra-Asia/ME", baselineDays: 9 },
      { id: "santos-rotterdam", from: "santos", to: "rotterdam", lane: "South America-Europe", baselineDays: 17 },
      { id: "shanghai-panama-santos", from: "shanghai", to: "panama", lane: "Asia-Panama-East Coast", baselineDays: 24 },
      { id: "panama-houston", from: "panama", to: "houston", lane: "Panama-US Gulf", baselineDays: 6 },
      { id: "shenzhen-shanghai", from: "shenzhen", to: "shanghai", lane: "Feeder", baselineDays: 2 },
      { id: "chennai-nhavasheva", from: "chennai", to: "nhavasheva", lane: "Feeder", baselineDays: 3 },
      { id: "hcmc-singapore", from: "hcmc", to: "singapore", lane: "Feeder", baselineDays: 2 },
      { id: "wroclaw-rotterdam", from: "wroclaw", to: "rotterdam", lane: "Feeder (rail/road)", baselineDays: 2 },
      { id: "monterrey-lalb", from: "monterrey", to: "la-lb", lane: "Feeder (rail/road)", baselineDays: 3 },
      { id: "guadalajara-manzanillo", from: "guadalajara", to: "manzanillo", lane: "Feeder (rail/road)", baselineDays: 1 },
      { id: "penang-singapore", from: "penang", to: "singapore", lane: "Feeder", baselineDays: 2 },
      { id: "bangalore-nhavasheva", from: "bangalore", to: "nhavasheva", lane: "Feeder", baselineDays: 2 },
      { id: "lalb-memphis", from: "la-lb", to: "dc-memphis", lane: "Distribution", baselineDays: 3 },
      { id: "rotterdam-venlo", from: "rotterdam", to: "dc-venlo", lane: "Distribution", baselineDays: 1 },
      { id: "shanghai-suzhou", from: "shanghai", to: "dc-suzhou", lane: "Distribution", baselineDays: 1 }
    ]
  },

  disruptions: [
    {
      id: "redsea-geo", type: "geopolitical", name: "Red Sea / Bab-el-Mandeb Security Alert",
      lat: 13.0, lng: 43.3, severity: 5,
      description: "Vessel attacks and rerouting advisories in the southern Red Sea are pushing carriers away from the Suez Canal approach.",
      affectsCorridors: ["shanghai-rotterdam", "singapore-rotterdam", "jebelali-rotterdam", "nhavasheva-rotterdam"]
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
      affectsCorridors: ["shanghai-rotterdam", "singapore-rotterdam", "jebelali-rotterdam", "nhavasheva-rotterdam", "santos-rotterdam", "wroclaw-rotterdam"]
    },
    {
      id: "panama-drought", type: "weather", name: "Panama Canal Draft Restrictions",
      lat: 8.95, lng: -79.5667, severity: 3,
      description: "Low reservoir levels are capping daily transits and vessel draft, creating queues and forcing cargo offloads.",
      affectsCorridors: ["shanghai-panama-santos", "panama-houston"]
    },
    {
      id: "lalb-strike", type: "strike", name: "West Coast Port Labor Action",
      lat: 33.7550, lng: -118.2160, severity: 4,
      description: "Contract dispute at Los Angeles / Long Beach is causing intermittent slowdowns and vessel bunching.",
      affectsCorridors: ["shanghai-lalb", "ningbo-lalb", "busan-lalb", "monterrey-lalb"]
    },
    {
      id: "northatlantic-weather", type: "weather", name: "North Atlantic Winter Storm System",
      lat: 54.5, lng: 2.0, severity: 2,
      description: "Gale-force conditions in the North Sea approach are delaying berthing windows at Hamburg and Rotterdam.",
      affectsCorridors: ["santos-rotterdam", "wroclaw-rotterdam"]
    }
  ],

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
