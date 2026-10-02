/*
 * seagraph.js — a compact maritime routing network for the Global Disruption Atlas.
 *
 * Ships don't sail great circles between ports: they follow sea lanes that thread a
 * handful of chokepoints (Suez, Bab-el-Mandeb, Malacca, Panama, Gibraltar...). This
 * file holds a hand-built waypoint graph of those lanes (87 waypoints, each
 * segment verified against country outlines by tests/landcheck.js), a library of major container
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
    BOHAI: { lat: 38.8, lng: 119.0 },            // Bohai Sea
    BOHS: { lat: 38.3, lng: 121.0 },             // Bohai Strait
    SHAN: { lat: 37.8, lng: 123.2 },             // off the Shandong cape
    YS: { lat: 35.0, lng: 123.0 },               // Yellow Sea
    ECS: { lat: 30.8, lng: 123.2 },              // East China Sea off the Yangtze
    ECS2: { lat: 32.0, lng: 127.5 },             // NE East China Sea
    KOREA: { lat: 34.0, lng: 128.6, choke: "chokepoint12", cname: "Korea Strait" },
    SOJ: { lat: 38.0, lng: 133.0 },              // Sea of Japan
    TSUG: { lat: 41.55, lng: 140.6, choke: "chokepoint13", cname: "Tsugaru Strait" },
    SJ: { lat: 30.0, lng: 132.0 },               // south of Kyushu
    KII: { lat: 33.2, lng: 135.2 },              // Kii Channel (Osaka Bay approach)
    ISE: { lat: 33.8, lng: 137.0 },              // off Ise Bay
    JPE: { lat: 34.3, lng: 141.5 },              // off Tokyo Bay
    TWS: { lat: 24.4, lng: 119.6, choke: "chokepoint11", cname: "Taiwan Strait" },
    TWE: { lat: 23.5, lng: 123.0 },              // east of Taiwan
    LUZON: { lat: 21.3, lng: 121.0, choke: "chokepoint14", cname: "Luzon Strait" },
    SCSN: { lat: 21.6, lng: 115.4 },             // northern South China Sea (off Hong Kong)
    PHW: { lat: 14.3, lng: 119.5 },              // west of Luzon (Manila approach)
    TONKS: { lat: 17.5, lng: 107.8 },            // mouth of the Gulf of Tonkin
    VNE2: { lat: 16.0, lng: 108.8 },             // off Da Nang
    VNE: { lat: 12.5, lng: 110.0 },              // off southern central Vietnam
    SCSS: { lat: 8.0, lng: 109.5 },              // southern South China Sea
    GOT: { lat: 9.5, lng: 102.5 },               // Gulf of Thailand
    CAMAU: { lat: 7.8, lng: 104.8 },             // south of Ca Mau
    SGP: { lat: 1.15, lng: 104.0 },              // Singapore Strait
    SGPW: { lat: 1.15, lng: 103.4 },             // western Singapore Strait
    MAL: { lat: 2.2, lng: 101.6, choke: "chokepoint5", cname: "Malacca Strait" },
    MALN: { lat: 5.6, lng: 98.6 },               // northern Malacca Strait
    ANDA: { lat: 6.5, lng: 95.4 },               // Andaman Sea exit, north of Aceh
    GASP: { lat: -2.5, lng: 107.1 },             // Gaspar Strait (Bangka–Belitung)
    KARIM: { lat: -1.5, lng: 108.6 },            // Karimata Strait
    JAVA: { lat: -5.4, lng: 106.6 },             // western Java Sea
    JAVA2: { lat: -6.0, lng: 112.5 },            // eastern Java Sea
    SUNDA: { lat: -6.0, lng: 105.8, choke: "chokepoint19", cname: "Sunda Strait" },
    LOMBOK: { lat: -8.9, lng: 115.8, choke: "chokepoint15", cname: "Lombok Strait" },
    SUMBS: { lat: -11.0, lng: 118.0 },           // south of Sumba
    LOMBOKN: { lat: -7.8, lng: 115.9 },          // north entrance of the Lombok Strait
    TIMOR: { lat: -11.5, lng: 123.5 },           // Timor Sea
    ARAF: { lat: -9.5, lng: 135.0 },             // Arafura Sea
    TORR: { lat: -10.6, lng: 142.2, choke: "chokepoint18", cname: "Torres Strait" },
    // Oceania
    CORW: { lat: -15.0, lng: 147.0 },            // Coral Sea, inside the reef route
    AUE2: { lat: -26.5, lng: 154.0 },            // off Brisbane
    NSW: { lat: -31.0, lng: 153.6 },             // off northern New South Wales
    AUE1: { lat: -34.1, lng: 151.9 },            // off Sydney
    BASSE: { lat: -38.0, lng: 150.5 },           // east of Bass Strait
    BASS: { lat: -39.5, lng: 145.0 },            // Bass Strait
    GAB: { lat: -36.5, lng: 135.0 },             // Great Australian Bight
    AUW: { lat: -35.5, lng: 114.5 },             // off Cape Leeuwin
    AUNW: { lat: -20.0, lng: 112.5 },            // off North West Cape
    NZN: { lat: -34.0, lng: 175.5 },             // north-east of North Island
    // Indian Ocean
    BOBN: { lat: 19.0, lng: 90.0 },              // northern Bay of Bengal
    BOBM: { lat: 13.0, lng: 81.5 },              // off Chennai
    SLE: { lat: 7.5, lng: 82.5 },                // east of Sri Lanka
    LKS: { lat: 5.3, lng: 80.5 },                // south of Sri Lanka
    COM: { lat: 7.3, lng: 77.3 },                // off Cape Comorin
    KER: { lat: 10.0, lng: 75.3 },               // off Kerala
    MUM: { lat: 18.5, lng: 71.6 },               // off Mumbai
    KUTCH: { lat: 21.5, lng: 68.5 },             // off the Gulf of Kutch / Karachi
    ARABC: { lat: 15.0, lng: 57.0 },             // central Arabian Sea
    HADD: { lat: 22.0, lng: 61.0 },              // off Ras al Hadd
    HORMUZ: { lat: 26.6, lng: 56.6, choke: "chokepoint6", cname: "Strait of Hormuz" },
    PG: { lat: 25.9, lng: 55.3 },                // Persian Gulf off Dubai
    GUAR: { lat: 12.0, lng: 52.0 },              // Guardafui Channel
    GOA: { lat: 12.2, lng: 47.0 },               // Gulf of Aden
    SOM: { lat: 2.0, lng: 49.0 },                // off Somalia
    EAF: { lat: -5.0, lng: 41.5 },               // off Mombasa / Dar es Salaam
    MOZ: { lat: -18.0, lng: 41.5 },              // Mozambique Channel
    DURO: { lat: -30.5, lng: 32.0 },             // off Durban
    IOC: { lat: -10.0, lng: 70.0 },              // central Indian Ocean
    IOW: { lat: -10.0, lng: 58.0 },              // western Indian Ocean
    MADS: { lat: -28.0, lng: 46.0 },             // south of Madagascar
    AGUL: { lat: -36.5, lng: 22.0 },             // off Cape Agulhas
    CAPE: { lat: -35.0, lng: 18.3, choke: "chokepoint7", cname: "Cape of Good Hope" },
    // Red Sea / Suez / Mediterranean / Black Sea approaches
    BAM: { lat: 12.6, lng: 43.35, choke: "chokepoint4", cname: "Bab el-Mandeb" },
    RSC: { lat: 20.0, lng: 38.5 },               // central Red Sea
    RSN: { lat: 27.5, lng: 34.4 },               // northern Red Sea
    GUBAL: { lat: 27.6, lng: 33.9 },             // Strait of Gubal
    GSZ1: { lat: 28.5, lng: 33.15 },             // Gulf of Suez (south)
    GSZ2: { lat: 29.3, lng: 32.7 },              // Gulf of Suez (north)
    SUEZS: { lat: 29.8, lng: 32.6 },             // Gulf of Suez
    SUEZ: { lat: 30.6, lng: 32.33, choke: "chokepoint1", cname: "Suez Canal" },
    PSAID: { lat: 31.6, lng: 32.35 },            // off Port Said
    MEDE: { lat: 34.0, lng: 26.0 },              // south of Crete
    KYTH: { lat: 35.9, lng: 23.4 },              // Kythira strait
    AEG: { lat: 38.5, lng: 25.0 },               // Aegean Sea
    DARD: { lat: 40.1, lng: 26.3 },              // Dardanelles
    MARM: { lat: 40.7, lng: 28.0 },              // Sea of Marmara
    MESS: { lat: 37.7, lng: 15.6 },              // south of the Strait of Messina
    MALTA: { lat: 35.4, lng: 15.0 },
    SIC: { lat: 37.4, lng: 11.6 },               // Strait of Sicily
    ALG: { lat: 37.4, lng: 3.0 },                // off Algiers
    BAL: { lat: 40.0, lng: 1.5 },                // Balearic Sea
    LIG: { lat: 43.5, lng: 8.8 },                // Ligurian Sea
    LIG2: { lat: 41.0, lng: 7.2 },               // west of Corsica
    ALB: { lat: 36.0, lng: -2.5 },               // Alboran Sea
    GIB: { lat: 35.95, lng: -5.55, choke: "chokepoint8", cname: "Strait of Gibraltar" },
    GIBW: { lat: 36.0, lng: -6.8 },
    // NE Atlantic / North Sea / Baltic
    STV: { lat: 36.8, lng: -9.8 },               // off Cape St Vincent
    FIN: { lat: 43.2, lng: -10.0 },              // off Finisterre
    USH: { lat: 48.6, lng: -5.8 },               // off Ushant
    CHAN: { lat: 50.0, lng: -2.5 },              // English Channel
    DOVER: { lat: 51.0, lng: 1.45, choke: "chokepoint9", cname: "Dover Strait" },
    NS: { lat: 52.0, lng: 3.4 },                 // southern North Sea
    NS2: { lat: 53.6, lng: 4.5 },
    GB: { lat: 54.0, lng: 7.8 },                 // German Bight
    JUTW: { lat: 56.5, lng: 7.5 },               // off western Jutland
    SKW: { lat: 57.6, lng: 7.8 },                // western Skagerrak
    SKAG: { lat: 58.0, lng: 10.2 },              // Skagerrak
    KATT: { lat: 57.3, lng: 11.4 },              // Kattegat
    ORES: { lat: 55.7, lng: 12.75, choke: "chokepoint10", cname: "Øresund" },
    BALT: { lat: 55.0, lng: 13.8 },              // south-western Baltic
    GDAN: { lat: 54.8, lng: 18.8 },              // Gulf of Gdańsk
    // Atlantic
    CAN: { lat: 27.0, lng: -19.0 },              // SW of the Canaries
    CVS: { lat: 12.0, lng: -22.0 },              // south-east of Cape Verde
    WAF: { lat: 4.0, lng: -12.0 },               // off Liberia
    GOG: { lat: -2.0, lng: 2.0 },                // Gulf of Guinea
    ANG: { lat: -15.0, lng: 9.0 },               // off Angola
    SWA: { lat: -28.0, lng: 13.5 },              // off Namibia
    ATLEQ: { lat: 2.0, lng: -25.0 },             // equatorial Atlantic
    BRNE: { lat: -5.0, lng: -33.5 },             // off Natal (Brazil's NE corner)
    NBR: { lat: 6.0, lng: -48.0 },               // off the Guianas
    TOBA: { lat: 12.0, lng: -60.3 },             // south of the Lesser Antilles
    BRE: { lat: -14.0, lng: -36.5 },             // off Salvador
    CFRIO: { lat: -23.5, lng: -41.5 },           // off Cabo Frio
    SANTO: { lat: -24.3, lng: -46.0 },           // off Santos
    RGO: { lat: -33.0, lng: -51.0 },             // off Rio Grande
    PLATA: { lat: -35.5, lng: -54.5 },           // mouth of the Río de la Plata
    MAG: { lat: -57.0, lng: -65.5 },             // Drake Passage / Cape Horn
    STATEN: { lat: -55.5, lng: -63.0 },          // east of Staten Island
    PATA: { lat: -48.0, lng: -63.5 },            // off Patagonia
    HORN: { lat: -57.0, lng: -70.0 },            // south of Cape Horn
    CHS: { lat: -45.0, lng: -77.0 },             // off southern Chile
    CHSS: { lat: -54.5, lng: -77.5 },            // off the southern Chilean fjords
    CHL: { lat: -33.5, lng: -72.5 },             // off Valparaíso / San Antonio
    PERU: { lat: -12.5, lng: -78.5 },            // off Callao
    PIURA: { lat: -6.5, lng: -82.0 },            // off northern Peru
    ECU: { lat: -2.0, lng: -82.0 },              // off Ecuador
    ATLM: { lat: 35.0, lng: -40.0 },             // mid-Atlantic
    ATLW: { lat: 27.5, lng: -73.0 },             // western Atlantic, NE of the Bahamas
    NYO: { lat: 40.2, lng: -72.8 },              // off New York
    CHES: { lat: 37.0, lng: -75.6 },             // off the Chesapeake
    HATT: { lat: 35.0, lng: -74.8 },             // off Cape Hatteras
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
    LZCO: { lat: 17.5, lng: -102.5 },            // off Lázaro Cárdenas
    PSE: { lat: 15.0, lng: -110.0 },             // eastern tropical Pacific
    MZOO: { lat: 18.7, lng: -104.6 },            // off Manzanillo
    CABO: { lat: 22.5, lng: -110.5 },            // off Cabo San Lucas
    BAJA: { lat: 28.0, lng: -116.0 },            // off Baja California
    LAO: { lat: 33.3, lng: -118.6 },             // off San Pedro Bay
    SFO: { lat: 37.6, lng: -123.2 },             // off the Golden Gate
    PCON: { lat: 33.9, lng: -121.0 },            // off Point Conception
    JDF: { lat: 48.3, lng: -125.5 },             // off the Strait of Juan de Fuca
    ORE: { lat: 44.0, lng: -125.8 },             // off Oregon
    CAPEM: { lat: 40.5, lng: -125.0 },           // off Cape Mendocino
    PRR: { lat: 54.0, lng: -131.5 },             // off Prince Rupert
    VIW: { lat: 50.0, lng: -128.8 },             // off north-west Vancouver Island
    PACE: { lat: 30.0, lng: -140.0 },            // NE Pacific
    NP1: { lat: 44.0, lng: 170.0 },              // North Pacific (west)
    NP2: { lat: 44.0, lng: -150.0 }              // North Pacific (east)
  };

  // ---- Sea edges (undirected). Every segment (and every port access leg) is checked
  // against the country outlines by tests/landcheck.js — no lane may cross land.
  var EDGES = [
    // East Asia
    ["BOHAI", "BOHS"], ["YS", "ECS"], ["YS", "ECS2"], ["ECS", "ECS2"], ["ECS2", "KOREA"], ["ECS2", "SJ"],
    ["KOREA", "SOJ"], ["SOJ", "TSUG"], ["TSUG", "NP1"],
    ["SJ", "KII"], ["KII", "ISE"], ["ISE", "JPE"], ["SJ", "JPE"], ["JPE", "NP1"], ["NP1", "NP2"], ["NP2", "LAO"], ["NP2", "PACE"], ["JPE", "PACE"],
    ["PACE", "BAJA"], ["PACE", "PSE"], ["PACE", "LAO"], ["PACE", "SFO"], ["NP2", "SFO"], ["NP2", "JDF"], ["NP1", "PRR"],
    ["ECS", "TWS"], ["ECS", "TWE"], ["TWE", "LUZON"], ["TWS", "SCSN"], ["LUZON", "SCSN"], ["TWE", "SJ"],
    ["SCSN", "SCSS"], ["SCSN", "PHW"], ["PHW", "SCSS"], ["SCSN", "VNE"], ["TONKS", "VNE2"], ["VNE2", "VNE"], ["VNE", "SCSS"],
    ["SCSS", "SGP"], ["SGP", "SGPW"], ["SGPW", "MAL"], ["MAL", "MALN"], ["MALN", "ANDA"],
    ["SGP", "GASP"], ["GASP", "JAVA"], ["JAVA", "SUNDA"], ["SGP", "KARIM"], ["KARIM", "SCSS"], ["KARIM", "JAVA"], ["JAVA", "JAVA2"],
    ["TIMOR", "ARAF"], ["ARAF", "TORR"], ["TORR", "CORW"], ["CORW", "AUE2"], ["AUE1", "BASSE"], ["BASSE", "BASS"],
    ["BASS", "GAB"], ["GAB", "AUW"], ["AUW", "SUNDA"], ["AUW", "MADS"], ["AUE1", "NZN"],
    // Indian Ocean
    ["ANDA", "LKS"], ["ANDA", "BOBN"], ["BOBN", "BOBM"], ["BOBM", "SLE"], ["SLE", "LKS"],
    ["LKS", "COM"], ["COM", "KER"], ["KER", "MUM"], ["MUM", "KUTCH"], ["KUTCH", "ARABC"], ["KUTCH", "HADD"],
    ["LKS", "ARABC"], ["LKS", "GUAR"], ["LKS", "IOC"], ["SUNDA", "IOC"],
    ["MUM", "ARABC"], ["MUM", "IOW"], ["ARABC", "GUAR"], ["GUAR", "GOA"], ["ARABC", "HADD"], ["HADD", "HORMUZ"], ["HORMUZ", "PG"],
    ["ARABC", "IOW"], ["IOC", "MADS"], ["LKS", "MADS"], ["SUNDA", "MADS"], ["IOW", "MADS"], ["MADS", "AGUL"], ["AGUL", "CAPE"],
    ["SOM", "GUAR"], ["SOM", "ARABC"], ["EAF", "SOM"], ["EAF", "IOW"], ["EAF", "MOZ"], ["MOZ", "DURO"], ["DURO", "AGUL"], ["DURO", "MADS"],
    // Red Sea / Med
    ["GOA", "BAM"], ["BAM", "RSC"], ["RSC", "RSN"], ["RSN", "GUBAL"], ["SUEZS", "SUEZ"], ["SUEZ", "PSAID"],
    ["PSAID", "MEDE"], ["MEDE", "KYTH"], ["MEDE", "MALTA"], ["KYTH", "MALTA"], ["KYTH", "AEG"], ["AEG", "DARD"], ["DARD", "MARM"],
    ["MESS", "MALTA"], ["MESS", "KYTH"], ["MALTA", "SIC"], ["SIC", "ALG"], ["ALG", "BAL"], ["BAL", "LIG2"], ["LIG2", "ALG"], ["LIG", "LIG2"],
    ["ALG", "ALB"], ["ALB", "GIB"], ["GIB", "GIBW"], ["GIBW", "STV"], ["GIBW", "CAN"],
    // NE Atlantic / North Sea / Baltic
    ["STV", "FIN"], ["FIN", "USH"], ["USH", "CHAN"], ["CHAN", "DOVER"], ["DOVER", "NS"], ["NS", "NS2"], ["NS2", "GB"],
    ["SKAG", "KATT"], ["KATT", "ORES"], ["ORES", "BALT"], ["BALT", "GDAN"],
    ["STV", "CAN"], ["FIN", "CAN"], ["FIN", "ATLM"], ["USH", "ATLM"], ["STV", "ATLM"],
    // Atlantic
    ["CAN", "CVS"], ["CVS", "WAF"], ["WAF", "GOG"], ["GOG", "ANG"], ["ANG", "SWA"], ["SWA", "CAPE"],
    ["CVS", "ATLEQ"], ["ATLEQ", "BRNE"], ["BRNE", "BRE"], ["BRE", "CFRIO"], ["CFRIO", "SANTO"], ["SANTO", "RGO"], ["RGO", "PLATA"],
    ["CAPE", "SANTO"], ["CAPE", "BRE"], ["PLATA", "CAPE"], ["CHS", "CHL"], ["CHL", "PERU"], ["ECU", "PMALA"],
    ["BRNE", "NBR"], ["NBR", "TOBA"], ["ATLEQ", "TOBA"], ["TOBA", "CARIB"], ["CVS", "CARIB"],
    ["ATLM", "ATLW"], ["ATLM", "NYO"], ["ATLW", "NYO"], ["ATLW", "SAVO"], ["ATLW", "FLN"], ["ATLW", "WIND"], ["ATLW", "HATT"],
    ["NYO", "CHES"], ["CHES", "HATT"], ["NYO", "HATT"], ["HATT", "SAVO"], ["SAVO", "FLN"], ["FLN", "FLM"], ["FLM", "FLS"], ["FLS", "GOM"], ["GOM", "HOUO"], ["GOM", "YUC"],
    ["YUC", "CARIB"], ["WIND", "CARIB"], ["CARIB", "COLON"], ["COLON", "PANAMA"], ["PANAMA", "BALBO"],
    // Eastern Pacific
    ["BALBO", "PMALA"], ["PMALA", "CRICA"], ["CRICA", "PCA"], ["PCA", "PSE"], ["PCA", "LZCO"], ["LZCO", "MZOO"], ["LZCO", "PSE"], ["PCA", "MZOO"], ["PSE", "MZOO"],
    ["MZOO", "CABO"], ["CABO", "BAJA"], ["BAJA", "LAO"], ["PSE", "CABO"],
    // coastal detours added after the automated land check
    ["BOHS", "SHAN"], ["SHAN", "YS"], ["PRR", "VIW"], ["VIW", "JDF"], ["JDF", "ORE"], ["ORE", "CAPEM"], ["CAPEM", "SFO"], ["SFO", "PCON"], ["PCON", "LAO"], ["SCSS", "CAMAU"], ["CAMAU", "GOT"], ["JAVA2", "LOMBOKN"], ["LOMBOKN", "LOMBOK"], ["LOMBOK", "SUMBS"], ["SUMBS", "TIMOR"], ["AUE2", "NSW"], ["NSW", "AUE1"], ["AUW", "AUNW"], ["AUNW", "LOMBOK"], ["GUBAL", "GSZ1"], ["GSZ1", "GSZ2"], ["GSZ2", "SUEZS"], ["GB", "JUTW"], ["JUTW", "SKW"], ["SKW", "SKAG"], ["PLATA", "PATA"], ["PATA", "STATEN"], ["STATEN", "MAG"], ["MAG", "HORN"], ["HORN", "CHSS"], ["CHSS", "CHS"], ["PERU", "PIURA"], ["PIURA", "ECU"]
  ];

  // ---- Port library, keyed by UN/LOCODE. `sea` = the waypoint(s) the port opens onto.
  // `teu` = approximate annual container throughput (2022, rounded) where well known.
  // `accessNm` widens the land-check tolerance for ports reached up a river or estuary.
  var PORTS = {
    // China / East Asia
    CNSHA: { name: "Shanghai", lat: 31.23, lng: 121.47, sea: ["ECS"], teu: 47300000, accessNm: 80 },
    CNNGB: { name: "Ningbo-Zhoushan", lat: 29.87, lng: 121.54, sea: ["ECS"], teu: 33350000, accessNm: 80 },
    CNYTN: { name: "Yantian (Shenzhen)", lat: 22.57, lng: 114.27, sea: ["SCSN"] },
    CNNSA: { name: "Nansha (Guangzhou)", lat: 22.75, lng: 113.6, sea: ["SCSN"], accessNm: 80 },
    HKHKG: { name: "Hong Kong", lat: 22.29, lng: 114.17, sea: ["SCSN"] },
    CNXMN: { name: "Xiamen", lat: 24.45, lng: 118.08, sea: ["TWS"] },
    CNTAO: { name: "Qingdao", lat: 36.07, lng: 120.38, sea: ["YS"] },
    CNTXG: { name: "Tianjin", lat: 38.98, lng: 117.78, sea: ["BOHAI"] },
    CNDLC: { name: "Dalian", lat: 38.92, lng: 121.64, sea: ["BOHS"] },
    KRPUS: { name: "Busan", lat: 35.10, lng: 129.04, sea: ["KOREA"], teu: 22100000 },
    KRINC: { name: "Incheon", lat: 37.45, lng: 126.6, sea: ["YS"] },
    JPTYO: { name: "Tokyo", lat: 35.62, lng: 139.79, sea: ["JPE"], accessNm: 70 },
    JPYOK: { name: "Yokohama", lat: 35.44, lng: 139.65, sea: ["JPE"], accessNm: 70 },
    JPNGO: { name: "Nagoya", lat: 35.05, lng: 136.85, sea: ["ISE"], accessNm: 80 },
    JPUKB: { name: "Kobe", lat: 34.68, lng: 135.2, sea: ["KII"], accessNm: 80 },
    TWKHH: { name: "Kaohsiung", lat: 22.61, lng: 120.28, sea: ["TWS", "LUZON"] },
    TWKEL: { name: "Keelung (Taipei)", lat: 25.15, lng: 121.75, sea: ["TWE"] },
    // South-East Asia
    PHMNL: { name: "Manila", lat: 14.6, lng: 120.95, sea: ["PHW"] },
    VNHPH: { name: "Haiphong", lat: 20.85, lng: 106.7, sea: ["TONKS"] },
    VNCMT: { name: "Cai Mep", lat: 10.55, lng: 107.03, sea: ["SCSS"] },
    THLCH: { name: "Laem Chabang", lat: 13.08, lng: 100.88, sea: ["GOT"] },
    SGSIN: { name: "Singapore", lat: 1.26, lng: 103.84, sea: ["SGP"], teu: 37300000 },
    MYTPP: { name: "Tanjung Pelepas", lat: 1.36, lng: 103.55, sea: ["SGPW"] },
    MYPKG: { name: "Port Klang", lat: 3.0, lng: 101.39, sea: ["MAL"] },
    IDJKT: { name: "Jakarta (Tanjung Priok)", lat: -6.1, lng: 106.88, sea: ["JAVA"] },
    IDSUB: { name: "Surabaya", lat: -7.2, lng: 112.73, sea: ["JAVA2"] },
    // South Asia / Middle East / Africa
    LKCMB: { name: "Colombo", lat: 6.95, lng: 79.84, sea: ["LKS", "COM"] },
    INMAA: { name: "Chennai", lat: 13.08, lng: 80.29, sea: ["BOBM"] },
    BDCGP: { name: "Chittagong", lat: 22.31, lng: 91.8, sea: ["BOBN"], accessNm: 80 },
    INNSA: { name: "Nhava Sheva (Mumbai)", lat: 18.95, lng: 72.95, sea: ["MUM"], teu: 6000000 },
    INMUN: { name: "Mundra", lat: 22.75, lng: 69.7, sea: ["KUTCH"] },
    PKKHI: { name: "Karachi", lat: 24.85, lng: 66.98, sea: ["KUTCH"] },
    AEJEA: { name: "Jebel Ali (Dubai)", lat: 25.01, lng: 55.06, sea: ["PG"], teu: 14000000 },
    OMSLL: { name: "Salalah", lat: 16.95, lng: 54.0, sea: ["ARABC"] },
    SAJED: { name: "Jeddah", lat: 21.48, lng: 39.17, sea: ["RSC"] },
    DJJIB: { name: "Djibouti", lat: 11.6, lng: 43.15, sea: ["BAM", "GOA"] },
    EGPSD: { name: "Port Said", lat: 31.26, lng: 32.30, sea: ["PSAID"] },
    KEMBA: { name: "Mombasa", lat: -4.07, lng: 39.67, sea: ["EAF"] },
    TZDAR: { name: "Dar es Salaam", lat: -6.82, lng: 39.3, sea: ["EAF"] },
    ZADUR: { name: "Durban", lat: -29.87, lng: 31.03, sea: ["DURO"] },
    ZACPT: { name: "Cape Town", lat: -33.91, lng: 18.43, sea: ["CAPE"] },
    NGLOS: { name: "Lagos (Apapa)", lat: 6.43, lng: 3.4, sea: ["GOG"] },
    TGLFW: { name: "Lomé", lat: 6.13, lng: 1.28, sea: ["GOG"] },
    GHTEM: { name: "Tema", lat: 5.62, lng: 0.0, sea: ["GOG"] },
    CIABJ: { name: "Abidjan", lat: 5.25, lng: -4.0, sea: ["GOG"] },
    SNDKR: { name: "Dakar", lat: 14.68, lng: -17.43, sea: ["CVS"] },
    // Europe
    GRPIR: { name: "Piraeus", lat: 37.94, lng: 23.63, sea: ["KYTH"], teu: 5000000, accessNm: 80 },
    TRAMR: { name: "Ambarli (Istanbul)", lat: 40.97, lng: 28.68, sea: ["MARM"] },
    ITGIT: { name: "Gioia Tauro", lat: 38.45, lng: 15.9, sea: ["MESS"] },
    ITGOA: { name: "Genoa", lat: 44.4, lng: 8.9, sea: ["LIG"] },
    FRMRS: { name: "Marseille-Fos", lat: 43.4, lng: 4.9, sea: ["BAL"] },
    ESBCN: { name: "Barcelona", lat: 41.35, lng: 2.17, sea: ["BAL"] },
    ESVLC: { name: "Valencia", lat: 39.44, lng: -0.32, sea: ["ALG", "BAL"] },
    MAPTM: { name: "Tanger Med", lat: 35.89, lng: -5.50, sea: ["GIB"] },
    ESALG: { name: "Algeciras", lat: 36.13, lng: -5.44, sea: ["GIB"] },
    PTSIN: { name: "Sines", lat: 37.95, lng: -8.87, sea: ["STV"] },
    FRLEH: { name: "Le Havre", lat: 49.48, lng: 0.11, sea: ["CHAN"] },
    GBSOU: { name: "Southampton", lat: 50.9, lng: -1.4, sea: ["CHAN"] },
    GBLGP: { name: "London Gateway", lat: 51.5, lng: 0.47, sea: ["DOVER"], accessNm: 70 },
    GBFXT: { name: "Felixstowe", lat: 51.95, lng: 1.32, sea: ["NS", "DOVER"] },
    NLRTM: { name: "Rotterdam", lat: 51.95, lng: 4.14, sea: ["NS"], teu: 14500000 },
    BEANR: { name: "Antwerp-Bruges", lat: 51.27, lng: 4.33, sea: ["NS"], accessNm: 80 },
    DEBRV: { name: "Bremerhaven", lat: 53.55, lng: 8.55, sea: ["GB"] },
    DEHAM: { name: "Hamburg", lat: 53.54, lng: 9.97, sea: ["GB"], teu: 8300000, accessNm: 100 },
    PLGDN: { name: "Gdańsk", lat: 54.4, lng: 18.67, sea: ["GDAN"] },
    // Americas
    USNYC: { name: "New York / New Jersey", lat: 40.67, lng: -74.05, sea: ["NYO"] },
    USBAL: { name: "Baltimore", lat: 39.25, lng: -76.58, sea: ["CHES"], accessNm: 170 },
    USORF: { name: "Norfolk", lat: 36.95, lng: -76.33, sea: ["CHES"] },
    USCHS: { name: "Charleston", lat: 32.78, lng: -79.92, sea: ["SAVO"] },
    USSAV: { name: "Savannah", lat: 32.08, lng: -81.09, sea: ["SAVO"] },
    USMIA: { name: "Miami", lat: 25.77, lng: -80.17, sea: ["FLM"] },
    USMOB: { name: "Mobile", lat: 30.7, lng: -88.04, sea: ["GOM"] },
    USMSY: { name: "New Orleans", lat: 29.95, lng: -90.06, sea: ["GOM"], accessNm: 120 },
    USHOU: { name: "Houston", lat: 29.73, lng: -95.27, sea: ["HOUO"], accessNm: 80 },
    BSFPO: { name: "Freeport (Bahamas)", lat: 26.5, lng: -78.77, sea: ["FLN"] },
    JMKIN: { name: "Kingston", lat: 17.95, lng: -76.8, sea: ["CARIB"] },
    COCTG: { name: "Cartagena (Colombia)", lat: 10.4, lng: -75.53, sea: ["CARIB"] },
    PAMIT: { name: "Manzanillo / Colón (Panama)", lat: 9.36, lng: -79.88, sea: ["COLON"] },
    PABLB: { name: "Balboa (Panama)", lat: 8.95, lng: -79.57, sea: ["BALBO"] },
    BRSSZ: { name: "Santos", lat: -23.96, lng: -46.33, sea: ["SANTO"], teu: 5000000 },
    BRRIG: { name: "Rio Grande", lat: -32.1, lng: -52.1, sea: ["RGO"] },
    UYMVD: { name: "Montevideo", lat: -34.9, lng: -56.2, sea: ["PLATA"] },
    ARBUE: { name: "Buenos Aires", lat: -34.6, lng: -58.37, sea: ["PLATA"], accessNm: 160 },
    CLSAI: { name: "San Antonio (Chile)", lat: -33.58, lng: -71.62, sea: ["CHL"] },
    PECLL: { name: "Callao", lat: -12.05, lng: -77.15, sea: ["PERU"] },
    MXLZC: { name: "Lázaro Cárdenas", lat: 17.93, lng: -102.18, sea: ["LZCO"] },
    MXZLO: { name: "Manzanillo (Mexico)", lat: 19.05, lng: -104.32, sea: ["MZOO"] },
    USLAX: { name: "Los Angeles / Long Beach", lat: 33.74, lng: -118.25, sea: ["LAO"], teu: 19000000 },
    USOAK: { name: "Oakland", lat: 37.8, lng: -122.3, sea: ["SFO"] },
    USSEA: { name: "Seattle / Tacoma", lat: 47.6, lng: -122.35, sea: ["JDF"], accessNm: 170 },
    CAVAN: { name: "Vancouver", lat: 49.29, lng: -123.1, sea: ["JDF"], accessNm: 170 },
    CAPRR: { name: "Prince Rupert", lat: 54.3, lng: -130.3, sea: ["PRR"] },
    // Oceania
    AUBNE: { name: "Brisbane", lat: -27.4, lng: 153.15, sea: ["AUE2"] },
    AUSYD: { name: "Sydney (Port Botany)", lat: -33.97, lng: 151.2, sea: ["AUE1"] },
    AUMEL: { name: "Melbourne", lat: -37.85, lng: 144.9, sea: ["BASS"], accessNm: 90 },
    AUFRE: { name: "Fremantle", lat: -32.05, lng: 115.74, sea: ["AUW"] },
    NZAKL: { name: "Auckland", lat: -36.84, lng: 174.77, sea: ["NZN"] }
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
