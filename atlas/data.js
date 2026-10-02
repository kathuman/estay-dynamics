/*
 * Global Disruption Atlas — model data: the sample network, the event library and the
 * flexibility levers. Plain JS (not JSON) so the Atlas runs from a local file:// path.
 *
 * Honesty rules for this file:
 *   - The sample network is ILLUSTRATIVE: a made-up electronics manufacturer on real ports
 *     and real sea lanes. Capacities, rates and margins are round, plausible numbers, not
 *     anyone's actual data — every one is editable in the app or replaceable by CSV import.
 *   - Historical events are real and dated, with a source link. Their effect parameters
 *     (capacity factors, delays, rate uplifts) are modelling assumptions calibrated to the
 *     public record, and are labelled as such in the UI.
 *   - Hypothetical stress tests are labelled "hypothetical".
 *   - Live conditions come only from data/signals.js (fetched from public sources).
 *
 * Effect schema (all optional):
 *   closed:  [waypointKey]                — chokepoints no container service can transit
 *   choke:   { waypointKey: {cap, delay} } — capacity factor (0–1) and queue days
 *   ports:   { LOCODE: {cap, delay} }      — port throughput factor and extra dwell days
 *   supply:  { factoryId: factor }         — factory output factor
 *   uplift:  { tradeCode | "*": frac }     — ocean freight-rate increase (0.5 = +50%)
 * Duration (days): actual = what happened; min/mode/max = triangular distribution used by
 * the Monte Carlo for "an event like this". annualProb = assumed yearly likelihood of an
 * event like this hitting this network (an assumption, used only for expected annual loss).
 */
var ATLAS_DATA = {
  defaults: {
    speedKn: 16,             // average service speed incl. slow steaming
    dwellDays: 1.5,          // port time at each end of an ocean leg
    valuePerTeu: 45000,      // cargo value per TEU ($)
    carryingRatePct: 12,     // annual cost of capital on goods in transit / in stock
    holdingRatePct: 20,      // annual all-in cost of holding safety stock (capital + storage + obsolescence)
    lostMarginPerTeu: 18000, // cost of a lost sale per TEU: contribution margin + penalties/churn ($)
    distanceShare: 0.4,      // share of an ocean rate that scales with sailed distance (fuel, vessel days)
    mcRuns: 400              // Monte Carlo samples per event
  },

  trades: {
    TPWC: "Asia – US West Coast", TPEC: "Asia – US East & Gulf Coast", MX: "Asia – Mexico",
    AE: "Asia – North Europe", AM: "Asia – Mediterranean", IE: "India – Europe",
    IU: "India – US East Coast", ME: "Middle East – Europe", SAE: "South America – Europe"
  },

  network: {
    name: "Sample network — illustrative electronics manufacturer",
    note: "Made-up company on real ports and sea lanes. Numbers are round and plausible, not real company data.",
    factories: [
      { id: "f-shenzhen", name: "Shenzhen electronics cluster", lat: 22.54, lng: 114.06, sector: "Consumer electronics", cap: 800, prodCost: 0,
        exports: [{ port: "CNYTN", days: 1, cost: 150, mode: "road" }] },
      { id: "f-yangtze", name: "Suzhou / Yangtze Delta assembly", lat: 31.30, lng: 120.59, sector: "PCs & peripherals", cap: 700, prodCost: 0,
        exports: [{ port: "CNSHA", days: 1, cost: 150, mode: "road" }, { port: "CNNGB", days: 2, cost: 280, mode: "road" }] },
      { id: "f-changwon", name: "Changwon components (Korea)", lat: 35.23, lng: 128.68, sector: "Displays & components", cap: 200, prodCost: 350,
        exports: [{ port: "KRPUS", days: 1, cost: 180, mode: "road" }] },
      { id: "f-hcmc", name: "Ho Chi Minh City assembly", lat: 10.82, lng: 106.63, sector: "Electronics assembly", cap: 350, prodCost: 200,
        exports: [{ port: "VNCMT", days: 1, cost: 160, mode: "road" }] },
      { id: "f-penang", name: "Penang semiconductor back-end", lat: 5.41, lng: 100.33, sector: "Semiconductors", cap: 200, prodCost: 300,
        exports: [{ port: "MYPKG", days: 1, cost: 220, mode: "road" }, { port: "SGSIN", days: 2, cost: 420, mode: "rail" }] },
      { id: "f-chennai", name: "Chennai / Bangalore electronics", lat: 12.97, lng: 77.59, sector: "Electronics & auto components", cap: 400, prodCost: 250,
        exports: [{ port: "INNSA", days: 3, cost: 380, mode: "rail" }] },
      { id: "f-jafza", name: "Jebel Ali Free Zone re-export hub", lat: 24.99, lng: 55.11, sector: "Re-export & kitting", cap: 80, prodCost: 500,
        exports: [{ port: "AEJEA", days: 1, cost: 120, mode: "road" }] },
      { id: "f-campinas", name: "Campinas components (Brazil)", lat: -22.91, lng: -47.06, sector: "Components", cap: 120, prodCost: 600,
        exports: [{ port: "BRSSZ", days: 1, cost: 200, mode: "road" }] },
      { id: "f-wroclaw", name: "Wroclaw industrial park", lat: 51.11, lng: 17.04, sector: "Appliances", cap: 150, prodCost: 1200,
        direct: [{ dc: "dc-venlo", days: 2, cost: 900, mode: "road" }] },
      { id: "f-monterrey", name: "Monterrey manufacturing hub", lat: 25.69, lng: -100.32, sector: "Appliances", cap: 200, prodCost: 900,
        direct: [{ dc: "dc-memphis", days: 3, cost: 1600, mode: "road" }, { dc: "dc-atlanta", days: 4, cost: 1900, mode: "road" }] },
      { id: "f-guadalajara", name: "Guadalajara electronics (standby second source)", lat: 20.66, lng: -103.35, sector: "Electronics", cap: 0, prodCost: 1400,
        standby: { cap: 250, lever: "dualSource" },
        direct: [{ dc: "dc-memphis", days: 5, cost: 2200, mode: "road" }, { dc: "dc-atlanta", days: 6, cost: 2500, mode: "road" }] }
    ],
    dcs: [
      { id: "dc-memphis", name: "Memphis DC (US Central)", lat: 35.15, lng: -90.05, demand: 900, bufferDays: 12,
        imports: [{ port: "USLAX", days: 4, cost: 1100, mode: "rail" }, { port: "USHOU", days: 2, cost: 700, mode: "road" },
                  { port: "USSAV", days: 2, cost: 800, mode: "road" }, { port: "MXZLO", days: 6, cost: 1800, mode: "rail" }] },
      { id: "dc-atlanta", name: "Atlanta DC (US East)", lat: 33.75, lng: -84.39, demand: 600, bufferDays: 8,
        imports: [{ port: "USSAV", days: 1, cost: 400, mode: "road" }, { port: "USNYC", days: 3, cost: 1000, mode: "road" },
                  { port: "USHOU", days: 3, cost: 1000, mode: "road" }, { port: "USLAX", days: 5, cost: 1400, mode: "rail" }] },
      { id: "dc-venlo", name: "Venlo DC (Europe)", lat: 51.37, lng: 6.17, demand: 1000, bufferDays: 8,
        imports: [{ port: "NLRTM", days: 1, cost: 350, mode: "barge" }, { port: "BEANR", days: 1, cost: 400, mode: "road" },
                  { port: "DEHAM", days: 2, cost: 600, mode: "road" }, { port: "GRPIR", days: 6, cost: 1500, mode: "rail" }] }
    ],
    // Ocean services: weekly allotment (TEU/week) and base all-in rate ($/TEU) on the
    // usual routing. `ulcv` = served by ultra-large ships that can't use the Panama Canal.
    services: [
      { id: "s-ytn-lax", from: "CNYTN", to: "USLAX", trade: "TPWC", cap: 600, rate: 1100 },
      { id: "s-sha-lax", from: "CNSHA", to: "USLAX", trade: "TPWC", cap: 600, rate: 1100 },
      { id: "s-ngb-lax", from: "CNNGB", to: "USLAX", trade: "TPWC", cap: 300, rate: 1100 },
      { id: "s-pus-lax", from: "KRPUS", to: "USLAX", trade: "TPWC", cap: 250, rate: 1050 },
      { id: "s-cmt-lax", from: "VNCMT", to: "USLAX", trade: "TPWC", cap: 250, rate: 1250 },
      { id: "s-sha-zlo", from: "CNSHA", to: "MXZLO", trade: "MX", cap: 200, rate: 1300 },
      { id: "s-ytn-sav", from: "CNYTN", to: "USSAV", trade: "TPEC", cap: 350, rate: 1700 },
      { id: "s-sha-sav", from: "CNSHA", to: "USSAV", trade: "TPEC", cap: 250, rate: 1700 },
      { id: "s-sha-hou", from: "CNSHA", to: "USHOU", trade: "TPEC", cap: 150, rate: 1750 },
      { id: "s-sin-nyc", from: "SGSIN", to: "USNYC", trade: "TPEC", cap: 150, rate: 1800 },
      { id: "s-nsa-nyc", from: "INNSA", to: "USNYC", trade: "IU", cap: 150, rate: 1500 },
      { id: "s-ytn-rtm", from: "CNYTN", to: "NLRTM", trade: "AE", cap: 500, rate: 900, ulcv: true },
      { id: "s-sha-rtm", from: "CNSHA", to: "NLRTM", trade: "AE", cap: 450, rate: 900, ulcv: true },
      { id: "s-ngb-ham", from: "CNNGB", to: "DEHAM", trade: "AE", cap: 300, rate: 950, ulcv: true },
      { id: "s-pus-rtm", from: "KRPUS", to: "NLRTM", trade: "AE", cap: 150, rate: 950, ulcv: true },
      { id: "s-sin-rtm", from: "SGSIN", to: "NLRTM", trade: "AE", cap: 250, rate: 850, ulcv: true },
      { id: "s-cmt-anr", from: "VNCMT", to: "BEANR", trade: "AE", cap: 150, rate: 950, ulcv: true },
      { id: "s-ytn-pir", from: "CNYTN", to: "GRPIR", trade: "AM", cap: 200, rate: 1000, ulcv: true },
      { id: "s-nsa-rtm", from: "INNSA", to: "NLRTM", trade: "IE", cap: 200, rate: 800 },
      { id: "s-jea-rtm", from: "AEJEA", to: "NLRTM", trade: "ME", cap: 100, rate: 800 },
      { id: "s-ssz-rtm", from: "BRSSZ", to: "NLRTM", trade: "SAE", cap: 150, rate: 1000 }
    ]
  },

  // ---- Flexibility levers. annualCost = what holding the option costs per year, whether
  // or not a disruption happens. rampDays = lead time before the option delivers.
  levers: {
    buffer: { name: "Extra safety stock", unit: "days", max: 45, step: 1,
      text: "Hold extra days of demand at every DC. Buys time (raises time-to-survive) at a holding cost every year." },
    dualSource: { name: "Qualified second source (Mexico)", annualCost: 3500000, rampDays: 21, surge: { "f-monterrey": 100 },
      text: "Keep Guadalajara qualified and on standby (250 TEU/wk) plus 100 TEU/wk surge at Monterrey. Retainer paid every year; ~3 weeks to ramp." },
    airBridge: { name: "Air-freight bridge contract", annualCost: 1200000, rampDays: 4, capPerDc: 120, costPerTeu: 16000, days: 3,
      text: "Pre-agreed air capacity into each DC (120 TEU-equivalent/wk), used only to cover a shortfall. Arrives about a week after booking; costs ~10x ocean." },
    gateways: { name: "Multi-gateway contracts", annualCost: 4000000, rampDays: 0, capBoost: 0.6,
      ports: ["MXZLO", "USSAV", "USHOU", "USNYC", "DEHAM", "BEANR", "GRPIR"],
      text: "Contracted standby allotments (+60%) on the alternate gateways — Manzanillo, Savannah, Houston, New York, Hamburg, Antwerp, Piraeus." },
    rateHedge: { name: "Fixed-rate long-term contracts", premiumPct: 8, coverage: 0.7,
      text: "Lock most ocean volume into fixed-rate annual contracts: pay ~8% over expected spot every year, and avoid ~70% of any disruption surcharge. The only lever here that hedges price rather than capacity." }
  },

  events: [
    // ---------------- Historical (real, dated, sourced) ----------------
    { id: "redsea-2023", kind: "historical", type: "geopolitical", name: "Red Sea / Bab-el-Mandeb attacks",
      period: "Dec 2023 – ongoing", lat: 13.5, lng: 42.8, severity: 5,
      description: "Attacks on merchant ships near Bab-el-Mandeb led most large container lines to stop using the Suez route from mid-December 2023 and sail round the Cape of Good Hope instead — roughly 10 extra days Asia–North Europe, absorbing a large share of global vessel capacity. Spot rates on Asia–Europe more than doubled within weeks.",
      source: { label: "Wikipedia — Red Sea crisis", url: "https://en.wikipedia.org/wiki/Red_Sea_crisis" },
      effects: { closed: ["BAM"], uplift: { AE: 1.6, AM: 1.6, IE: 1.2, ME: 1.0, IU: 0.8, "*": 0.35 } },
      duration: { actual: 365, min: 90, mode: 365, max: 900 }, annualProb: 0.15 },
    { id: "panama-2023", kind: "historical", type: "weather", name: "Panama Canal drought restrictions",
      period: "Jun 2023 – mid 2024", lat: 9.1, lng: -79.7, severity: 3,
      description: "Low water in Gatún Lake forced the canal to cap draft and cut daily transit slots — to as few as 22 a day against roughly 36 normally. Container lines mostly kept their booked slots (PortWatch container transits stayed near 90–96% of normal); bulk and gas carriers took most of the cuts, while queues and draft limits still cost container services time and payload.",
      source: { label: "Wikipedia — Panama Canal", url: "https://en.wikipedia.org/wiki/Panama_Canal" },
      effects: { choke: { PANAMA: { cap: 0.9, delay: 4 } }, uplift: { TPEC: 0.25 } },
      duration: { actual: 300, min: 60, mode: 240, max: 420 }, annualProb: 0.1 },
    { id: "evergiven-2021", kind: "historical", type: "accident", name: "Ever Given blocks the Suez Canal",
      period: "23–29 Mar 2021", lat: 30.0, lng: 32.58, severity: 4,
      description: "The 20,000-TEU Ever Given ran aground and blocked the canal for six days; hundreds of ships queued and some diverted round the Cape. The knock-on bunching hit European ports for weeks.",
      source: { label: "Wikipedia — Ever Given grounding", url: "https://en.wikipedia.org/wiki/2021_Suez_Canal_obstruction" },
      effects: { closed: ["SUEZ"], uplift: { AE: 0.1, AM: 0.1 } },
      duration: { actual: 6, min: 3, mode: 6, max: 21 }, annualProb: 0.05 },
    { id: "lalb-2021", kind: "historical", type: "congestion", name: "LA / Long Beach congestion",
      period: "2021 – early 2022", lat: 33.74, lng: -118.25, severity: 4,
      description: "A demand surge plus pandemic labour and chassis shortages left record queues of container ships waiting off San Pedro Bay; transpacific spot rates rose several-fold.",
      source: { label: "Wikipedia — 2021–2023 global supply chain crisis", url: "https://en.wikipedia.org/wiki/2021%E2%80%932023_global_supply_chain_crisis" },
      effects: { ports: { USLAX: { cap: 0.7, delay: 14 } }, uplift: { TPWC: 2.0, TPEC: 1.5, MX: 1.5 } },
      duration: { actual: 270, min: 60, mode: 180, max: 330 }, annualProb: 0.05 },
    { id: "yantian-2021", kind: "historical", type: "pandemic", name: "Yantian port COVID shutdown",
      period: "May – Jun 2021", lat: 22.57, lng: 114.27, severity: 4,
      description: "A COVID outbreak cut Yantian's capacity to a fraction for about a month; ships skipped the port and South China exports backed up.",
      source: { label: "Wikipedia — 2021–2023 global supply chain crisis", url: "https://en.wikipedia.org/wiki/2021%E2%80%932023_global_supply_chain_crisis" },
      effects: { ports: { CNYTN: { cap: 0.3, delay: 10 } }, uplift: { AE: 0.2, TPWC: 0.2 } },
      duration: { actual: 30, min: 14, mode: 30, max: 60 }, annualProb: 0.05 },
    { id: "shanghai-2022", kind: "historical", type: "pandemic", name: "Shanghai lockdown",
      period: "Apr – May 2022", lat: 31.23, lng: 121.47, severity: 4,
      description: "The city-wide lockdown kept the port open but choked trucking and shut much of the Yangtze Delta's factory output for about two months.",
      source: { label: "Wikipedia — 2022 Shanghai COVID-19 outbreak", url: "https://en.wikipedia.org/wiki/2022_Shanghai_COVID-19_outbreak" },
      effects: { ports: { CNSHA: { cap: 0.7, delay: 5 } }, supply: { "f-yangtze": 0.4 } },
      duration: { actual: 60, min: 30, mode: 60, max: 90 }, annualProb: 0.03 },
    { id: "saola-2023", kind: "historical", type: "weather", name: "Typhoon Saola shuts South China ports",
      period: "1–3 Sep 2023", lat: 22.3, lng: 114.2, severity: 3,
      description: "One of the strongest typhoons to approach Hong Kong and Shenzhen in decades closed terminals and factories for several days. Typhoon closures like this hit South China most years.",
      source: { label: "Wikipedia — Typhoon Saola (2023)", url: "https://en.wikipedia.org/wiki/Typhoon_Saola_(2023)" },
      effects: { ports: { CNYTN: { cap: 0.0, delay: 3 } }, supply: { "f-shenzhen": 0.5 } },
      duration: { actual: 3, min: 2, mode: 4, max: 10 }, annualProb: 0.6 },
    { id: "ila-2024", kind: "historical", type: "strike", name: "US East & Gulf Coast port strike",
      period: "1–3 Oct 2024", lat: 32.08, lng: -81.09, severity: 4,
      description: "Dockworkers struck at 36 ports from Maine to Texas for three days before a tentative deal. Durations here are sampled up to six weeks, because a longer stoppage was widely planned for.",
      source: { label: "Wikipedia — 2024 United States port strike", url: "https://en.wikipedia.org/wiki/2024_United_States_port_strike" },
      effects: { ports: { USSAV: { cap: 0, delay: 0 }, USNYC: { cap: 0, delay: 0 }, USHOU: { cap: 0, delay: 0 } }, uplift: { TPEC: 0.2 } },
      duration: { actual: 3, min: 2, mode: 7, max: 42 }, annualProb: 0.1 },
    { id: "ilwu-2014", kind: "historical", type: "strike", name: "US West Coast port slowdown",
      period: "Nov 2014 – Feb 2015", lat: 33.74, lng: -118.25, severity: 3,
      description: "A contract dispute between West Coast dockworkers and terminal employers slowed operations for about four months, with ships queuing outside LA/Long Beach.",
      source: { label: "Wikipedia — ILWU", url: "https://en.wikipedia.org/wiki/International_Longshore_and_Warehouse_Union" },
      effects: { ports: { USLAX: { cap: 0.5, delay: 10 } }, uplift: { TPWC: 0.3 } },
      duration: { actual: 100, min: 30, mode: 90, max: 150 }, annualProb: 0.08 },

    // ---------------- Hypothetical stress tests ----------------
    { id: "x-taiwan", kind: "hypothetical", type: "geopolitical", name: "Taiwan Strait closed to shipping",
      period: "Hypothetical", lat: 24.4, lng: 119.6, severity: 5,
      description: "Stress test: commercial traffic is barred from the Taiwan Strait. Services reroute east of Taiwan; insurance and rates rise across the Pacific.",
      effects: { closed: ["TWS"], ports: { TWKHH: { cap: 0, delay: 0 } }, uplift: { TPWC: 0.4, TPEC: 0.4, AE: 0.3, AM: 0.3, MX: 0.4 } },
      duration: { actual: 60, min: 14, mode: 60, max: 180 }, annualProb: 0.02 },
    { id: "x-malacca", kind: "hypothetical", type: "geopolitical", name: "Malacca Strait closed",
      period: "Hypothetical", lat: 2.6, lng: 101.2, severity: 5,
      description: "Stress test: the Malacca Strait is closed. Services divert through the Sunda Strait; Port Klang is cut off from the west.",
      effects: { closed: ["MAL"], uplift: { AE: 0.3, AM: 0.3, IE: 0.1 } },
      duration: { actual: 21, min: 7, mode: 21, max: 60 }, annualProb: 0.02 },
    { id: "x-hormuz", kind: "hypothetical", type: "geopolitical", name: "Strait of Hormuz closed",
      period: "Hypothetical", lat: 26.6, lng: 56.6, severity: 5,
      description: "Stress test: no container traffic through Hormuz, isolating Gulf ports such as Jebel Ali; fuel-driven rate rises worldwide. (Check Live conditions — PortWatch transit data may already show this.)",
      effects: { closed: ["HORMUZ"], uplift: { "*": 0.15 } },
      duration: { actual: 90, min: 14, mode: 90, max: 365 }, annualProb: 0.03 },
    { id: "x-rtm-cyber", kind: "hypothetical", type: "cyber", name: "Cyberattack on Rotterdam terminals",
      period: "Hypothetical", lat: 51.95, lng: 4.14, severity: 4,
      description: "Stress test inspired by the 2017 NotPetya attack that crippled a major carrier: terminal systems at Rotterdam go down and throughput collapses for days.",
      effects: { ports: { NLRTM: { cap: 0.2, delay: 5 } } },
      duration: { actual: 10, min: 3, mode: 10, max: 30 }, annualProb: 0.04 }
  ]
};
if (typeof module !== "undefined" && module.exports) module.exports = ATLAS_DATA;
