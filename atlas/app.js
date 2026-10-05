/*
 * Global Disruption Atlas — UI. Everything quantitative lives in engine/*.js (pure,
 * unit-tested); this file turns the engine's results into the globe, the 2D map, the
 * KPIs, charts and tables, and exposes a small read-only API to the tutorial.
 */
(() => {
  "use strict";
  const APP_VERSION = "5.1.0";

  const D = ATLAS_DATA, Sea = AtlasSea, M = AtlasModel, Dy = AtlasDynamics;
  const SIG = typeof ATLAS_SIGNALS !== "undefined" ? ATLAS_SIGNALS : null;
  // Live conditions and hazard alerts depend on which ports and sites the current network uses,
  // so they're rebuilt whenever the network changes (refreshDynamicEvents).
  let LIVE = null, ALERTS = [], ALL_EVENTS = D.events.slice(), evById = {}, dynKey = null;
  D.events.forEach(e => { evById[e.id] = e; });
  const liveHazards = () => SIG ? (SIG.disruptions || []).concat(SIG.hazards || []) : [];
  const LEVER_BOOL = ["controlTower", "dualSource", "airBridge", "gateways", "rateHedge"];

  // Chart palette — CSS tokens --s1..--s3, validated per theme (dataviz validate_palette.js,
  // all pairs: dark on #0c1220, light on #ffffff; light aqua relies on direct labels + table view).
  const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
  const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };
  const COLORS = {
    port: "#3fd0ff", warehouse: "#2dd4bf", factory: "#ffb84f", altsupplier: "#c98bff", hazard: "#e87ba4", supplier: "#9085e9",
    lane: "rgba(63,208,255,0.85)", idle: "rgba(127,156,179,0.35)", reroute: "#7cff8a", squeezed: "#ffa94d", cut: "rgba(255,77,94,0.75)",
    inland: "rgba(45,212,191,0.7)"
  };
  const TYPE_RGB = { weather: [79, 163, 255], strike: [255, 207, 79], geopolitical: [255, 92, 122], accident: [255, 140, 60], pandemic: [201, 139, 255], congestion: [255, 169, 77], cyber: [124, 255, 138], live: [63, 208, 255] };

  // ------------------------------------------------------------------ state
  const DEFAULT_ASSUME = {
    valuePerTeu: D.defaults.valuePerTeu, lostMarginPerTeu: D.defaults.lostMarginPerTeu, carryingRatePct: D.defaults.carryingRatePct,
    holdingRatePct: D.defaults.holdingRatePct, speedKn: D.defaults.speedKn, extraUpliftPct: 0,
    reactionDays: D.defaults.reactionDays, portHeadroomPct: Math.round(D.defaults.portHeadroom * 100), chokeHeadroomPct: Math.round(D.defaults.chokeHeadroom * 100),
    rebuildRatePct: Math.round(D.defaults.rebuildRate * 100)
  };
  const state = {
    eventIds: new Set(), fromLive: false, duration: null, tab: "live",
    levers: { buffer: 0, bufferScope: "all", dualSource: false, airBridge: false, gateways: false, rateHedge: false, controlTower: false },
    products: {}, // per-family overrides {id: {valuePerTeu, lostSaleCostPerTeu, fillTarget, air, critical}}
    assume: Object.assign({}, DEFAULT_ASSUME),
    networkSource: "sample", customNet: null, customRaw: { nodes: null, lanes: null },
    projection: "3d",
    toggles: { sea: true, inland: true, idle: false, nodes: true, suppliers: true, chokes: true, hazards: true, labels: false, borders: true },
    customEvents: [], // events the user described in words (v5.1)
    chokeSel: null, laneQ: "", laneAffectedOnly: false,
    result: null, mc: null, mcKey: null, portfolio: null, portfolioKey: null, opt: null, optKey: null,
    risk: { source: "assumed", climate: "today", correlated: true }, worst: null
  };
  // Event counters the tutorial watches ("has the user done X since this step opened?").
  const flags = {};
  function bump(k) { flags[k] = (flags[k] || 0) + 1; }

  const el = id => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function fmtMoney(n, signed) {
    const s = n < 0 ? "−" : signed ? "+" : "";
    const a = Math.abs(n);
    if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
    if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(0) + "k";
    return s + "$" + Math.round(a);
  }
  const fmtInt = n => Math.round(n).toLocaleString("en-US");
  const fmtDays = d => (d == null ? "—" : d >= 100 ? Math.round(d) + " d" : d.toFixed(1).replace(/\.0$/, "") + " d");

  el("app-version").textContent = "v" + APP_VERSION;
  el("footer-version").textContent = "v" + APP_VERSION;

  // ------------------------------------------------------------------ network
  function currentNet() { return state.networkSource === "custom" && state.customNet ? state.customNet : D.network; }
  function portRec(code, net) { return (net && net.ports && net.ports[code]) || Sea.PORTS[code] || null; }
  function nodeCoord(id, net) {
    net = net || currentNet();
    const f = net.factories.find(x => x.id === id); if (f) return f;
    const d = net.dcs.find(x => x.id === id); if (d) return d;
    return portRec(id, net);
  }

  // ------------------------------------------------------------------ compute
  function activeEvents() { return ALL_EVENTS.filter(e => state.eventIds.has(e.id)); }
  function refreshDynamicEvents(force) {
    const net = currentNet(), key = state.networkSource + "|" + (state.customNet ? state.customNet.name + state.customNet.factories.length + state.customNet.services.length : "");
    if (!force && key === dynKey) return;
    dynKey = key;
    const ports = {}; AtlasAlerts.networkPorts(net).forEach(p => { ports[p.code] = 1; });
    LIVE = SIG ? M.liveEvent(SIG, { ports }) : null;
    ALERTS = SIG ? AtlasAlerts.build(SIG, net, D.hazardTemplates) : [];
    ALL_EVENTS = (LIVE ? [LIVE] : []).concat(ALERTS, D.events, state.customEvents);
    evById = {}; ALL_EVENTS.forEach(e => { evById[e.id] = e; });
    [...state.eventIds].forEach(id => { if (!evById[id]) state.eventIds.delete(id); }); // e.g. an alert not near the new network
    el("from-live-wrap").hidden = !LIVE;
  }
  function overrides() {
    const a = state.assume;
    const o = {
      valuePerTeu: +a.valuePerTeu, lostMarginPerTeu: +a.lostMarginPerTeu, carryingRatePct: +a.carryingRatePct,
      holdingRatePct: +a.holdingRatePct, speedKn: +a.speedKn, extraUplift: (+a.extraUpliftPct || 0) / 100,
      reactionDays: +a.reactionDays, portHeadroom: (+a.portHeadroomPct) / 100, chokeHeadroom: (+a.chokeHeadroomPct) / 100, rebuildRate: (+a.rebuildRatePct) / 100
    };
    o.products = state.products;
    if (state.fromLive && LIVE) o.baseEvents = [LIVE];
    if (state.duration) o.duration = state.duration;
    return o;
  }
  function effectiveDuration() {
    const evs = activeEvents();
    if (state.duration) return state.duration;
    return evs.length ? Math.round(M.eventsDuration(evs, "actual")) : 0;
  }
  function scenarioKey() {
    return JSON.stringify([[...state.eventIds].sort(), state.fromLive, effectiveDuration(), state.levers, state.assume, state.products, state.networkSource, state.customNet ? state.customNet.name : ""]);
  }

  function compute() {
    const net = currentNet();
    const evs = activeEvents();
    const o = overrides();
    if (!o.duration) o.duration = Math.max(1, effectiveDuration());
    let res;
    try {
      res = Dy.analyse(D, net, evs, state.levers, o); // v3: time-phased simulation
    } catch (err) {
      console.error(err);
      res = null;
    }
    state.result = res;
    return res;
  }

  // ------------------------------------------------------------------ globe
  const COUNTRY_FEATURES = (typeof COUNTRIES_GEOJSON !== "undefined" && COUNTRIES_GEOJSON.features) || [];
  const world = Globe()(el("globe"))
    .globeImageUrl("vendor/img/earth-blue-marble.jpg")
    .bumpImageUrl("vendor/img/earth-topology.png")
    .backgroundImageUrl("vendor/img/night-sky.png")
    .atmosphereColor("#3fd0ff").atmosphereAltitude(0.16)
    .polygonCapColor(() => "rgba(0,0,0,0)").polygonSideColor(() => "rgba(0,0,0,0)")
    .polygonStrokeColor(() => "rgba(127,156,179,0.45)").polygonAltitude(0.003)
    .polygonLabel(d => `<div class="gtip"><b>${esc(d.properties.name)}</b></div>`)
    .pathPoints("pts").pathPointLat(p => p[0]).pathPointLng(p => p[1]).pathPointAlt(0.004)
    .pathColor(d => d.color).pathStroke(d => d.width).pathResolution(1.5)
    .pathDashLength(d => d.dash ? 0.012 : 1).pathDashGap(d => d.dash ? 0.008 : 0)
    .pathDashAnimateTime(d => d.animate ? 60000 : 0)
    .pathTransitionDuration(0)
    .pathLabel(d => d.tip)
    .onPathClick(d => d.svc && showInfo({ kind: "service", svc: d.svc }))
    .pointAltitude(d => d.kind === "choke" ? 0.01 : 0.008)
    .pointRadius(d => d.r).pointColor(d => d.color).pointLabel(d => d.tip).pointsMerge(false)
    .onPointClick(d => showInfo(d.info))
    .ringColor(d => t => `rgba(${d.rgb[0]},${d.rgb[1]},${d.rgb[2]},${Math.max(0, 1 - t)})`)
    .ringMaxRadius(d => 2 + d.severity * 0.8).ringPropagationSpeed(d => 1 + d.severity * 0.3)
    .ringRepeatPeriod(d => Math.max(600, 2400 - d.severity * 300))
    .labelText(d => d.text).labelSize(d => d.size || 0.45).labelColor(d => d.color || "rgba(220,232,240,0.85)")
    .labelDotRadius(0).labelAltitude(0.012).labelResolution(2)
    .onGlobeReady(() => el("loading").classList.add("hidden"));
  world.pointOfView({ lat: 22, lng: 60, altitude: 2.4 }, 0);
  const controls = world.controls();
  controls.autoRotate = true; controls.autoRotateSpeed = 0.25; controls.enableDamping = true;
  controls.addEventListener("start", () => bump("globe-move"));

  el("rotate-speed").addEventListener("input", e => {
    const v = parseFloat(e.target.value);
    controls.autoRotateSpeed = v; controls.autoRotate = v > 0 && state.projection === "3d";
    el("rotate-speed-val").textContent = v.toFixed(2);
  });
  function resize() { const w = el("globe-wrap"); world.width(w.clientWidth).height(w.clientHeight); resizeMap2D(); }
  window.addEventListener("resize", resize);

  // ------------------------------------------------------------------ map layer data
  function sameRoute(a, b) { return a && b && a.via && b.via && a.via.join(">") === b.via.join(">"); }
  function svcFlows(sol) {
    const f = {};
    sol.paths.forEach(pt => { if (!pt.short && pt.service) f[pt.service.id] = (f[pt.service.id] || 0) + pt.flow; });
    return f;
  }
  function legFlows(sol) {
    const f = {};
    sol.paths.forEach(pt => {
      if (pt.short) return;
      pt.legs.forEach(l => { if (l.kind === "export" || l.kind === "import" || l.kind === "direct") { const k = l.from + ">" + l.to; f[k] = f[k] || { from: l.from, to: l.to, mode: l.mode, flow: 0, days: l.days }; f[k].flow += pt.flow; } });
    });
    return Object.values(f);
  }
  function serviceStatus(sv, base) {
    if (!sv.ok) return "cut";
    if (base && !sameRoute(sv.route, base.route)) return "reroute";
    if (base && (sv.cap < base.cap - 1e-6 || sv.days > base.days + 0.25)) return "squeezed";
    return "normal";
  }
  const widthFor = flow => 0.6 + Math.min(3.4, Math.sqrt(flow / 40));

  function buildLayers() {
    const res = state.result, net = currentNet();
    const out = { paths: [], points: [], rings: [], labels: [] };
    if (!res) return out;
    const sol = res.prep.dis, base = res.prep.base;
    const flowsNow = svcFlows(sol);
    const baseById = {}; base.services.forEach(s => { baseById[s.id] = s; });

    if (state.toggles.sea) {
      sol.services.forEach(sv => {
        const b = baseById[sv.id], status = serviceStatus(sv, b), flow = flowsNow[sv.id] || 0;
        const svcName = `${portName(sv.from)} → ${portName(sv.to)}`;
        if (status === "cut" || status === "reroute") {
          const oldR = b && b.route && b.route.ok ? b.route : null;
          if (oldR) out.paths.push({ pts: oldR.path, color: COLORS.cut, width: 0.7, dash: true, animate: false, svc: sv, tip: `<div class="gtip"><b>${esc(svcName)}</b><br>Usual route ${status === "cut" ? "cut" : "abandoned"}</div>` });
        }
        if (status === "cut") return;
        if (flow < 0.5 && !state.toggles.idle) return;
        const color = flow < 0.5 ? COLORS.idle : status === "reroute" ? COLORS.reroute : status === "squeezed" ? COLORS.squeezed : COLORS.lane;
        out.paths.push({
          pts: sv.route.path, color, width: flow < 0.5 ? 0.5 : widthFor(flow), dash: flow >= 0.5, animate: flow >= 0.5, svc: sv,
          tip: `<div class="gtip"><b>${esc(svcName)}</b><br>${esc(D.trades[sv.trade] || sv.trade || "")}<br>${fmtInt(flow)} TEU/wk · ${sv.days.toFixed(1)} days${status === "reroute" ? "<br><span style='color:#7cff8a'>Rerouted</span>" : status === "squeezed" ? "<br><span style='color:#ffa94d'>Squeezed / delayed</span>" : ""}</div>`
        });
      });
    }
    if (state.toggles.inland) {
      legFlows(sol).forEach(l => {
        const a = nodeCoord(l.from, net), b = nodeCoord(l.to, net);
        if (!a || !b) return;
        out.paths.push({ pts: [[a.lat, a.lng], [b.lat, b.lng]], color: COLORS.inland, width: Math.max(0.4, widthFor(l.flow) * 0.6), dash: false, animate: false,
          tip: `<div class="gtip"><b>${esc(nodeName(l.from))} → ${esc(nodeName(l.to))}</b><br>${esc(l.mode || "inland")} · ${l.days} d · ${fmtInt(l.flow)} TEU/wk</div>` });
      });
    }
    if (state.toggles.nodes) {
      const standbyUsed = new Set(sol.paths.filter(p => p.standby && p.flow > 0.5 && !p.short).map(p => p.factory));
      const outFlow = {}; sol.paths.forEach(p => { if (!p.short && p.factory) outFlow[p.factory] = (outFlow[p.factory] || 0) + p.flow; });
      net.factories.forEach(f => {
        const active = standbyUsed.has(f.id);
        if (f.cap === 0 && !active && !(f.standby)) return;
        out.points.push({ lat: f.lat, lng: f.lng, r: active ? 0.42 : 0.32, color: active ? COLORS.altsupplier : f.cap === 0 ? "rgba(201,139,255,0.35)" : COLORS.factory,
          tip: `<div class="gtip"><b>${esc(f.name)}</b><br>Factory · ${fmtInt(outFlow[f.id] || 0)} TEU/wk shipped${active ? "<br>Standby source activated" : f.cap === 0 ? "<br>Standby (not active)" : ""}</div>`,
          info: { kind: "factory", id: f.id }, kind: "factory", name: f.name });
      });
      const usedPorts = new Set();
      (net.services || []).forEach(s => { usedPorts.add(s.from); usedPorts.add(s.to); });
      usedPorts.forEach(code => {
        const p = portRec(code, net); if (!p) return;
        const pc = res.prep.cond.ports[code];
        const hit = pc && (pc.cap < 1 || pc.delay > 0);
        const lp = portLive(code), ls = portStatus(lp);
        out.points.push({ lat: p.lat, lng: p.lng, r: 0.36, color: hit ? STATUS.critical : ls.cls === "critical" ? STATUS.serious : ls.cls === "warning" ? STATUS.warning : COLORS.port,
          tip: `<div class="gtip"><b>${esc(p.name)}</b> <span class="mut">${esc(code)}</span><br>Port${lp && lp.ratio != null ? `<br>Container calls ${Math.round(lp.ratio * 100)}% of normal (last 14 days)` : ""}${hit ? `<br>Scenario: capacity ${Math.round(pc.cap * 100)}%${pc.delay ? `, +${pc.delay} d dwell` : ""}` : ""}</div>`,
          info: { kind: "port", id: code }, kind: "port", name: p.name });
      });
      const dcRes = {}; res.dcs.forEach(d => { dcRes[d.id] = d; });
      net.dcs.forEach(d => {
        const r = dcRes[d.id], short = r && r.tts !== null && activeEvents().length;
        out.points.push({ lat: d.lat, lng: d.lng, r: 0.42, color: short ? STATUS.critical : COLORS.warehouse,
          tip: `<div class="gtip"><b>${esc(d.name)}</b><br>DC · ${fmtInt(d.demand)} TEU/wk${short ? `<br>Runs short on day ${r.tts}` : ""}</div>`,
          info: { kind: "dc", id: d.id }, kind: "dc", name: d.name });
      });
      if (state.toggles.labels) {
        net.factories.forEach(f => { if (f.cap > 0 || standbyUsed.has(f.id)) out.labels.push({ lat: f.lat, lng: f.lng, text: f.name, color: COLORS.factory, size: 0.38 }); });
        net.dcs.forEach(d => out.labels.push({ lat: d.lat, lng: d.lng, text: d.name, color: COLORS.warehouse, size: 0.42 }));
        usedPorts.forEach(code => { const p = portRec(code, net); if (p) out.labels.push({ lat: p.lat, lng: p.lng, text: p.name, color: COLORS.port, size: 0.38 }); });
      }
    }
    if (state.toggles.suppliers && net.suppliers && net.suppliers.length) {
      const avail = M.effectiveSupply(net, res.prep.cond.supply, res.prep.cond.suppliers || {}).suppliers;
      const byId = {}; net.suppliers.forEach(sp => { byId[sp.id] = sp; });
      net.suppliers.forEach(sp => {
        const a = avail[sp.id] == null ? 1 : avail[sp.id], hit = a < 0.999;
        out.points.push({ lat: sp.lat, lng: sp.lng, r: 0.34, color: hit ? STATUS.critical : COLORS.supplier, kind: "supplier",
          tip: `<div class="gtip"><b>${esc(sp.name)}</b><br>Tier-${sp.tier || 2} supplier${sp.what ? " · " + esc(sp.what) : ""}${hit ? `<br>Output ${Math.round(a * 100)}% in this scenario` : ""}</div>`, info: { kind: "supplier", id: sp.id } });
        Object.keys(sp.feeds || {}).forEach(tid => {
          const t = byId[tid] || net.factories.find(f => f.id === tid); if (!t) return;
          out.paths.push({ pts: [[sp.lat, sp.lng], [t.lat, t.lng]], color: hit ? "rgba(208,59,59,0.6)" : "rgba(144,133,233,0.55)", width: 0.4 + sp.feeds[tid] * 0.8, dash: true, animate: false,
            tip: `<div class="gtip">${esc(sp.name)} → ${esc(t.name)}<br>${Math.round(sp.feeds[tid] * 100)}% of its output needs these parts</div>` });
        });
      });
    }
    if (state.toggles.chokes) {
      const exp = {}; (res.exposure || []).forEach(x => { exp[x.wp] = x; });
      Object.values(Sea.CHOKES).forEach(c => {
        const live = chokeLive(c.wp), st = chokeStatus(live), closedNow = res.prep.cond.closed[c.wp];
        const color = closedNow ? STATUS.critical : st.color;
        out.points.push({ lat: c.lat, lng: c.lng, r: 0.5, color, kind: "choke",
          tip: `<div class="gtip"><b>${esc(c.name)}</b><br>${live ? `Container transits ${Math.round(live.ratio * 100)}% of normal (${esc(live.asOf)})` : "No live data"}${exp[c.wp] ? `<br>${Math.round(exp[c.wp].share * 100)}% of your flow passes here` : ""}${closedNow ? "<br><b>Closed in this scenario</b>" : ""}</div>`,
          info: { kind: "choke", id: c.wp } });
        if (closedNow || (live && live.ratio < 0.85) || exp[c.wp]) out.labels.push({ lat: c.lat, lng: c.lng, text: c.name, color: closedNow ? "#ff8a95" : "rgba(220,232,240,0.7)", size: 0.36 });
      });
    }
    if (state.toggles.hazards && SIG) {
      liveHazards().forEach((h, i) => {
        out.points.push({ lat: h.lat, lng: h.lng, r: 0.28, color: COLORS.hazard, kind: "hazard",
          tip: `<div class="gtip"><b>${esc(h.name)}</b><br>${esc(h.src)} · ${esc(h.alert || "")} · ${esc(h.from)}</div>`, info: { kind: "hazard", idx: i } });
      });
    }
    activeEvents().forEach(ev => {
      if (ev.kind === "live") {
        (ev.notes || []).forEach(n => { const c = Sea.CHOKES[n.wp]; if (c) out.rings.push({ lat: c.lat, lng: c.lng, severity: n.status === "avoided" ? 5 : 3, rgb: TYPE_RGB.geopolitical }); });
      } else out.rings.push({ lat: ev.lat, lng: ev.lng, severity: ev.severity, rgb: TYPE_RGB[ev.type] || [255, 255, 255] });
    });
    return out;
  }

  function portName(code) { const p = portRec(code, currentNet()); return p ? p.name : code; }
  function nodeName(id) { const n = nodeCoord(id); return n ? n.name : id; }
  function chokeLive(wp) {
    if (!SIG) return null;
    const c = Sea.CHOKES[wp]; if (!c) return null;
    return SIG.chokepoints[c.portwatch] || null;
  }
  function portLive(code) { return SIG && SIG.ports ? SIG.ports[code] || null : null; }
  function portStatus(live) {
    if (!live || live.ratio == null) return { label: "Too few calls", cls: "", color: "rgba(127,156,179,0.8)" };
    if (live.ratio < 0.35) return { label: "Near-shut", cls: "critical", color: STATUS.critical };
    if (live.ratio < 0.6) return { label: "Reduced", cls: "warning", color: STATUS.warning };
    if (live.ratio > 1.4) return { label: "Busier", cls: "info", color: "#3987e5" };
    return { label: "Normal", cls: "good", color: STATUS.good };
  }
  function chokeStatus(live) {
    if (!live || live.ratio == null) return { label: "No data", color: "rgba(127,156,179,0.8)", cls: "" };
    if (live.baseline && live.baseline.container < 1) return { label: "Low traffic", color: "rgba(127,156,179,0.8)", cls: "" };
    if (live.ratio < 0.35) return { label: "Avoided", color: STATUS.critical, cls: "critical" };
    if (live.ratio < 0.85) return { label: "Reduced", color: STATUS.warning, cls: "warning" };
    if (live.ratio > 1.3) return { label: "Elevated", color: "#3987e5", cls: "info" };
    return { label: "Normal", color: STATUS.good, cls: "good" };
  }

  // ------------------------------------------------------------------ 2D Equal Earth map
  const map2dCanvas = el("map2d"), map2dCtx = map2dCanvas.getContext("2d");
  const EE_A1 = 1.340264, EE_A2 = -0.081106, EE_A3 = 0.000893, EE_A4 = 0.003796, EE_M = Math.sqrt(3) / 2;
  function eqEarthRaw(lambda, phi) {
    const l = Math.asin(EE_M * Math.sin(phi)), l2 = l * l, l6 = l2 * l2 * l2;
    return [(lambda * Math.cos(l)) / (EE_A1 + 3 * EE_A2 * l2 + l6 * (7 * EE_A3 + 9 * EE_A4 * l2)), l * (EE_A1 + EE_A2 * l2 + l6 * (EE_A3 + EE_A4 * l2))];
  }
  const EE_X_MAX = eqEarthRaw(Math.PI, 0)[0], EE_Y_MAX = eqEarthRaw(0, Math.PI / 2)[1];
  function eqEarthInvPhi(yRaw) {
    let lo = -Math.PI / 2 + 1e-6, hi = Math.PI / 2 - 1e-6;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (eqEarthRaw(0, mid)[1] < yRaw) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  let eeScale = 1, eeOffsetX = 0, eeOffsetY = 0;
  function computeEqEarthFit(w, h) { eeScale = Math.min(w / (2 * EE_X_MAX), h / (2 * EE_Y_MAX)) * 0.94; eeOffsetX = w / 2; eeOffsetY = h / 2; }
  function projPoint(lng, lat) { const r = eqEarthRaw(lng * Math.PI / 180, lat * Math.PI / 180); return { x: eeOffsetX + r[0] * eeScale, y: eeOffsetY - r[1] * eeScale }; }

  let basemapCanvas = null;
  const basemapImg = new Image();
  basemapImg.src = "vendor/img/earth-blue-marble.jpg";
  basemapImg.onload = () => { buildBasemap(); if (state.projection === "2d") drawMap2D(); };
  function buildBasemap() {
    if (!basemapImg.complete || !basemapImg.naturalWidth) return;
    const w = map2dCanvas.width, h = map2dCanvas.height; if (!w || !h) return;
    computeEqEarthFit(w, h);
    basemapCanvas = document.createElement("canvas"); basemapCanvas.width = w; basemapCanvas.height = h;
    const b = basemapCanvas.getContext("2d");
    b.fillStyle = "#050a14"; b.fillRect(0, 0, w, h);
    const iw = basemapImg.naturalWidth, ih = basemapImg.naturalHeight;
    for (let y = 0; y < h; y++) {
      const yRaw = (eeOffsetY - y) / eeScale; if (Math.abs(yRaw) > EE_Y_MAX + 1e-6) continue;
      const phi = eqEarthInvPhi(yRaw), lat = phi * 180 / Math.PI, rowW = 2 * Math.PI * eqEarthRaw(1, phi)[0] * eeScale;
      const src = Math.min(ih - 1, Math.max(0, Math.round(((90 - lat) / 180) * ih)));
      b.drawImage(basemapImg, 0, src, iw, 1, eeOffsetX - rowW / 2, y, rowW, 1);
    }
    b.fillStyle = "rgba(5,10,20,0.5)"; b.fillRect(0, 0, w, h);
    if (state.toggles.borders) {
      const dpr = window.devicePixelRatio || 1;
      b.strokeStyle = "rgba(127,156,179,0.5)"; b.lineWidth = dpr;
      COUNTRY_FEATURES.forEach(f => {
        const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        polys.forEach(poly => poly.forEach(ring => {
          b.beginPath(); let prev = null;
          ring.forEach(([lng, lat]) => { const pt = projPoint(lng, lat); if (!prev || Math.abs(pt.x - prev.x) > w / 2) b.moveTo(pt.x, pt.y); else b.lineTo(pt.x, pt.y); prev = pt; });
          b.stroke();
        }));
      });
    }
  }
  function resizeMap2D() {
    const wrap = el("globe-wrap"), dpr = window.devicePixelRatio || 1;
    map2dCanvas.width = Math.round(wrap.clientWidth * dpr); map2dCanvas.height = Math.round(wrap.clientHeight * dpr);
    map2dCanvas.style.width = wrap.clientWidth + "px"; map2dCanvas.style.height = wrap.clientHeight + "px";
    computeEqEarthFit(map2dCanvas.width, map2dCanvas.height);
    buildBasemap();
    if (state.projection === "2d") drawMap2D();
  }
  // great-circle interpolation so 2D lanes bend the same way the globe's do
  function densify(pts) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [la1, lo1] = pts[i], [la2, lo2] = pts[i + 1];
      const r = Math.PI / 180, p1 = la1 * r, l1 = lo1 * r, p2 = la2 * r, l2 = lo2 * r;
      const a = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)];
      const b = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
      const n = Math.max(1, Math.ceil(ang / r / 2));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        if (ang < 1e-9) { out.push([la1, lo1]); continue; }
        const s1 = Math.sin((1 - t) * ang) / Math.sin(ang), s2 = Math.sin(t * ang) / Math.sin(ang);
        const x = s1 * a[0] + s2 * b[0], y = s1 * a[1] + s2 * b[1], z = s1 * a[2] + s2 * b[2];
        out.push([Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  let map2dCache = [], layers = { paths: [], points: [], rings: [], labels: [] };
  function drawMap2D() {
    const w = map2dCanvas.width, h = map2dCanvas.height; if (!w || !h) return;
    const ctx = map2dCtx, dpr = window.devicePixelRatio || 1, now = performance.now();
    ctx.clearRect(0, 0, w, h);
    if (basemapCanvas) ctx.drawImage(basemapCanvas, 0, 0); else { ctx.fillStyle = "#050a14"; ctx.fillRect(0, 0, w, h); }
    layers.paths.forEach(p => {
      ctx.strokeStyle = p.color; ctx.lineWidth = p.width * 1.3 * dpr;
      ctx.setLineDash(p.dash && !p.animate ? [4 * dpr, 4 * dpr] : p.animate ? [10 * dpr, 6 * dpr] : []);
      ctx.lineDashOffset = p.animate ? -(now / 60) * dpr : 0;
      ctx.beginPath(); let prev = null;
      (p._dense || (p._dense = densify(p.pts))).forEach(([lat, lng]) => {
        const q = projPoint(lng, lat);
        if (!prev || Math.abs(q.x - prev.x) > w / 2) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
        prev = q;
      });
      ctx.stroke();
    });
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    layers.rings.forEach(r => {
      const q = projPoint(r.lng, r.lat), pulse = (Math.sin(now / 500 + r.severity) + 1) / 2;
      ctx.strokeStyle = `rgba(${r.rgb[0]},${r.rgb[1]},${r.rgb[2]},${0.8 - pulse * 0.5})`; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(q.x, q.y, (6 + r.severity * 2 + pulse * 7) * dpr, 0, Math.PI * 2); ctx.stroke();
    });
    const cache = [];
    layers.points.forEach(p => {
      const q = projPoint(p.lng, p.lat), rad = (p.kind === "choke" ? 4.5 : p.r * 11) * dpr;
      ctx.fillStyle = p.color;
      if (p.kind === "choke") {
        ctx.beginPath(); ctx.moveTo(q.x, q.y - rad); ctx.lineTo(q.x + rad, q.y); ctx.lineTo(q.x, q.y + rad); ctx.lineTo(q.x - rad, q.y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#0c1220"; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
      } else { ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#0c1220"; ctx.lineWidth = 1.2 * dpr; ctx.stroke(); }
      cache.push({ d: p, x: q.x, y: q.y });
    });
    ctx.font = `${10 * dpr}px "Segoe UI", sans-serif`;
    layers.labels.forEach(l => { const q = projPoint(l.lng, l.lat); ctx.fillStyle = l.color || "#dbe4f5"; ctx.fillText(l.text, q.x + 7 * dpr, q.y - 5 * dpr); });
    map2dCache = cache;
  }
  function pick2D(evt) {
    const rect = map2dCanvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const mx = (evt.clientX - rect.left) * dpr, my = (evt.clientY - rect.top) * dpr;
    let best = null, bd = 14 * dpr;
    map2dCache.forEach(p => { const d = Math.hypot(p.x - mx, p.y - my); if (d < bd) { bd = d; best = p.d; } });
    return best;
  }
  map2dCanvas.addEventListener("click", e => { const d = pick2D(e); if (d) showInfo(d.info); });
  map2dCanvas.addEventListener("mousemove", e => {
    const d = pick2D(e);
    map2dCanvas.style.cursor = d ? "pointer" : "default";
    showTip(d ? d.tip : null, e.clientX, e.clientY);
  });
  map2dCanvas.addEventListener("mouseleave", () => showTip(null));
  let anim2d = false;
  function loop2D() { if (state.projection !== "2d") { anim2d = false; return; } drawMap2D(); requestAnimationFrame(loop2D); }
  function setProjection(mode) {
    state.projection = mode; bump("view-" + mode);
    el("globe").classList.toggle("hidden", mode !== "3d");
    map2dCanvas.classList.toggle("hidden", mode !== "2d");
    el("view-3d").classList.toggle("active", mode === "3d"); el("view-2d").classList.toggle("active", mode === "2d");
    controls.autoRotate = mode === "3d" && parseFloat(el("rotate-speed").value) > 0;
    if (mode === "2d") { resizeMap2D(); if (!anim2d) { anim2d = true; loop2D(); } }
    updateHash();
  }
  el("view-3d").addEventListener("click", () => setProjection("3d"));
  el("view-2d").addEventListener("click", () => setProjection("2d"));

  // shared floating tooltip (2D map + charts)
  const tipEl = document.createElement("div"); tipEl.className = "float-tip"; tipEl.hidden = true; document.body.appendChild(tipEl);
  function showTip(html, x, y) {
    if (!html) { tipEl.hidden = true; return; }
    tipEl.innerHTML = html; tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + "px";
    tipEl.style.top = Math.max(8, y - r.height - 10) + "px";
  }

  // ------------------------------------------------------------------ info panel
  const infoPanel = el("info-panel"), infoBody = el("info-body");
  el("info-close").addEventListener("click", () => infoPanel.classList.add("hidden"));
  function kv(k, v) { return `<p class="kv"><span>${esc(k)}</span><b>${v}</b></p>`; }
  function showInfo(info) {
    if (!info) return;
    bump("info-" + info.kind); bump("info");
    const res = state.result, net = currentNet();
    let h = "";
    if (info.kind === "factory") {
      const f = net.factories.find(x => x.id === info.id);
      const flow = res ? res.prep.dis.paths.filter(p => p.factory === f.id && !p.short).reduce((a, p) => a + p.flow, 0) : 0;
      h = `<span class="kind">Factory</span><h3>${esc(f.name)}</h3>${f.sector ? kv("Sector", esc(f.sector)) : ""}${kv("Capacity", fmtInt(f.cap) + " TEU/wk" + (f.standby ? ` (+${fmtInt(f.standby.cap)} standby)` : ""))}${kv("Shipping now", fmtInt(flow) + " TEU/wk")}${kv("Cost premium", fmtMoney(f.prodCost || 0) + "/TEU")}${(f.exports || []).map(x => kv("Exports via", `${esc(portName(x.port))} · ${x.days} d by ${esc(x.mode)}`)).join("")}${(f.direct || []).map(x => kv("Direct to", `${esc(nodeName(x.dc))} · ${x.days} d by ${esc(x.mode)}`)).join("")}`;
    } else if (info.kind === "dc") {
      const d = net.dcs.find(x => x.id === info.id), r = res && res.dcs.find(x => x.id === d.id);
      h = `<span class="kind">Distribution centre</span><h3>${esc(d.name)}</h3>${kv("Demand", fmtInt(d.demand) + " TEU/wk")}${kv("Safety stock", (d.bufferDays + state.levers.buffer) + " days")}${r && activeEvents().length ? kv("Time-to-survive", r.tts === null ? "beyond recovery ✓" : "day " + r.tts) + kv("Lost sales", fmtInt(r.lostTeu) + " TEU") : ""}${(d.imports || []).map(x => kv("Imports via", `${esc(portName(x.port))} · ${x.days} d by ${esc(x.mode)}`)).join("")}`;
    } else if (info.kind === "port") {
      const p = portRec(info.id, net), svcs = res ? res.prep.dis.services.filter(s => s.from === info.id || s.to === info.id) : [];
      const fl = res ? svcFlows(res.prep.dis) : {};
      const lp = portLive(info.id), ls = portStatus(lp);
      h = `<span class="kind">Port · ${esc(info.id)}</span><h3>${esc(p.name)}</h3>${p.teu ? kv("Throughput", "≈" + (p.teu / 1e6).toFixed(1) + "M TEU/yr (2022)") : ""}${lp ? kv("Container calls, last 14 days", lp.last14.toFixed(1) + "/day") + kv("Normal (2019–Oct 2023)", lp.baseline.toFixed(1) + "/day") + kv("Status", `<span class="pill ${ls.cls}">${ls.label}${lp.ratio != null ? " · " + Math.round(lp.ratio * 100) + "%" : ""}</span>`) : ""}${lp ? `<button type="button" class="btn-link" id="info-port-chart">Show port-call history ↓</button>` : ""}${svcs.map(s => kv(s.from === info.id ? "Service to " + portName(s.to) : "Service from " + portName(s.from), s.ok ? fmtInt(fl[s.id] || 0) + " TEU/wk · " + s.days.toFixed(1) + " d" : "cut")).join("")}`;
      setTimeout(() => { const b = el("info-port-chart"); if (b) b.onclick = () => { state.chokeSel = "port:" + info.id; renderLive(); el("live-panel").scrollIntoView({ behavior: "smooth" }); bump("choke-chart"); }; }, 0);
    } else if (info.kind === "choke") {
      const c = Sea.CHOKES[info.id], live = chokeLive(info.id), st = chokeStatus(live), ex = res && res.exposure.find(x => x.wp === info.id);
      h = `<span class="kind">Chokepoint</span><h3>${esc(c.name)}</h3>${live ? kv("Container transits, last 7 days", live.last7.container.toFixed(1) + "/day") + kv("Normal (2019–Oct 2023)", live.baseline.container.toFixed(1) + "/day") + kv("Status", `<span class="pill ${st.cls}">${st.label} · ${Math.round(live.ratio * 100)}%</span>`) + kv("Data as of", esc(live.asOf)) : "<p>No live data.</p>"}${ex ? kv("Your weekly flow through it", fmtInt(ex.teuWeek) + " TEU (" + Math.round(ex.share * 100) + "%)") : kv("Your weekly flow through it", "none")}<button type="button" class="btn-link" id="info-choke-chart">Show traffic history ↓</button>`;
      setTimeout(() => { const b = el("info-choke-chart"); if (b) b.onclick = () => { state.chokeSel = c.portwatch; renderLive(); el("live-panel").scrollIntoView({ behavior: "smooth" }); bump("choke-chart"); }; }, 0);
    } else if (info.kind === "supplier") {
      const sp = (net.suppliers || []).find(x => x.id === info.id); if (!sp) return;
      const a = res ? M.effectiveSupply(net, res.prep.cond.supply, res.prep.cond.suppliers || {}).suppliers[sp.id] : 1;
      const ex = res && (res.supplierExposure || []).find(x => x.id === sp.id);
      const nameOf = id => ((net.suppliers || []).find(x => x.id === id) || net.factories.find(f => f.id === id) || { name: id }).name;
      bump("supplier-info");
      h = `<span class="kind">Tier-${sp.tier || 2} supplier</span><h3>${esc(sp.name)}</h3>${sp.what ? kv("Makes", esc(sp.what)) : ""}${kv("Output in this scenario", Math.round((a == null ? 1 : a) * 100) + "%")}${ex ? kv("Your volume that depends on it", Math.round(ex.share * 100) + "%") : ""}<p class="kv-h">Feeds (share of output that needs its parts)</p><ul class="effects">${Object.keys(sp.feeds || {}).map(k => `<li>${esc(nameOf(k))} — ${Math.round(sp.feeds[k] * 100)}%</li>`).join("")}</ul>`;
    } else if (info.kind === "hazard") {
      const z = liveHazards()[info.idx], near = nearestNode(z.lat, z.lng), al = alertFor(z);
      h = `<span class="kind">${esc(z.src)} alert</span><h3>${esc(z.name)}</h3>${kv("Type", esc(z.type))}${kv("Alert level", esc(z.alert || "—"))}${kv("Date", esc(z.from))}${near ? kv("Nearest network node", `${esc(near.name)} · ${fmtInt(near.km)} km`) : ""}<p><a href="${esc(z.url)}" target="_blank" rel="noopener">Source report ↗</a></p>${al ? `<button type="button" class="btn-primary" id="info-model-alert">${state.eventIds.has(al.id) ? "Modelled ✓" : "Model this"}</button>` : `<p class="mut small">Too far from this network to model.</p>`}`;
      setTimeout(() => { const b = el("info-model-alert"); if (b) b.onclick = () => { modelAlert(al.id); showInfo(info); }; }, 0);
    } else if (info.kind === "service") {
      const s = info.svc, fl = res ? svcFlows(res.prep.dis)[s.id] || 0 : 0, b = res && res.prep.base.services.find(x => x.id === s.id);
      h = `<span class="kind">Ocean service · ${esc(D.trades[s.trade] || s.trade || "")}</span><h3>${esc(portName(s.from))} → ${esc(portName(s.to))}</h3>${s.ok ? kv("Route via", esc((s.chokes || []).map(w => Sea.CHOKES[w].name).join(", ") || "open ocean")) + kv("Distance", fmtInt(s.nm) + " nm") + kv("Transit", s.days.toFixed(1) + " d" + (b ? ` (normal ${b.days.toFixed(1)})` : "")) + kv("Capacity", fmtInt(s.cap) + " TEU/wk") + kv("Rate", fmtMoney(s.rate + s.uplift) + "/TEU") + kv("Flow", fmtInt(fl) + " TEU/wk") : "<p>No open route under this scenario.</p>"}`;
    } else if (info.kind === "event") {
      h = eventInfoHtml(evById[info.id]);
    }
    infoBody.innerHTML = h;
    infoPanel.classList.remove("hidden");
  }
  function eventInfoHtml(ev) {
    if (!ev) return "";
    const e = ev.effects || {}, bits = [];
    (e.closed || []).forEach(w => bits.push(`${Sea.CHOKES[w] ? Sea.CHOKES[w].name : w} closed`));
    Object.keys(e.choke || {}).forEach(w => bits.push(`${Sea.CHOKES[w] ? Sea.CHOKES[w].name : w} at ${Math.round(e.choke[w].cap * 100)}% capacity, +${e.choke[w].delay} d queue`));
    Object.keys(e.ports || {}).forEach(p => bits.push(`${portName(p)} at ${Math.round(e.ports[p].cap * 100)}%${e.ports[p].delay ? `, +${e.ports[p].delay} d` : ""}`));
    Object.keys(e.supply || {}).forEach(f => bits.push(`${nodeName(f)} output ${Math.round(e.supply[f] * 100)}%`));
    Object.keys(e.uplift || {}).forEach(t => bits.push(`${t === "*" ? "All trades" : D.trades[t] || t} rates +${Math.round(e.uplift[t] * 100)}%`));
    const d = ev.duration || {};
    return `<span class="kind">${esc(ev.kind)} · ${esc(ev.type)}</span><h3>${esc(ev.name)}</h3><p class="mut">${esc(ev.period || "")}</p><p>${esc(ev.description)}</p>
      <p class="kv-h">Modelled as</p><ul class="effects">${bits.map(b => `<li>${esc(b)}</li>`).join("") || "<li>No constraint</li>"}</ul>
      ${ev.kind === "alert" ? `<p class="kv-h">Near your network</p><ul class="effects">${ev.nearby.map(n => `<li>${esc(n.name)} — ${esc(n.kind)}${n.listed ? " (listed by PortWatch)" : `, ${fmtInt(n.km)} km`}</li>`).join("")}</ul><p class="kv"><span>Duration assumed</span><b>${d.mode} d · range ${d.min}–${d.max} d</b></p>` : ""}
      ${ev.kind !== "live" ? (() => { const pr = Dy.profileOf(ev); return `<p class="kv"><span>How it unfolds</span><b>${pr.onset ? `ramps up over ${pr.onset} d` : "hits at once"} · ${pr.recovery ? `fades over ${pr.recovery} d` : "ends at once"} · rates halve ${pr.rateHalfLife} d after</b></p>`; })() : ""}
      ${ev.kind !== "live" && ev.kind !== "alert" ? `<p class="kv"><span>Peak duration</span><b>${d.actual} d actual · range ${d.min}–${d.max} d</b></p><p class="kv"><span>Assumed yearly likelihood</span><b>${Math.round((ev.annualProb || 0) * 100)}%</b></p>` : ""}
      ${ev.source ? `<p><a href="${esc(ev.source.url)}" target="_blank" rel="noopener">${esc(ev.source.label)} ↗</a></p>` : ""}
      <p class="mut small">${ev.kind === "alert" ? "Effects come from the Atlas's hazard template for this type of event — an assumption to adjust, not a forecast." : ev.kind === "live" ? "Measured from PortWatch; how a measured drop becomes capacity and delay is the Atlas's stated rule (see Method)." : "Effect sizes are modelling assumptions calibrated to the public record."}</p>`;
  }
  function alertFor(h) { const k = AtlasAlerts.keyOf(h); return ALERTS.find(a => a.hz === k) || null; }
  function modelAlert(id) { state.tab = "live"; bump("model-alert"); toggleEvent(id, true); }
  function nearestNode(lat, lng) {
    const net = currentNet(), nodes = [];
    net.factories.forEach(f => nodes.push(f)); net.dcs.forEach(d => nodes.push(d));
    (net.services || []).forEach(s => { [s.from, s.to].forEach(c => { const p = portRec(c, net); if (p) nodes.push(p); }); });
    let best = null;
    nodes.forEach(n => { const km = Sea.gcNm({ lat, lng }, n) * 1.852; if (!best || km < best.km) best = { name: n.name, km }; });
    return best;
  }

  // ------------------------------------------------------------------ sidebar: events
  const eventList = el("event-list");
  function renderEventList() {
    $$("#event-tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
    const evs = ALL_EVENTS.filter(e => e.kind === state.tab || (state.tab === "live" && e.kind === "alert"));
    el("describe-box").hidden = state.tab !== "custom";
    if (!evs.length) { eventList.innerHTML = `<p class="mut">${state.tab === "live" ? "Live data snapshot not available." : state.tab === "custom" ? "Nothing yet — describe a disruption below and add it here." : "No events."}</p>`; return; }
    const card = ev => {
      const on = state.eventIds.has(ev.id);
      const sev = "●".repeat(ev.severity) + "○".repeat(5 - ev.severity);
      const extra = ev.kind === "live"
        ? `<div class="chips">${(ev.notes || []).concat(ev.portNotes || []).map(n => `<span class="pill ${n.status === "avoided" || n.status === "near-shut" ? "critical" : "warning"}">${esc(n.name)} ${Math.round(n.ratio * 100)}%</span>`).join("") || '<span class="pill good">All near normal</span>'}</div>`
        : ev.kind === "alert" ? `<div class="chips"><span class="pill info">${esc(ev.nearest.name)} · ${fmtInt(ev.nearest.km)} km</span>${ev.nearby.length > 1 ? `<span class="pill info">+${ev.nearby.length - 1} more nearby</span>` : ""}</div>` : "";
      return `<div class="event-card${on ? " on" : ""}" data-id="${esc(ev.id)}">
        <label><input type="checkbox" ${on ? "checked" : ""} data-id="${esc(ev.id)}"><span class="ev-name">${esc(ev.name)}</span></label>
        <div class="ev-meta"><span class="ev-type t-${esc(ev.type)}">${esc(ev.type)}</span><span>${esc(ev.period)}</span><span class="sev" title="Severity ${ev.severity}/5">${sev}</span></div>
        ${extra}
        <button type="button" class="ev-more btn-link" data-id="${esc(ev.id)}">Details</button>
        ${ev.kind === "custom" ? `<button type="button" class="ev-del btn-link warn" data-del="${esc(ev.id)}" aria-label="Remove this scenario">Remove</button>` : ""}
      </div>`;
    };
    if (state.tab === "live") {
      const live = evs.filter(e => e.kind === "live"), al = evs.filter(e => e.kind === "alert");
      eventList.innerHTML = live.map(card).join("") +
        `<p class="ev-sub">Alerts near your network <span class="mut">(GDACS · USGS · PortWatch, last 3–8 weeks)</span></p>` +
        (al.length ? al.map(card).join("") : `<p class="mut small">No current hazard alert is close enough to this network's ports or factories to model.</p>`);
    } else eventList.innerHTML = evs.map(card).join("");
  }
  el("event-tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (!b) return; state.tab = b.dataset.tab; bump("tab-" + state.tab); renderEventList(); });
  eventList.addEventListener("change", e => {
    const cb = e.target.closest("input[data-id]"); if (!cb) return;
    toggleEvent(cb.dataset.id, cb.checked);
  });
  eventList.addEventListener("click", e => {
    const b = e.target.closest(".ev-more"); if (b) showInfo({ kind: "event", id: b.dataset.id });
    const del = e.target.closest(".ev-del");
    if (del) { state.customEvents = state.customEvents.filter(x => x.id !== del.dataset.del); state.eventIds.delete(del.dataset.del); refreshDynamicEvents(true); render(); }
  });

  // ------------------------------------------------------------------ describe a disruption (v5.1)
  let described = null;
  el("describe-go").addEventListener("click", () => {
    const r = AtlasDescribe.parse(el("describe-text").value, D, currentNet()), out = el("describe-out");
    described = r.event; bump("described");
    out.innerHTML = r.event ? `<div class="describe-card"><b>${esc(r.event.type)}</b> · <label>lasting <input type="number" id="describe-days" value="${r.event.duration.actual}" min="1" max="730"> days</label>
        <ul class="effects">${r.matched.map(m => `<li>${esc(m)}</li>`).join("")}</ul>${r.notes.map(n => `<p class="mut small">${esc(n)}</p>`).join("")}
        <button type="button" class="btn-primary" id="describe-add">Add to scenario</button></div>`
      : `<p class="error small">${r.notes.map(esc).join(" ")}</p>`;
    const add = el("describe-add");
    if (add) add.addEventListener("click", () => {
      const days = Math.max(1, +el("describe-days").value || described.duration.actual);
      described.duration = { actual: days, min: Math.max(1, Math.round(days / 2)), mode: days, max: days * 2 };
      state.customEvents = state.customEvents.filter(x => x.id !== described.id).concat([described]);
      refreshDynamicEvents(true);
      state.eventIds.add(described.id); state.tab = "custom"; state.duration = null;
      bump("custom-added"); out.innerHTML = `<p class="success small">Added “${esc(described.name)}” to your scenarios and selected it.</p>`; el("describe-text").value = "";
      render();
    });
  });
  function toggleEvent(id, on) {
    if (on) state.eventIds.add(id); else state.eventIds.delete(id);
    bump("event"); bump("event-" + id);
    state.duration = null;
    render();
    const ev = evById[id];
    if (on && ev && ev.kind !== "live" && state.projection === "3d") world.pointOfView({ lat: ev.lat, lng: ev.lng, altitude: 2.2 }, 1200);
  }
  el("from-live").addEventListener("change", e => { state.fromLive = e.target.checked; bump("from-live"); render(); });
  el("duration").addEventListener("input", e => { state.duration = +e.target.value; bump("duration"); renderDebounced(); });
  el("duration-reset").addEventListener("click", () => { state.duration = null; render(); });
  el("clear-events").addEventListener("click", () => { state.eventIds.clear(); state.duration = null; render(); });

  // ------------------------------------------------------------------ sidebar: levers
  el("lever-checks").innerHTML = LEVER_BOOL.map(k => {
    const L = D.levers[k];
    return `<label class="toggle lever" title="${esc(L.text)}"><input type="checkbox" data-lever="${k}"><span><b>${esc(L.name)}</b><small>${esc(L.text)}</small></span></label>`;
  }).join("");
  el("lever-checks").addEventListener("change", e => { const cb = e.target.closest("input[data-lever]"); if (!cb) return; clearAmounts(cb.dataset.lever); state.levers[cb.dataset.lever] = cb.checked; bump("lever"); bump("lever-" + cb.dataset.lever); render(); });
  el("lever-buffer").addEventListener("input", e => { clearAmounts("buffer"); state.levers.buffer = +e.target.value; bump("lever"); bump("lever-buffer"); renderDebounced(); });

  // ------------------------------------------------------------------ sidebar: product families
  function famDefs() { const defs = currentNet().productDefs || D.products; return defs.map(pr => Object.assign({}, pr, state.products[pr.id] || {})); }
  function isMulti() { const net = currentNet(); return net.dcs.some(d => d.mix); }
  function renderFamilies() {
    const box = el("family-table"); if (!box) return;
    if (!isMulti()) { box.innerHTML = `<p class="mut small">This network has no product families — goods are modelled as one aggregate product using <b>Cargo value</b> and <b>Cost of a lost sale</b> under Assumptions.</p>`; return; }
    const net = currentNet();
    box.innerHTML = `<table class="fam-table"><thead><tr><th>Family</th><th class="num" title="Container demand per week">TEU/wk</th><th class="num" title="Cargo value, $ thousand per TEU">Value $k</th><th class="num" title="Cost of a lost sale, $ thousand per TEU">Lost $k</th><th class="num" title="Fill-rate target, % (worst 4 weeks)">Target %</th><th title="May be flown">Air</th><th title="In scope for critical-only stock">Crit</th></tr></thead><tbody>${famDefs().map(pr => {
      const dem = net.dcs.reduce((a, d) => a + ((d.mix || {})[pr.id] || 0), 0);
      return `<tr data-fam="${esc(pr.id)}"><td>${esc(pr.name)}</td><td class="num">${fmtInt(dem)}</td>
        <td class="num"><input type="number" data-k="valuePerTeu" value="${pr.valuePerTeu / 1000}" min="1" step="5" aria-label="${esc(pr.name)} value per TEU, thousand dollars"></td>
        <td class="num"><input type="number" data-k="lostSaleCostPerTeu" value="${pr.lostSaleCostPerTeu / 1000}" min="0" step="1" aria-label="${esc(pr.name)} cost of a lost sale per TEU, thousand dollars"></td>
        <td class="num"><input type="number" data-k="fillTarget" value="${Math.round(pr.fillTarget * 100)}" min="50" max="100" step="1" aria-label="${esc(pr.name)} fill-rate target, percent"></td>
        <td><input type="checkbox" data-k="air" ${pr.air ? "checked" : ""} aria-label="${esc(pr.name)} may be flown"></td>
        <td><input type="checkbox" data-k="critical" ${pr.critical ? "checked" : ""} aria-label="${esc(pr.name)} is critical"></td></tr>`;
    }).join("")}</tbody></table>`;
  }
  el("family-table").addEventListener("input", e => {
    const inp = e.target.closest("input[data-k]"), tr = e.target.closest("tr[data-fam]"); if (!inp || !tr) return;
    const id = tr.dataset.fam, k = inp.dataset.k, o = state.products[id] = state.products[id] || {};
    if (inp.type === "checkbox") o[k] = inp.checked;
    else { const v = parseFloat(inp.value); if (!Number.isFinite(v)) return; o[k] = k === "fillTarget" ? v / 100 : v * 1000; }
    bump("family"); state.portfolio = null; renderDebounced();
  });
  el("reset-families").addEventListener("click", () => { state.products = {}; renderFamilies(); render(); });
  el("lever-scope").addEventListener("change", e => { state.levers.bufferScope = e.target.value; bump("lever"); bump("lever-scope"); render(); });

  // ------------------------------------------------------------------ sidebar: assumptions & layers
  Object.keys(DEFAULT_ASSUME).forEach(k => {
    const inp = el("a-" + k); if (!inp) return;
    inp.value = state.assume[k];
    inp.addEventListener("input", () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) { state.assume[k] = v; bump("assume"); renderDebounced(); } });
  });
  el("reset-assumptions").addEventListener("click", () => { state.assume = Object.assign({}, DEFAULT_ASSUME); Object.keys(DEFAULT_ASSUME).forEach(k => { const i = el("a-" + k); if (i) i.value = state.assume[k]; }); render(); });
  Object.keys(state.toggles).forEach(k => {
    const inp = el("toggle-" + k); if (!inp) return;
    inp.addEventListener("change", () => { state.toggles[k] = inp.checked; bump("layer"); if (k === "borders") buildBasemap(); renderMap(); });
  });

  let rTimer = null;
  function renderDebounced() { clearTimeout(rTimer); rTimer = setTimeout(render, 60); syncControls(); }

  // ------------------------------------------------------------------ CSV import
  const { NODES_TEMPLATE, LANES_TEMPLATE, SUPPLIERS_TEMPLATE, buildCustomNet } = AtlasCsv;

  function applyCustom() {
    const st = el("network-status");
    if (!state.customRaw.nodes) { st.textContent = "Load a nodes CSV first."; st.className = "narrative"; return; }
    const r = buildCustomNet(state.customRaw.nodes, state.customRaw.lanes || "", state.customRaw.suppliers || "");
    if (r.errors.length && (!r.net.factories.length || !r.net.dcs.length)) { st.textContent = "Couldn't build the network: " + r.errors.slice(0, 4).join("; "); st.className = "narrative error"; return; }
    state.customNet = r.net; state.networkSource = "custom"; el("network-source").value = "custom";
    st.textContent = `Loaded ${r.net.factories.length} factories, ${r.net.dcs.length} DCs, ${r.net.services.length} sea lanes.` + (r.errors.length ? ` Skipped: ${r.errors.slice(0, 3).join("; ")}.` : "") + (r.warnings.length ? ` Note: ${r.warnings.slice(0, 2).join("; ")}.` : "");
    st.className = "narrative " + (r.errors.length ? "error" : "success");
    bump("custom-net");
    state.portfolio = null; state.mc = null;
    render();
    const pts = r.net.factories.concat(r.net.dcs);
    if (pts.length) { const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng = pts.reduce((a, p) => a + p.lng, 0) / pts.length; world.pointOfView({ lat, lng, altitude: 2.2 }, 1200); }
  }
  function readFile(inp, key) {
    inp.addEventListener("change", () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { state.customRaw[key] = String(rd.result); applyCustom(); };
      rd.readAsText(f);
    });
  }
  readFile(el("nodes-csv-input"), "nodes"); readFile(el("lanes-csv-input"), "lanes"); readFile(el("suppliers-csv-input"), "suppliers");
  el("download-suppliers-template").addEventListener("click", () => download("atlas-suppliers-template.csv", SUPPLIERS_TEMPLATE));
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type || "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  el("download-nodes-template").addEventListener("click", () => download("atlas-nodes-template.csv", NODES_TEMPLATE));
  el("download-lanes-template").addEventListener("click", () => download("atlas-lanes-template.csv", LANES_TEMPLATE));
  function loadDemo() { state.customRaw = { nodes: NODES_TEMPLATE, lanes: LANES_TEMPLATE, suppliers: SUPPLIERS_TEMPLATE }; applyCustom(); }
  el("load-demo-network").addEventListener("click", loadDemo);
  el("clear-network").addEventListener("click", () => {
    state.customNet = null; state.customRaw = { nodes: null, lanes: null }; state.networkSource = "sample"; el("network-source").value = "sample";
    el("nodes-csv-input").value = ""; el("lanes-csv-input").value = "";
    el("network-status").textContent = "Showing the sample network."; el("network-status").className = "narrative";
    render();
  });
  el("network-source").addEventListener("change", e => {
    if (e.target.value === "custom" && !state.customNet) { e.target.value = "sample"; el("network-status").textContent = "Import a network first (or load the demo CSVs)."; return; }
    state.networkSource = e.target.value; render();
  });

  // ------------------------------------------------------------------ charts (inline SVG)
  function svgEl(w, h, inner, label) { return `<svg viewBox="0 0 ${w} ${h}" width="${w}" style="max-width:100%;height:auto" role="img" aria-label="${esc(label || "")}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`; }
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

  // Horizontal diverging bars: extra cost (warm) vs saving (cool), zero line, value labels.
  function costChart(comps) {
    const NAMES = { surcharge: "Freight-rate surcharges", freight: "Ocean freight (distance)", inland: "Road / rail / barge", carrying: "Inventory in transit", production: "Production (source shift)", air: "Air freight", lostMargin: "Lost sales" };
    const rows = Object.keys(NAMES).filter(k => comps[k] != null && Math.abs(comps[k]) >= 1).map(k => ({ k, label: NAMES[k], v: comps[k] }));
    if (!rows.length) return `<p class="mut">No extra cost — the network absorbs this scenario.</p>`;
    rows.sort((a, b) => b.v - a.v);
    const W = 560, rowH = 30, padL = 170, padR = 70, H = rows.length * rowH + 16;
    const maxAbs = niceMax(Math.max(...rows.map(r => Math.abs(r.v))));
    const hasNeg = rows.some(r => r.v < 0);
    const x0 = hasNeg ? padL + (W - padL - padR) / 2 : padL, span = hasNeg ? (W - padL - padR) / 2 : W - padL - padR;
    let g = `<line x1="${x0}" x2="${x0}" y1="4" y2="${H - 8}" class="g-axis" stroke-width="1"/>`;
    rows.forEach((r, i) => {
      const y = 8 + i * rowH, len = Math.max(2, Math.abs(r.v) / maxAbs * span), pos = r.v >= 0;
      const x = pos ? x0 : x0 - len, col = pos ? "var(--cost-up)" : "var(--cost-down)";
      g += `<text x="${padL - 10}" y="${y + 15}" text-anchor="end" class="ax">${esc(r.label)}</text>`;
      g += `<path d="${pos ? `M${x},${y + 4} h${len - 4} a4,4 0 0 1 4,4 v${rowH - 16} a4,4 0 0 1 -4,4 h${-(len - 4)} z` : `M${x0},${y + 4} h${-(len - 4)} a4,4 0 0 0 -4,4 v${rowH - 16} a4,4 0 0 0 4,4 h${len - 4} z`}" style="fill:${col}" class="hov" data-tip="${esc(`<b>${r.label}</b><br>${fmtMoney(r.v, true)}`)}"/>`;
      g += `<text x="${pos ? x + len + 6 : x - 6}" y="${y + 15}" text-anchor="${pos ? "start" : "end"}" class="val">${fmtMoney(r.v, true)}</text>`;
    });
    return svgEl(W, H, g, "Cost breakdown") + (hasNeg ? `<p class="mut small">Blue = cheaper than normal (e.g. shorter or cheaper legs); red = extra cost.</p>` : "");
  }

  // Multi-line chart with crosshair tooltip. series: [{name, color, values[]}]
  function lineChart(id, series, opts) {
    const box = el(id); if (!box) return;
    const W = 560, H = 230, padL = 46, padR = 96, padT = 12, padB = 30;
    const n = Math.max(...series.map(s => s.values.length));
    if (!n) { box.innerHTML = `<p class="mut">${esc(opts.empty || "No data")}</p>`; return; }
    const ymax = niceMax(Math.max(opts.yMin || 0, ...series.flatMap(s => s.values), opts.ref || 0));
    const X = i => padL + (n <= 1 ? 0 : i / (n - 1)) * (W - padL - padR), Y = v => padT + (1 - v / ymax) * (H - padT - padB);
    let g = "";
    for (let k = 0; k <= 4; k++) { const v = ymax * k / 4, y = Y(v); g += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="g-grid"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end" class="ax">${esc(opts.yFmt(v))}</text>`; }
    const ticks = opts.xTicks || [0, Math.floor((n - 1) / 2), n - 1];
    ticks.forEach(i => { g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(opts.xFmt(i))}</text>`; });
    if (opts.ref != null) g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(opts.ref)}" y2="${Y(opts.ref)}" class="g-ref" stroke-dasharray="4 4" stroke-width="1.5"/><text x="${W - padR + 6}" y="${Y(opts.ref) + 4}" class="ax">${esc(opts.refLabel || "")}</text>`;
    if (opts.vline != null) g += `<line x1="${X(opts.vline)}" x2="${X(opts.vline)}" y1="${padT}" y2="${H - padB}" class="g-ref" stroke-dasharray="3 3"/><text x="${X(opts.vline) + 4}" y="${padT + 10}" class="ax">${esc(opts.vlineLabel || "")}</text>`;
    // end labels for 2–4 series (a single series is named by the chart title), nudged apart
    const ends = [];
    series.forEach(s => {
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
      g += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
      const li = s.values.length - 1;
      if (series.length >= 2 && series.length <= 4 && li >= 0) ends.push({ y: Y(s.values[li]) + 4, x: X(li) + 6, text: s.short || s.name });
    });
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
    ends.forEach(e => { g += `<text x="${e.x}" y="${e.y}" class="lbl">${esc(e.text)}</text>`; });
    g += `<line class="xh g-xh" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke-width="1" opacity="0"/>`;
    g += `<rect class="hit" x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" fill="transparent"/>`;
    const legend = series.length >= 2 ? `<div class="legend-row">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
    box.innerHTML = legend + svgEl(W, H, g, opts.label);
    const svg = box.querySelector("svg"), hit = svg.querySelector(".hit"), xh = svg.querySelector(".xh");
    const point = (i, cx, cy) => {
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.setAttribute("opacity", 0.5);
      showTip(`<b>${esc(opts.xFmt(i))}</b>` + series.map(s => `<br><i class="sw" style="background:${s.color}"></i>${esc(s.name)}: ${esc(opts.yFmt(s.values[i] == null ? 0 : s.values[i], true))}`).join(""), cx, cy);
    };
    hit.addEventListener("mousemove", ev => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W;
      point(Math.max(0, Math.min(n - 1, Math.round((sx - padL) / (W - padL - padR) * (n - 1)))), ev.clientX, ev.clientY);
    });
    hit.addEventListener("mouseleave", () => { xh.setAttribute("opacity", 0); showTip(null); });
    // keyboard: focus the chart, arrows step through points (Shift = 10 at a time), Home/End jump
    let ki = n - 1;
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", (opts.label || "Chart") + ". Use the arrow keys to read values.");
    svg.addEventListener("keydown", ev => {
      const step = ev.shiftKey ? 10 : 1;
      if (ev.key === "ArrowRight") ki = Math.min(n - 1, ki + step); else if (ev.key === "ArrowLeft") ki = Math.max(0, ki - step);
      else if (ev.key === "Home") ki = 0; else if (ev.key === "End") ki = n - 1; else return;
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      point(ki, r.left + X(ki) / W * r.width, r.top + 20);
    });
    svg.addEventListener("blur", () => { xh.setAttribute("opacity", 0); showTip(null); });
    if (opts.table) addTable(box, opts.table.headers, opts.table.rows);
  }
  // "Show as table" toggle under a chart — the accessible / exact-values view of the same data.
  function addTable(box, headers, rows) {
    const id = box.id + "-tbl";
    box.insertAdjacentHTML("beforeend", `<div class="chart-tools"><button type="button" class="btn-link" aria-expanded="false" aria-controls="${id}">Show as table</button></div>
      <div class="chart-table" id="${id}" hidden><table><thead><tr>${headers.map((h, i) => `<th${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    const btn = box.querySelector(".chart-tools button"), tbl = el(id);
    btn.addEventListener("click", () => { tbl.hidden = !tbl.hidden; btn.setAttribute("aria-expanded", String(!tbl.hidden)); btn.textContent = tbl.hidden ? "Show as table" : "Hide table"; bump("chart-table"); });
  }
  function renderFamilyFill(res) {
    const sr = res.series; if (!sr || !sr.famLost) { el("fam-chart").innerHTML = ""; return; }
    const n = sr.served.length, wkN = Math.ceil(n / 7), ticks = [0, Math.floor((wkN - 1) / 2), wkN - 1];
    const series = res.products.map((f, i) => {
      const lost = sr.famLost[f.id] || [], D = f.demand / 7;
      const vals = Array.from({ length: wkN }, (_, k) => { const xs = lost.slice(k * 7, k * 7 + 7); return 100 * (1 - xs.reduce((a, b) => a + b, 0) / (D * Math.max(1, xs.length))); });
      return { name: f.name, short: f.name.split(" ")[0], color: SERIES[i % SERIES.length], values: vals };
    });
    lineChart("fam-chart", series, { yFmt: (v, t) => t ? v.toFixed(1) + "% fill" : v.toFixed(0) + "%", yMin: 100, xFmt: i => "Week " + (i + 1), xTicks: ticks, label: "Weekly fill rate by product family",
      table: { headers: ["Week"].concat(series.map(x => x.name)), rows: Array.from({ length: wkN }, (_, k) => ["Week " + (k + 1)].concat(series.map(x => x.values[k].toFixed(1) + "%"))) } });
  }
  function renderFamilyTable(res) {
    const tb = document.querySelector("#family-results tbody"), evs = activeEvents();
    if (!res || !res.products) { tb.innerHTML = ""; return; }
    tb.innerHTML = res.products.map(f => `<tr><td>${esc(f.name)}${f.critical ? ' <span class="pill info">critical</span>' : ""}</td><td class="num">${fmtInt(f.demand)}</td>
      <td class="num">${evs.length ? Math.round(f.worst4w * 1000) / 10 + "%" : "—"}</td><td class="num">${Math.round(f.target * 100)}%</td><td class="num">${evs.length ? (f.fill * 100).toFixed(1) + "%" : "—"}</td>
      <td class="num">${evs.length ? fmtInt(f.lostTeu) : "—"}</td><td class="num">${evs.length ? fmtMoney(f.lostCost) : "—"}</td><td class="num">${evs.length ? fmtInt(f.airTeu) : "—"}</td>
      <td>${!evs.length ? '<span class="mut">baseline</span>' : f.meets ? '<span class="pill good">✓ on target</span>' : '<span class="pill critical">✕ below target</span>'}</td></tr>`).join("");
  }
  function wireBarTips(root) {
    $$(".hov", root).forEach(n => {
      n.addEventListener("mousemove", ev => showTip(n.getAttribute("data-tip"), ev.clientX, ev.clientY));
      n.addEventListener("mouseleave", () => showTip(null));
    });
  }

  // ------------------------------------------------------------------ results rendering
  function renderKpis() {
    const res = state.result, evs = activeEvents();
    const set = (id, val, sub, cls) => { const k = el(id); k.querySelector(".k-val").innerHTML = val; k.querySelector(".k-sub").innerHTML = sub || ""; k.className = "kpi" + (cls ? " " + cls : ""); };
    if (!res) { ["kpi-cost", "kpi-tts", "kpi-lost", "kpi-service"].forEach(id => set(id, "–", "")); return; }
    if (!evs.length) {
      set("kpi-cost", "No disruption", `Baseline logistics ${fmtMoney(res.prep.base.opCostWeek)}/wk`);
      set("kpi-tts", "—", "Pick a scenario on the left");
      set("kpi-lost", "0 TEU", "");
      set("kpi-service", Math.round(res.prep.base.servedTotal / res.prep.base.demand * 100) + "%", `${fmtInt(res.prep.base.demand)} TEU/wk demand`);
      return;
    }
    set("kpi-cost", fmtMoney(res.total), `over ${res.ttr} days${res.leverCost.total ? ` · options ${fmtMoney(res.leverCost.total)}/yr` : ""}`, res.total > 5e7 ? "bad" : res.total > 5e6 ? "warn" : "");
    const tts = res.tts;
    const back = res.recoveredAt != null ? `service normal again day ${res.recoveredAt}` : "not back to normal within a year";
    set("kpi-tts", tts === null ? `<span class="ok">✓</span> survives` : `<span class="crit">✕</span> day ${tts} &lt; ${res.ttr}`, (tts === null ? `Stock outlasts the ${res.ttr}-day disruption` : `First DC runs short day ${tts}`) + " · " + back, tts === null ? "good" : "bad");
    set("kpi-lost", fmtInt(res.lostTeu) + " TEU", res.lostTeu ? fmtMoney(res.comps.lostMargin) + " of lost sales" + (res.airTeu ? ` · ${fmtInt(res.airTeu)} TEU flown` : "") : res.airTeu ? `${fmtInt(res.airTeu)} TEU flown in` : "", res.lostTeu > 0 ? "bad" : "good");
    const fams = res.products || [], miss = fams.filter(f => f.meets === false);
    if (fams.length) {
      const worst = fams.slice().sort((a, b) => (a.worst4w - a.target) - (b.worst4w - b.target))[0];
      set("kpi-service", fams.length === 1 ? Math.round(worst.worst4w * 100) + "%" : `${fams.length - miss.length} of ${fams.length}`,
        fams.length === 1 ? `worst 4-week fill · target ${Math.round(worst.target * 100)}%` : (miss.length ? `families on target · worst: ${esc(worst.name)} ${Math.round(worst.worst4w * 100)}% vs ${Math.round(worst.target * 100)}%` : "families meet their fill-rate targets"),
        miss.length ? "bad" : "good");
    }
  }

  // smallest extra stock (days, at every DC) that avoids any stock-out — bisection on the simulation
  let fixCache = { key: null, val: null };
  function minExtraBuffer() {
    const key = scenarioKey();
    if (fixCache.key === key) return fixCache.val;
    const o = overrides(); if (!o.duration) o.duration = Math.max(1, effectiveDuration());
    const lostWith = b => Dy.analyse(D, currentNet(), activeEvents(), Object.assign({}, state.levers, { buffer: (state.levers.buffer || 0) + b }), o).lostTeu;
    let lo = 0, hi = 60, val = null;
    if (lostWith(hi) > 0.5) val = null;
    else { while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lostWith(mid) > 0.5) lo = mid; else hi = mid; } val = hi; }
    fixCache = { key, val };
    return val;
  }

  function renderStory() {
    const res = state.result, evs = activeEvents(), box = el("story");
    if (!res) { box.innerHTML = `<p class="error">The model could not solve this scenario.</p>`; return; }
    if (!evs.length) {
      const exp = res.exposure.slice(0, 3).map(x => `<b>${esc(x.name)}</b> (${Math.round(x.share * 100)}%)`).join(", ");
      box.innerHTML = `<p><b>${esc(currentNet().name)}.</b> In normal conditions the plan ships ${fmtInt(res.prep.base.servedTotal)} TEU a week at about ${fmtMoney(res.prep.base.opCostWeek)} in logistics and transit-inventory cost. Its biggest chokepoint exposures: ${exp || "none"}. Pick a scenario on the left to stress it.</p>`;
      return;
    }
    const base = res.prep.base, dis = res.prep.dis, bs = {}; base.services.forEach(s => { bs[s.id] = s; });
    const fl = svcFlows(base), parts = [];
    const closed = Object.keys(res.prep.cond.closed).map(w => Sea.CHOKES[w] ? Sea.CHOKES[w].name : w);
    if (closed.length) parts.push(`${closed.join(" and ")} ${closed.length > 1 ? "are" : "is"} closed to container traffic.`);
    const rer = dis.services.filter(s => serviceStatus(s, bs[s.id]) === "reroute");
    if (rer.length) {
      const extra = Math.max(...rer.map(s => s.days - bs[s.id].days)), vol = rer.reduce((a, s) => a + (fl[s.id] || 0), 0);
      parts.push(`${rer.length} service${rer.length > 1 ? "s" : ""} (${fmtInt(vol)} TEU/wk normally) reroute — up to <b>+${extra.toFixed(0)} days</b> at sea.`);
    }
    const cut = dis.services.filter(s => !s.ok && bs[s.id] && bs[s.id].ok && (fl[s.id] || 0) > 0);
    if (cut.length) parts.push(`${cut.length} service${cut.length > 1 ? "s" : ""} carrying ${fmtInt(cut.reduce((a, s) => a + (fl[s.id] || 0), 0))} TEU/wk ${cut.length > 1 ? "are" : "is"} cut; the solver moves that volume to other lanes and sources.`);
    const shortDcs = res.dcs.filter(d => d.tts !== null).sort((a, b) => a.tts - b.tts);
    if (shortDcs.length) {
      const d0 = shortDcs[0], fix = minExtraBuffer();
      parts.push(`<b>${esc(d0.name)}</b> runs out on <b>day ${d0.tts}</b> — its ${d0.buffer}-day buffer can't bridge the gap before re-planned supply lands — and ${fmtInt(res.lostTeu)} TEU of demand goes unmet across the network.${fix ? ` About <b>${fix} more days</b> of stock at every DC would have covered it.` : ""}`);
    } else parts.push(`Every DC's stock outlasts the ${res.ttr}-day disruption: <b>time-to-survive exceeds time-to-recover</b>.`);
    if (res.series) {
      const pk = Math.max(...res.series.backlog);
      if (pk > 1) parts.push(`Cargo piles up at ports and chokepoints — <b>${fmtInt(pk)} TEU</b> waiting at the peak.`);
      if (res.firstReplan != null) parts.push(`Planners react on day ${res.firstReplan} (seeing conditions ${res.prep.reactionDays} days late${state.levers.controlTower ? ", thanks to the control tower" : ""}).`);
      parts.push(res.recoveredAt != null ? `Service and stock are back to normal on <b>day ${res.recoveredAt}</b>${res.tail ? ` — a <b>${res.tail}-day tail</b> after conditions themselves recovered` : ""}.` : `Stock is still rebuilding a year after the disruption.`);
    }
    if (res.multiProduct && res.products) {
      const miss = res.products.filter(f => f.meets === false).sort((a, b) => a.worst4w - b.worst4w);
      if (miss.length) parts.push(`${miss.length === res.products.length ? "Every product family" : miss.map(f => `<b>${esc(f.name)}</b>`).join(", ")} ${miss.length === 1 ? "misses its" : "miss their"} service target — worst: ${esc(miss[0].name)} at <b>${Math.round(miss[0].worst4w * 100)}%</b> in its worst four weeks against ${Math.round(miss[0].target * 100)}%.`);
      else parts.push(`Every product family stays on its service target.`);
      const gone = res.products.filter(f => f.lostTeu > 0.5).sort((a, b) => b.lostCost - a.lostCost);
      if (gone.length > 1) parts.push(`Most of the lost-sales cost is ${esc(gone[0].name.toLowerCase())} (${fmtMoney(gone[0].lostCost)}).`);
    }
    const comps = Object.entries(res.comps).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const NAMES = { surcharge: "freight-rate surcharges", freight: "longer sailings", inland: "inland detours", carrying: "inventory tied up in transit", production: "dearer sources", air: "air freight", lostMargin: "lost sales" };
    if (comps.length) parts.push(`Total extra cost <b>${fmtMoney(res.total)}</b> over ${res.ttr} days, mostly ${NAMES[comps[0][0]] || comps[0][0]} (${fmtMoney(comps[0][1])}).${comps[0][0] === "surcharge" && !state.levers.rateHedge ? " Physical levers don't touch that part — fixed-rate contracts do." : ""}`);
    if (res.prep.steady) parts.push(`<span class="mut">Live conditions are treated as the network's current steady state (no onset shock) — this is the running cost of today's situation versus a pre-2023 normal.</span>`);
    if (state.fromLive) parts.push(`<span class="mut">Baseline = today's live conditions; the selected events are layered on top.</span>`);
    box.innerHTML = `<p>${parts.join(" ")}</p>`;
  }

  function renderResults() {
    const res = state.result;
    renderKpis(); renderStory();
    const evs = activeEvents();
    el("cost-chart").innerHTML = res && evs.length ? costChart(res.comps) : `<p class="mut">Pick a scenario to see what it costs.</p>`;
    wireBarTips(el("cost-chart"));
    if (res && evs.length) {
      const NAMES = { surcharge: "Freight-rate surcharges", freight: "Ocean freight (distance)", inland: "Road / rail / barge", carrying: "Inventory in transit", production: "Production (source shift)", air: "Air freight", lostMargin: "Lost sales" };
      const rows = Object.keys(NAMES).filter(k => res.comps[k] != null && Math.abs(res.comps[k]) >= 1).map(k => [NAMES[k], fmtMoney(res.comps[k], true)]);
      if (rows.length) addTable(el("cost-chart"), ["Component", "Extra cost"], rows.concat([["Total", fmtMoney(res.total, true)]]));
    }
    if (res && evs.length) {
      const dcs = res.dcs;
      lineChart("inv-chart", dcs.map((d, i) => ({ name: d.name, short: d.name.split(" ")[0], color: SERIES[i % 3], values: (d.trace || []).map(v => v / (d.demand / 7)) })),
        { yFmt: (v, t) => t ? v.toFixed(1) + " days of cover" : v.toFixed(0) + " d", xFmt: i => "Day " + i, label: "Inventory cover by DC",
          table: { headers: ["Day"].concat(dcs.map(d => d.name)), rows: (dcs[0].trace || []).map((_, i) => i).filter(i => i % 7 === 0 || i === (dcs[0].trace || []).length - 1).map(i => ["Day " + i].concat(dcs.map(d => ((d.trace[i] || 0) / (d.demand / 7)).toFixed(1) + " d"))) }, xTicks: (() => { const n = (dcs[0].trace || []).length; return n ? [0, Math.floor((n - 1) / 2), n - 1] : []; })() });
      if (dcs.length > 3) el("inv-chart").insertAdjacentHTML("beforeend", `<p class="mut small">More than three DCs: colours repeat, so use the line labels and the table below.</p>`);
    } else el("inv-chart").innerHTML = `<p class="mut">Pick a scenario to see inventory run down.</p>`;
    if (res && evs.length && res.series) {
      const sr = res.series, n = sr.served.length, wkN = Math.ceil(n / 7);
      const weekly = (arr, f) => Array.from({ length: wkN }, (_, k) => { const xs = arr.slice(k * 7, k * 7 + 7); return f(xs); });
      const served = weekly(sr.served, xs => 100 * xs.reduce((a, b) => a + b, 0) / xs.length);
      const backlog = weekly(sr.backlog, xs => Math.max(...xs));
      const ticks = [0, Math.floor((wkN - 1) / 2), wkN - 1];
      lineChart("serve-chart", [{ name: "Demand met", short: "", color: SERIES[0], values: served }],
        { yFmt: (v, t) => t ? v.toFixed(1) + "% of demand met" : v.toFixed(0) + "%", yMin: 100, xFmt: i => "Week " + (i + 1), xTicks: ticks, ref: 100, refLabel: "full", label: "Weekly demand met",
          table: { headers: ["Week", "Demand met"], rows: served.map((v, i) => ["Week " + (i + 1), v.toFixed(1) + "%"]) } });
      lineChart("backlog-chart", [{ name: "Cargo waiting", short: "", color: SERIES[1], values: backlog }],
        { yFmt: (v, t) => t ? fmtInt(v) + " TEU waiting" : fmtInt(v), xFmt: i => "Week " + (i + 1), xTicks: ticks, label: "Peak weekly backlog at ports and chokepoints",
          table: { headers: ["Week", "Peak TEU waiting"], rows: backlog.map((v, i) => ["Week " + (i + 1), fmtInt(v)]) } });
      // fill rate by family, weekly (rebuilt from per-family daily lost sales)
      if (res.products && res.products.length) renderFamilyFill(res);
    } else {
      el("fam-chart").innerHTML = `<p class="mut">Pick a scenario to see each family's fill rate.</p>`;
      el("serve-chart").innerHTML = `<p class="mut">Pick a scenario to see service over time.</p>`;
      el("backlog-chart").innerHTML = `<p class="mut">Pick a scenario to see backlogs build and clear.</p>`;
    }
    const tb = document.querySelector("#dc-table tbody");
    tb.innerHTML = res ? res.dcs.map(d => {
      const ok = d.tts === null, show = evs.length > 0;
      return `<tr><td>${esc(d.name)}</td><td class="num">${fmtInt(d.demand)}</td><td class="num">${d.buffer}</td><td class="num">${Math.round(d.servedShare * 100)}%</td>
        <td class="num">${show ? (ok ? "&gt; " + res.ttr + " d" : "day " + d.tts) : "—"}</td><td class="num">${show ? res.ttr + " d" : "—"}</td><td class="num">${show ? fmtInt(d.lostTeu) : "—"}</td><td class="num">${show ? fmtInt(d.airTeu || 0) : "—"}</td>
        <td>${show ? (ok ? '<span class="pill good">✓ TTS &gt; TTR</span>' : '<span class="pill critical">✕ TTS &lt; TTR</span>') : '<span class="mut">baseline</span>'}</td></tr>`;
    }).join("") : "";
    el("lever-annual").textContent = res ? fmtMoney(res.leverCost.total) + "/yr" : "$0";
    renderFamilyTable(res);
  }

  // ------------------------------------------------------------------ Monte Carlo
  el("run-mc").addEventListener("click", runMc);
  function runMc() {
    const evs = activeEvents(), out = el("mc-out"), btn = el("run-mc");
    if (!evs.length) { out.innerHTML = `<p class="mut">Select at least one scenario first.</p>`; return; }
    const o = overrides(); delete o.duration;
    const ctx = Dy.prepare(D, currentNet(), evs, state.levers, o), rng = M.mulberry32(2026), runs = 400, key = scenarioKey();
    const xs = [], durs = [], tails = []; let shortRuns = 0, i = 0;
    btn.disabled = true;
    (function step() {
      const until = Date.now() + 40;
      while (i < runs && Date.now() < until) {
        const du = ctx.all.map(x => x.constant ? null : M.triangular(rng, x.ev.duration.min, x.ev.duration.mode, x.ev.duration.max));
        const r = Dy.run(ctx, du, 0.6 + 0.8 * rng(), false, o.duration || 90);
        xs.push(r.total); durs.push(r.eventEnd); if (r.tts !== null) shortRuns++; if (r.tail != null) tails.push(r.tail);
        i++;
      }
      btn.textContent = `Running… ${i}/${runs}`;
      if (i < runs) { setTimeout(step, 0); return; }
      const sorted = xs.slice().sort((a, b) => a - b), q = p => { const k = (sorted.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k); return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo); };
      state.mc = { runs, mean: xs.reduce((a, b) => a + b, 0) / runs, p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), sorted, pShortfall: shortRuns / runs,
        meanDuration: durs.reduce((a, b) => a + b, 0) / runs, meanTail: tails.length ? tails.reduce((a, b) => a + b, 0) / tails.length : null };
      state.mcKey = key; bump("mc");
      btn.disabled = false; btn.textContent = "Run 400 samples";
      renderMc();
    })();
  }
  function renderMc() {
    const out = el("mc-out"), mc = state.mc;
    if (!mc) return;
    const stale = state.mcKey !== scenarioKey();
    const xs = mc.sorted, lo = xs[0], hi = xs[xs.length - 1], bins = 24;
    const w = (hi - lo) / bins || 1, counts = new Array(bins).fill(0);
    xs.forEach(x => { counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++; });
    const W = 560, H = 200, padL = 40, padR = 16, padT = 14, padB = 30, cmax = Math.max(...counts);
    const bw = (W - padL - padR) / bins;
    let g = "";
    counts.forEach((c, i) => {
      const h = c / cmax * (H - padT - padB), x = padL + i * bw + 1, y = H - padB - h;
      if (c) g += `<path d="M${x},${H - padB} v${-(h - 4)} a4,4 0 0 1 4,-4 h${bw - 10} a4,4 0 0 1 4,4 v${h - 4} z" style="fill:var(--s1)" class="hov" data-tip="${esc(`${fmtMoney(lo + i * w)} – ${fmtMoney(lo + (i + 1) * w)}<br>${c} of ${mc.runs} runs`)}"/>`;
    });
    const X = v => padL + (v - lo) / (hi - lo || 1) * (W - padL - padR);
    [["P50", mc.p50], ["P90", mc.p90]].forEach(([l, v]) => { g += `<line x1="${X(v)}" x2="${X(v)}" y1="${padT}" y2="${H - padB}" class="g-xh" stroke-dasharray="4 3"/><text x="${X(v) + 4}" y="${padT + 10}" class="lbl">${l}</text>`; });
    g += `<line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" class="g-axis"/>`;
    g += `<text x="${padL}" y="${H - 8}" class="ax">${fmtMoney(lo)}</text><text x="${W - padR}" y="${H - 8}" text-anchor="end" class="ax">${fmtMoney(hi)}</text><text x="${(W) / 2}" y="${H - 8}" text-anchor="middle" class="ax">Disruption cost per run</text>`;
    out.innerHTML = `${stale ? '<p class="stale">Scenario changed since this run — run again to refresh.</p>' : ""}
      <div class="tiles">
        <div class="tile"><span>Median (P50)</span><b>${fmtMoney(mc.p50)}</b></div>
        <div class="tile"><span>Bad case (P90)</span><b>${fmtMoney(mc.p90)}</b></div>
        <div class="tile"><span>Severe (P99)</span><b>${fmtMoney(mc.p99)}</b></div>
        <div class="tile"><span>Chance some DC runs short</span><b>${Math.round(mc.pShortfall * 100)}%</b></div>
        <div class="tile"><span>Average duration sampled</span><b>${Math.round(mc.meanDuration)} d</b></div>
        <div class="tile"><span>Average recovery tail</span><b>${mc.meanTail == null ? "—" : Math.round(mc.meanTail) + " d"}</b></div>
      </div>
      <figure class="chart-card"><figcaption><b>Distribution of outcomes</b><span>${mc.runs} runs · duration from each event's range · rate shock ×0.6–1.4</span></figcaption><div class="chart" id="mc-chart">${svgEl(W, H, g, "Monte Carlo cost histogram")}</div></figure>`;
    wireBarTips(out);
    addTable(el("mc-chart"), ["Cost range", "Runs"], counts.map((c, i) => [fmtMoney(lo + i * w) + " – " + fmtMoney(lo + (i + 1) * w), String(c)]));
  }

  // ------------------------------------------------------------------ portfolio
  el("run-portfolio").addEventListener("click", () => {
    const btn = el("run-portfolio"); btn.disabled = true; btn.textContent = "Evaluating… 0/64";
    const o = overrides(); delete o.duration;
    const buf = state.levers.buffer || 7;
    const scope = isMulti() ? (state.levers.bufferScope || "all") : "all";
    Dy.portfolioAsync(riskAdjusted().data, currentNet(), o, buf, 6, (done, total) => { btn.textContent = `Evaluating… ${done}/${total}`; }, rows => {
      state.portfolio = { rows, buffer: buf, scope };
      state.portfolioKey = JSON.stringify([state.assume, state.networkSource, state.fromLive, buf]);
      bump("portfolio");
      btn.disabled = false; btn.textContent = "Evaluate all 64 lever combinations";
      renderPortfolio();
    }, scope);
  });
  // ------------------------------------------------------------------ likelihood & correlation (v4.1)
  function riskAdjusted() { return AtlasLikelihood.adjust(D, SIG, state.risk); }
  function renderLikelihood() {
    const A = riskAdjusted(), tb = document.querySelector("#lik-table tbody");
    const pct = x => (x * 100).toFixed(x < 0.1 ? 1 : 0) + "%";
    tb.innerHTML = A.table.map(r => {
      const ev = r.evidence, po = r.posterior;
      return `<tr><td>${esc(r.name)} <span class="mut small">${esc(r.kind)}</span></td><td class="num">${pct(r.assumed)}</td>
        <td>${ev ? `<span title="${esc(ev.what)}">${ev.n} in ${ev.years.toFixed(1)} yrs</span>${ev.episodes.length ? `<div class="mut small">${ev.episodes.map(e => esc(e.from.slice(0, 7))).join(", ")}</div>` : ""}` : '<span class="mut">no evidence rule</span>'}</td>
        <td class="num">${po ? `${pct(po.p)} <span class="mut small">(${pct(po.lo)}–${pct(po.hi)})</span>` : "—"}</td>
        <td class="num"><b>${pct(r.used)}</b>${r.climateMult && r.climateMult !== 1 ? ` <span class="mut small">×${r.climateMult} climate</span>` : ""}${r.driverForced ? ` <span class="mut small">${esc(r.driverForced)}</span>` : ""}</td></tr>`;
    }).join("");
    el("driver-list").innerHTML = state.risk.correlated ? A.drivers.map(d => `<li><b>${esc(d.name)}</b> — ${Math.round(d.q * 100)}% of years${d.q !== d.qBase ? ` (normally ${Math.round(d.qBase * 100)}%)` : ""}; its events are ${d.m}× as likely in such a year: ${d.events.map(id => esc((D.events.find(e => e.id === id) || { name: id }).name)).join(", ")}.</li>`).join("") : "<li>Off — events are treated as independent.</li>";
    const tot = A.table.reduce((a, r) => a + r.used, 0);
    el("lik-summary").textContent = `${A.table.filter(r => r.evidence).length} of ${A.table.length} events have an evidence rule · expected events per year ${tot.toFixed(2)}`;
  }
  ["lik-source", "lik-climate"].forEach(id => el(id).addEventListener("change", e => {
    state.risk[id === "lik-source" ? "source" : "climate"] = e.target.value; bump("risk-settings"); state.portfolio = null; state.opt = null; renderLikelihood();
  }));
  el("lik-correlated").addEventListener("change", e => { state.risk.correlated = e.target.checked; bump("risk-settings"); state.opt = null; renderLikelihood(); });

  // ------------------------------------------------------------------ worst cases (v4.1)
  el("run-worst").addEventListener("click", () => {
    const btn = el("run-worst"); btn.disabled = true;
    const o = overrides(); delete o.duration;
    AtlasWorstCase.worstCasesAsync(D, currentNet(), state.levers, o, { by: el("worst-by").value }, (i, n) => { btn.textContent = `Simulating… ${i}/${n}`; }, rows => {
      state.worst = rows; bump("worst"); btn.disabled = false; btn.textContent = "Find the worst cases"; renderWorst();
    });
  });
  function renderWorst() {
    const rows = state.worst, out = el("worst-out"); if (!rows) return;
    const by = el("worst-by").value === "lost" ? "lostTeu" : "total";
    const top = rows.slice().sort((a, b) => b[by] - a[by]).slice(0, 10);
    const worseTogether = rows.filter(r => r.interaction > 1).sort((a, b) => b.interaction - a.interaction).slice(0, 3);
    out.innerHTML = `<div class="bf-table-wrap"><table><thead><tr><th>#</th><th>Scenario</th><th class="num">Cost</th><th class="num">Lost TEU</th><th>Families below target</th><th class="num">Worse together by</th><th></th></tr></thead><tbody>
      ${top.map((r, i) => `<tr><td>${i + 1}</td><td>${r.names.map(esc).join(" <b>+</b> ")}</td><td class="num">${fmtMoney(r.total)}</td><td class="num">${fmtInt(r.lostTeu)}</td><td>${r.missing.length ? esc(r.missing.map(n => n.split(" ")[0]).join(", ")) : '<span class="mut">none</span>'}</td><td class="num">${r.interaction > 1 ? fmtMoney(r.interaction) : "—"}</td><td><button type="button" class="btn-link" data-load="${esc(r.ids.join(","))}">Load</button></td></tr>`).join("")}
      </tbody></table></div>
      ${worseTogether.length ? `<p class="narrative"><b>Worse together:</b> ${worseTogether.map(r => `${r.names.map(esc).join(" + ")} costs ${fmtMoney(r.interaction)} more than the two apart`).join("; ")}. Pairs that knock out each other's alternatives are where flexibility pays most. Pairs that hit the same lanes overlap instead, and cost less than the sum.</p>` : ""}
      <p class="mut small">${rows.length} scenarios simulated, each at its typical duration, with the levers currently held.</p>`;
    $$("button[data-load]", out).forEach(b => b.addEventListener("click", () => { state.eventIds = new Set(b.dataset.load.split(",")); state.duration = null; state.tab = "historical"; bump("load-worst"); render(); el("results-panel").scrollIntoView({ behavior: "smooth" }); }));
  }
  el("worst-by").addEventListener("change", () => { if (state.worst) renderWorst(); });

  // ------------------------------------------------------------------ optimiser (v4)
  const LAMBDA = { neutral: 0, balanced: 0.5, tail: 0.9 };
  el("run-optimise").addEventListener("click", () => {
    const btn = el("run-optimise"), o = overrides(), lambda = LAMBDA[el("opt-risk").value] || 0;
    btn.disabled = true; btn.textContent = "Searching…";
    const key = JSON.stringify([state.assume, state.products, state.networkSource, state.fromLive, lambda, state.risk]);
    const A = riskAdjusted();
    AtlasOptimise.optimiseAsync(A.data, currentNet(), o, { lambda, strata: 3, years: 4000, drivers: A.drivers },
      pr => { btn.textContent = `Searching… ${pr.evaluations} portfolios`; },
      res => { state.opt = res; state.optKey = key; bump("optimise"); btn.disabled = false; btn.textContent = "Optimise lever amounts"; renderOptimise(); });
  });
  function amountText(v, val) {
    if (v.key === "controlTower") return val ? "on" : "off";
    if (v.unit === "share") return Math.round(val * 100) + "%";
    if (v.unit === "days") return val + " days";
    return fmtInt(val) + " " + v.unit;
  }
  function renderOptimise() {
    const R = state.opt, out = el("opt-out"); if (!R || !R.best) return;
    const b = R.best, n = R.none, vars = R.vars;
    const partKey = v => v.key.indexOf("stock:") === 0 ? "buffer" : ({ hedgeCoverage: "rateHedge", controlTower: "controlTower", dualSourceCap: "dualSource", airCapPerDc: "airBridge", gatewayBoost: "gateways" })[v.key];
    const rows = vars.map((v, i) => ({ v, val: v.levels[b.x[i]] })).filter(r => r.val);
    out.innerHTML = `
      <div class="tiles">
        <div class="tile"><span>Annual cost of risk, nothing held</span><b>${fmtMoney(n.total)}</b></div>
        <div class="tile"><span>With the recommendation</span><b>${fmtMoney(b.total)}</b></div>
        <div class="tile"><span>Worst-10% years (CVaR 90%)</span><b>${fmtMoney(n.cvar90)} → ${fmtMoney(b.cvar90)}</b></div>
        <div class="tile"><span>Portfolios evaluated</span><b>${R.evaluations}</b></div>
      </div>
      <div class="grid2">
        <div>
          <h3 class="sub-h">Recommended amounts${R.lambda ? ` (risk weight ${R.lambda})` : " (expected cost)"}</h3>
          <div class="bf-table-wrap"><table><thead><tr><th>Lever</th><th class="num">Amount</th></tr></thead><tbody>
          ${rows.length ? rows.map(r => `<tr><td>${esc(r.v.label)}</td><td class="num">${esc(amountText(r.v, r.val))}</td></tr>`).join("") : '<tr><td colspan="2">Hold nothing — no option pays for itself here.</td></tr>'}
          </tbody><tfoot><tr><td><b>Annual cost of the options</b></td><td class="num"><b>${fmtMoney(b.premium)}</b></td></tr>
          <tr><td>Expected annual loss</td><td class="num">${fmtMoney(n.eal)} → ${fmtMoney(b.eal)}</td></tr></tfoot></table></div>
          <button type="button" id="apply-opt" class="btn-primary" ${rows.length ? "" : "disabled"}>Apply to the scenario</button>
          <p class="mut small">Scored on every library event at three duration quantiles and ${fmtInt(4000)} sampled years, using ${state.risk.source === "data" ? "data-informed" : "stated"} likelihoods, ${esc(((D.climate || {})[state.risk.climate] || {}).name || "today's climate")}${state.risk.correlated ? ", correlated events" : ", independent events"}. Recommendations are only as good as the event likelihoods and the costs you've set.</p>
        </div>
        <figure class="chart-card"><figcaption><b>Cost of protection vs bad-year risk</b><span>Each dot is a portfolio the search evaluated; the line joins the efficient ones</span></figcaption><div id="opt-chart" class="chart"></div></figure>
      </div>`;
    el("apply-opt").addEventListener("click", applyOptimised);
    frontierChart(R);
  }
  function frontierChart(R) {
    const box = el("opt-chart"), pts = R.points, fr = AtlasOptimise.frontier(pts);
    const W = 560, H = 260, padL = 64, padR = 20, padT = 14, padB = 40;
    const xmax = Math.max(...pts.map(p => p.premium)) * 1.05 || 1, ymax = Math.max(...pts.map(p => p.cvar90)) * 1.05 || 1;
    const X = v => padL + v / xmax * (W - padL - padR), Y = v => padT + (1 - v / ymax) * (H - padT - padB);
    let g = "";
    for (let k = 0; k <= 4; k++) { const y = Y(ymax * k / 4); g += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="g-grid"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end" class="ax">${fmtMoney(ymax * k / 4)}</text>`; }
    for (let k = 0; k <= 4; k++) { const x = X(xmax * k / 4); g += `<text x="${x}" y="${H - 22}" text-anchor="middle" class="ax">${fmtMoney(xmax * k / 4)}</text>`; }
    g += `<text x="${(padL + W - padR) / 2}" y="${H - 6}" text-anchor="middle" class="ax">Annual cost of the options held →</text>`;
    g += `<text x="12" y="${padT + 4}" class="ax" transform="rotate(-90 12 ${padT + 4})" text-anchor="end">Worst-10% annual loss (CVaR 90%)</text>`;
    g += `<path d="${fr.map((p, i) => `${i ? "L" : "M"}${X(p.premium).toFixed(1)},${Y(p.cvar90).toFixed(1)}`).join("")}" fill="none" style="stroke:var(--s1)" stroke-width="2"/>`;
    const tip = p => `<b>${fmtMoney(p.premium)}/yr of options</b><br>Expected loss ${fmtMoney(p.eal)}<br>Worst-10% years ${fmtMoney(p.cvar90)}<br>Total cost of risk ${fmtMoney(p.total)}`;
    pts.forEach(p => { g += `<circle cx="${X(p.premium)}" cy="${Y(p.cvar90)}" r="4" class="hov" style="fill:var(--ink-soft);opacity:0.55" data-tip="${esc(tip(p))}"/>`; });
    fr.forEach(p => { g += `<circle cx="${X(p.premium)}" cy="${Y(p.cvar90)}" r="5" class="hov" style="fill:var(--s1);stroke:var(--panel-2);stroke-width:2" data-tip="${esc(tip(p))}"/>`; });
    const b = R.best, n = R.none;
    g += `<circle cx="${X(b.premium)}" cy="${Y(b.cvar90)}" r="8" style="fill:none;stroke:var(--s2)" stroke-width="2.5"/><text x="${X(b.premium) + 11}" y="${Y(b.cvar90) - 8}" class="lbl">recommended</text>`;
    g += `<text x="${X(n.premium) + 8}" y="${Y(n.cvar90) + 4}" class="lbl">nothing held</text>`;
    box.innerHTML = svgEl(W, H, g, "Frontier of option cost against bad-year risk");
    wireBarTips(box);
    addTable(box, ["Option cost / yr", "Expected loss", "Worst-10% years", "Efficient"], pts.slice().sort((a, b) => a.premium - b.premium).map(p => [fmtMoney(p.premium), fmtMoney(p.eal), fmtMoney(p.cvar90), fr.indexOf(p) >= 0 ? "yes" : ""]));
  }
  function applyOptimised() {
    const b = state.opt && state.opt.best; if (!b) return;
    const lv = b.levers;
    state.levers = Object.assign({ buffer: 0, bufferScope: "all" }, {
      bufferByFamily: lv.bufferByFamily, hedgeCoverage: lv.hedgeCoverage, dualSourceCap: lv.dualSourceCap, airCapPerDc: lv.airCapPerDc, gatewayBoost: lv.gatewayBoost,
      controlTower: !!lv.controlTower, rateHedge: lv.hedgeCoverage > 0, dualSource: lv.dualSourceCap > 0, airBridge: lv.airCapPerDc > 0, gateways: lv.gatewayBoost > 0
    });
    bump("apply-opt"); render();
    el("panel-levers").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function hasAmounts() { const l = state.levers; return !!(l.bufferByFamily || l.hedgeCoverage != null || l.dualSourceCap != null || l.airCapPerDc != null || l.gatewayBoost != null); }
  function clearAmounts(k) {
    const map = { rateHedge: "hedgeCoverage", dualSource: "dualSourceCap", airBridge: "airCapPerDc", gateways: "gatewayBoost", buffer: "bufferByFamily" };
    if (k && map[k]) delete state.levers[map[k]];
  }

  function leverLabel(lv, buf) {
    const xs = [];
    if (lv.buffer) xs.push(`+${buf} d stock${lv.bufferScope === "critical" ? " (critical families)" : ""}`);
    LEVER_BOOL.forEach(k => { if (lv[k]) xs.push(D.levers[k].name.replace(/ \(.*\)/, "")); });
    return xs.length ? xs.join(" + ") : "No levers (accept the risk)";
  }
  function renderPortfolio() {
    const P = state.portfolio, out = el("portfolio-out");
    if (!P) return;
    const rows = P.rows, best = rows[0], none = rows.find(r => !r.levers.buffer && LEVER_BOOL.every(k => !r.levers[k]));
    // marginal value of each lever on its own (vs none)
    const single = ["buffer"].concat(LEVER_BOOL).map(k => {
      const r = rows.find(x => (k === "buffer" ? x.levers.buffer : x.levers[k]) && ["buffer"].concat(LEVER_BOOL).filter(j => j !== k).every(j => !(j === "buffer" ? x.levers.buffer : x.levers[j])));
      return { k, name: k === "buffer" ? `+${P.buffer} days safety stock${P.scope === "critical" ? " (critical families)" : ""}` : D.levers[k].name, premium: r.premium, ealCut: none.eal - r.eal, net: none.total - r.total };
    });
    const top = rows.slice(0, 8);
    out.innerHTML = `
      <div class="tiles">
        <div class="tile"><span>Expected annual loss, no levers</span><b>${fmtMoney(none.eal)}</b></div>
        <div class="tile"><span>Best portfolio</span><b class="small-b">${esc(leverLabel(best.levers, P.buffer))}</b></div>
        <div class="tile"><span>Its net value vs none</span><b>${fmtMoney(best.netValue, true)}/yr</b></div>
      </div>
      <h3 class="sub-h">Each lever on its own</h3>
      <div class="bf-table-wrap"><table><thead><tr><th>Lever</th><th class="num">Annual cost</th><th class="num">Cuts expected loss by</th><th class="num">Net value / yr</th><th>Verdict</th></tr></thead><tbody>
      ${single.map(s => `<tr><td>${esc(s.name)}</td><td class="num">${fmtMoney(s.premium)}</td><td class="num">${fmtMoney(s.ealCut)}</td><td class="num">${fmtMoney(s.net, true)}</td><td>${s.net > 0 ? '<span class="pill good">✓ pays for itself</span>' : '<span class="pill warning">✕ costs more than it saves</span>'}</td></tr>`).join("")}
      </tbody></table></div>
      <h3 class="sub-h">Best combinations (of 64)</h3>
      <div class="bf-table-wrap"><table><thead><tr><th>#</th><th>Levers held</th><th class="num">Expected annual loss</th><th class="num">Option cost / yr</th><th class="num">Total cost of risk</th><th class="num">Net value vs none</th></tr></thead><tbody>
      ${top.map((r, i) => `<tr${i === 0 ? ' class="active-row"' : ""}><td>${i + 1}</td><td>${esc(leverLabel(r.levers, P.buffer))}</td><td class="num">${fmtMoney(r.eal)}</td><td class="num">${fmtMoney(r.premium)}</td><td class="num">${fmtMoney(r.total)}</td><td class="num">${fmtMoney(r.netValue, true)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="mut small">Where the expected loss comes from (no levers): ${none.byEvent.sort((a, b) => b.eal - a.eal).slice(0, 4).map(e => `${esc(e.name)} ${fmtMoney(e.eal)}/yr`).join(" · ")}. Likelihoods are stated assumptions on each event's Details card.</p>`;
  }

  // ------------------------------------------------------------------ hidden dependencies (v5.1)
  function renderDeps() {
    const tb = document.querySelector("#deps-table tbody"), net = currentNet(), res = state.result;
    if (!tb) return;
    if (!net.suppliers || !net.suppliers.length) { tb.innerHTML = `<tr><td colspan="6" class="mut">This network has no tier-2/3 suppliers defined — add them with a suppliers CSV (Network panel).</td></tr>`; return; }
    const avail = res ? M.effectiveSupply(net, res.prep.cond.supply, res.prep.cond.suppliers || {}).suppliers : {};
    const near = {}; ALERTS.forEach(a => (a.nearby || []).forEach(n => { if (/supplier/.test(n.kind)) near[n.name] = (near[n.name] || []).concat([a.name]); }));
    tb.innerHTML = (res ? res.supplierExposure : []).map(s => {
      const a = avail[s.id] == null ? 1 : avail[s.id];
      return `<tr class="clickable" data-sup="${esc(s.id)}"><td>${esc(s.name)}</td><td>Tier ${s.tier}</td><td>${esc(s.what)}</td><td class="num"><b>${Math.round(s.share * 100)}%</b> <span class="mut small">${fmtInt(s.teuWeek)} TEU/wk</span></td>
        <td class="num">${s.factories.length}</td><td>${a < 0.999 ? `<span class="pill critical">${Math.round(a * 100)}% output</span>` : '<span class="pill good">normal</span>'}${near[s.name] ? ` <span class="pill warning" title="${esc(near[s.name].join("; "))}">alert nearby</span>` : ""}</td></tr>`;
    }).join("");
  }
  document.querySelector("#deps-table tbody").addEventListener("click", e => { const tr = e.target.closest("tr[data-sup]"); if (tr) showInfo({ kind: "supplier", id: tr.dataset.sup }); });

  const BRIEF_KEY = "atlas-brief-seen-v1";
  let briefPrev = null, briefNow = SIG ? AtlasBrief.summarise(SIG) : null, briefData = null;
  try { briefPrev = JSON.parse(localStorage.getItem(BRIEF_KEY) || "null"); } catch (e) { briefPrev = null; }
  function renderBrief() {
    const box = el("brief-out"); if (!box) return;
    const res = state.result, net = currentNet(), chokeIds = {}, portFlow = {}, portNames = {};
    Object.keys(Sea.CHOKES).forEach(w => { chokeIds[w] = Sea.CHOKES[w].portwatch; });
    if (res) res.prep.base.paths.forEach(pt => { if (!pt.short && pt.service) { [pt.service.from, pt.service.to].forEach(c => { portFlow[c] = (portFlow[c] || 0) + pt.flow; portNames[c] = portName(c); }); } });
    briefData = AtlasBrief.compare(briefPrev, briefNow, { exposure: res ? res.exposure : [], chokeIds, portFlow, portNames, alerts: ALERTS });
    const icon = { critical: "●", warning: "●", good: "●", info: "●" };
    el("brief-sub").textContent = briefData.first ? `Today's picture · live data to ${briefData.asOf}` : `Changes since your last visit (data to ${briefData.since}) · now ${briefData.asOf}`;
    box.innerHTML = `<ul class="brief-list">${briefData.items.slice(0, 8).map(i => `<li class="lv-${i.level}"><span class="brief-dot" aria-hidden="true">${icon[i.level]}</span><span class="sr-only">${i.level}: </span>${esc(i.text)}</li>`).join("")}</ul>`;
  }
  el("brief-download").addEventListener("click", () => { if (briefData) { download("atlas-brief.md", AtlasBrief.markdown(briefData, "Disruption brief — " + (currentNet().name || "network")), "text/markdown"); bump("brief"); } });

  // ------------------------------------------------------------------ live monitor
  function renderLive() {
    const tb = document.querySelector("#choke-table tbody");
    if (!SIG) { tb.innerHTML = `<tr><td colspan="6" class="mut">Live snapshot unavailable.</td></tr>`; return; }
    const exp = {}; (state.result ? state.result.exposure : []).forEach(x => { exp[x.wp] = x; });
    const rows = Object.values(Sea.CHOKES).map(c => ({ c, live: SIG.chokepoints[c.portwatch] })).filter(r => r.live).sort((a, b) => a.live.ratio - b.live.ratio);
    if (!state.chokeSel) state.chokeSel = rows.length ? rows[0].c.portwatch : null;
    tb.innerHTML = rows.map(({ c, live }) => {
      const st = chokeStatus(live), e = exp[c.wp];
      return `<tr class="clickable${state.chokeSel === c.portwatch ? " active-row" : ""}" data-pw="${c.portwatch}"><td>${esc(c.name)}${live.stale ? ' <span class="mut">(stale)</span>' : ""}</td><td class="num">${live.last7.container.toFixed(1)}</td><td class="num">${live.baseline.container.toFixed(1)}</td><td class="num">${Math.round(live.ratio * 100)}%</td><td><span class="pill ${st.cls}">${st.label}</span></td><td class="num">${e ? Math.round(e.share * 100) + "%" : "—"}</td></tr>`;
    }).join("");
    // ports this network uses
    const pt = document.querySelector("#port-table tbody");
    const netPorts = AtlasAlerts.networkPorts(currentNet()).map(p => ({ p, live: portLive(p.code) })).filter(r => r.live)
      .sort((a, b) => (a.live.ratio == null ? 9 : a.live.ratio) - (b.live.ratio == null ? 9 : b.live.ratio));
    const pflow = {};
    if (state.result) state.result.prep.base.paths.forEach(x => { if (!x.short && x.service) { pflow[x.service.from] = (pflow[x.service.from] || 0) + x.flow; pflow[x.service.to] = (pflow[x.service.to] || 0) + x.flow; } });
    pt.innerHTML = netPorts.length ? netPorts.map(({ p, live }) => {
      const st = portStatus(live), key = "port:" + p.code;
      return `<tr class="clickable${state.chokeSel === key ? " active-row" : ""}" data-pw="${key}"><td>${esc(p.name)}${live.stale ? ' <span class="mut">(stale)</span>' : ""}</td><td class="num">${live.last14.toFixed(1)}</td><td class="num">${live.baseline.toFixed(1)}</td><td class="num">${live.ratio == null ? "—" : Math.round(live.ratio * 100) + "%"}</td><td><span class="pill ${st.cls}">${st.label}</span></td><td class="num">${pflow[p.code] ? fmtInt(pflow[p.code]) : "—"}</td></tr>`;
    }).join("") : `<tr><td colspan="6" class="mut">No live port data for this network's ports.</td></tr>`;
    if (state.chokeSel && state.chokeSel.indexOf("port:") === 0) {
      const code = state.chokeSel.slice(5), lp = portLive(code), name = portName(code);
      if (lp) {
        const t0 = Date.parse(lp.weekStart + "T00:00:00Z"), wkDate = i => new Date(t0 + (i * 7 + 6) * 864e5).toISOString().slice(0, 10);
        let last = 0; const vals = lp.weekly.map(v => (v == null ? last : (last = v)));
        el("choke-chart-title").textContent = name + " — weekly container port calls";
        lineChart("choke-chart", [{ name, short: "", color: SERIES[0], values: vals }],
          { yFmt: (v, t) => t ? v.toFixed(1) + " calls/day" : v.toFixed(0), xFmt: i => (i === 0 || i === vals.length - 1 ? "w/e " + wkDate(i) : wkDate(i).slice(0, 7)), xTicks: [0, Math.round((vals.length - 1) / 3), Math.round(2 * (vals.length - 1) / 3), vals.length - 1], ref: lp.baseline, refLabel: "normal", label: name + " port calls",
            table: { headers: ["Week ending", "Container calls/day"], rows: lp.weekly.map((v, i) => [wkDate(i), v == null ? "no data" : v.toFixed(1)]).reverse() } });
      }
    }
    const sel = SIG.chokepoints[state.chokeSel];
    if (sel) {
      const wk = sel.weekly;
      el("choke-chart-title").textContent = sel.name + " — weekly container transits";
      const step = Math.max(1, Math.floor(wk.length / 6)), ticks = []; for (let i = 0; i < wk.length; i += step) ticks.push(i); if (ticks[ticks.length - 1] !== wk.length - 1) ticks.push(wk.length - 1);
      lineChart("choke-chart", [{ name: sel.name, short: "", color: SERIES[0], values: wk.map(w => w[1]) }],
        { yFmt: (v, t) => t ? v.toFixed(1) + " ships/day" : v.toFixed(0), xFmt: i => wk[i] ? (i === 0 || i === wk.length - 1 ? "w/e " + wk[i][0] : wk[i][0].slice(0, 7)) : "", xTicks: [0, Math.round((wk.length - 1) / 3), Math.round(2 * (wk.length - 1) / 3), wk.length - 1], ref: sel.baseline.container, refLabel: "normal", label: sel.name + " transits",
          table: { headers: ["Week ending", "Container ships/day", "All ships/day"], rows: wk.slice().reverse().map(w => [w[0], w[1].toFixed(1), w[2].toFixed(1)]) } });
    }
    el("live-asof").textContent = `Snapshot ${SIG.generated.slice(0, 10)} · PortWatch data to ${Object.values(SIG.chokepoints)[0] ? Object.values(SIG.chokepoints)[0].asOf : "?"}`;
    const ht = document.querySelector("#hazard-table tbody");
    const hz = liveHazards();
    ht.innerHTML = hz.length ? hz.slice().sort((a, b) => b.from.localeCompare(a.from)).map(h => {
      const near = nearestNode(h.lat, h.lng), al = alertFor(h), on = al && state.eventIds.has(al.id);
      return `<tr><td>${esc(h.from)}</td><td>${esc(h.src)}</td><td>${esc(h.alert || "—")}</td><td><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.name.length > 80 ? h.name.slice(0, 78) + "…" : h.name)}</a></td><td class="num">${near ? `${esc(near.name)} · ${fmtInt(near.km)} km` : "—"}</td><td>${al ? `<button type="button" class="btn-link" data-alert="${esc(al.id)}">${on ? "Modelled ✓" : "Model this"}</button>` : '<span class="mut small">too far</span>'}</td></tr>`;
    }).join("") : `<tr><td colspan="6" class="mut">No orange/red alerts in the window.</td></tr>`;
  }
  ["#choke-table tbody", "#port-table tbody"].forEach(sel => document.querySelector(sel).addEventListener("click", e => { const tr = e.target.closest("tr[data-pw]"); if (!tr) return; state.chokeSel = tr.dataset.pw; bump("choke-chart"); renderLive(); }));
  document.querySelector("#hazard-table tbody").addEventListener("click", e => {
    const b = e.target.closest("button[data-alert]"); if (!b) return;
    if (state.eventIds.has(b.dataset.alert)) toggleEvent(b.dataset.alert, false); else modelAlert(b.dataset.alert);
  });

  // ------------------------------------------------------------------ lanes table
  el("lane-search").addEventListener("input", e => { state.laneQ = e.target.value; renderLanes(); });
  el("lane-affected-only").addEventListener("change", e => { state.laneAffectedOnly = e.target.checked; renderLanes(); });
  function renderLanes() {
    const res = state.result, tb = document.querySelector("#lanes-table tbody");
    if (!res) { tb.innerHTML = ""; return; }
    const bs = {}; res.prep.base.services.forEach(s => { bs[s.id] = s; });
    const fl = svcFlows(res.prep.dis), q = state.laneQ.trim().toLowerCase();
    const rows = res.prep.dis.services.map(s => {
      const b = bs[s.id], st = serviceStatus(s, b);
      const via = ((s.ok ? s.chokes : b && b.chokes) || []).map(w => Sea.CHOKES[w].name).join(", ") || "open ocean";
      return { s, b, st, via, name: `${portName(s.from)} → ${portName(s.to)}` };
    }).filter(r => (!state.laneAffectedOnly || r.st !== "normal") && (!q || (r.name + " " + r.via + " " + (D.trades[r.s.trade] || "") + " " + r.s.from + " " + r.s.to).toLowerCase().includes(q)));
    const LBL = { normal: ["Normal", "good"], reroute: ["Rerouted", "info"], squeezed: ["Squeezed", "warning"], cut: ["Cut", "critical"] };
    tb.innerHTML = rows.length ? rows.map(r => `<tr class="clickable" data-svc="${esc(r.s.id)}"><td>${esc(r.name)}</td><td>${esc(D.trades[r.s.trade] || r.s.trade || "—")}</td><td>${esc(r.via)}</td><td class="num">${r.b && Number.isFinite(r.b.days) ? r.b.days.toFixed(1) : "—"}</td><td class="num">${r.s.ok ? r.s.days.toFixed(1) : "—"}</td><td class="num">${r.s.ok ? fmtInt(r.s.cap) : 0}</td><td class="num">${r.s.ok ? fmtInt(r.s.rate + r.s.uplift) : "—"}</td><td class="num">${fmtInt(fl[r.s.id] || 0)}</td><td><span class="pill ${LBL[r.st][1]}">${LBL[r.st][0]}</span></td></tr>`).join("")
      : `<tr><td colspan="9" class="mut">No services match.</td></tr>`;
  }
  document.querySelector("#lanes-table tbody").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-svc]"); if (!tr || !state.result) return;
    const s = state.result.prep.dis.services.find(x => x.id === tr.dataset.svc); if (s) showInfo({ kind: "service", svc: s });
  });

  // ------------------------------------------------------------------ platform (v5): modal helper
  function openModal(title, html, onReady) {
    let m = el("app-modal");
    if (!m) { m = document.createElement("div"); m.id = "app-modal"; m.className = "tut-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); document.body.appendChild(m);
      m.addEventListener("click", e => { if (e.target === m) closeModal(); }); document.addEventListener("keydown", e => { if (e.key === "Escape" && !m.hidden) closeModal(); }); }
    m.innerHTML = `<div class="tut-card app-card"><div class="tut-top"><h2>${esc(title)}</h2><button class="tut-x" type="button" aria-label="Close">×</button></div>${html}</div>`;
    m.hidden = false; m.querySelector(".tut-x").addEventListener("click", closeModal);
    if (onReady) onReady(m);
  }
  function closeModal() { const m = el("app-modal"); if (m) m.hidden = true; }

  // ------------------------------------------------------------------ shipment-history import (v5)
  let shipParsed = null;
  function openShipmentWizard(text, fileName) {
    shipParsed = text ? AtlasShipments.parse(text) : null;
    const fields = [["date", "Ship date (optional)"], ["origin", "Origin / supplier / factory"], ["destination", "Destination / DC"], ["pol", "Port of loading"], ["pod", "Port of discharge"],
      ["teu", "Volume (TEU, or FEU)"], ["product", "Product family (optional)"], ["originLat", "Origin latitude (optional)"], ["originLng", "Origin longitude (optional)"], ["destLat", "DC latitude (optional)"], ["destLng", "DC longitude (optional)"]];
    const guess = shipParsed ? AtlasShipments.detect(shipParsed.headers) : {};
    const opts = h => `<option value="">— none —</option>` + (shipParsed ? shipParsed.headers.map(x => `<option${x === h ? " selected" : ""}>${esc(x)}</option>`).join("") : "");
    openModal("Build a network from shipment history", `
      <p class="tut-lead">Export shipments from your ERP or TMS — one row per shipment or container — and the Atlas builds the network: factories, DCs with their product mix, matched ports, sea lanes and inland legs. Files stay in your browser.</p>
      <div class="btn-row tight"><label class="field-label" style="margin:0">Shipment file (CSV, TSV or semicolon)<input type="file" id="ship-file" accept=".csv,.tsv,.txt,text/csv"></label>
        <button type="button" class="btn-link" id="ship-sample">Use a sample export</button><button type="button" class="btn-link" id="ship-sample-dl">Download the sample</button></div>
      ${shipParsed ? `<p class="mut small">${esc(fileName || "file")}: ${fmtInt(shipParsed.rows.length)} rows, ${shipParsed.headers.length} columns. Check the mapping — the Atlas guessed from the column names.</p>
      <div class="ship-map">${fields.map(([k, label]) => `<label>${esc(label)}<select data-f="${k}">${opts(guess[k])}</select></label>`).join("")}
        <label>Volume unit<select data-f="teuFactor"><option value="1"${guess.teuFactor === 2 ? "" : " selected"}>TEU</option><option value="2"${guess.teuFactor === 2 ? " selected" : ""}>FEU (×2)</option></select></label></div>
      <div id="ship-preview" class="ship-preview"></div>
      <div class="tut-nav"><span class="tut-grow"></span><button type="button" class="tut-btn primary" id="ship-build">Build the network</button></div>` : ""}`, m => {
      el("ship-file").addEventListener("change", e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => openShipmentWizard(String(rd.result), f.name); rd.readAsText(f); });
      el("ship-sample").addEventListener("click", () => openShipmentWizard(sampleShipments(), "sample-shipments.csv"));
      el("ship-sample-dl").addEventListener("click", () => download("atlas-sample-shipments.csv", sampleShipments()));
      if (!shipParsed) return;
      const mapping = () => { const mp = {}; $$("select[data-f]", m).forEach(sel => { if (sel.dataset.f === "teuFactor") mp.teuFactor = +sel.value; else if (sel.value) mp[sel.dataset.f] = sel.value; }); return mp; };
      const preview = () => {
        const b = AtlasShipments.build(shipParsed, mapping(), {});
        el("ship-preview").innerHTML = b.network ? `<p><b>${fmtInt(b.stats.used)}</b> of ${fmtInt(b.stats.rows)} rows used · ${fmtInt(b.stats.teu)} TEU over ${b.stats.weeks} weeks → <b>${b.stats.factories}</b> origins, <b>${b.stats.dcs}</b> DCs, <b>${b.stats.lanes}</b> sea lanes${b.stats.products > 1 ? `, <b>${b.stats.products}</b> product families` : ""}.</p>${b.warnings.map(w => `<p class="error small">${esc(w)}</p>`).join("")}<p class="mut small">Capacities are set 25–30% above observed volumes; ocean rates and inland days are distance-based estimates. Edit families' values and targets in the Product families panel afterwards.</p>`
          : b.warnings.map(w => `<p class="error small">${esc(w)}</p>`).join("");
        el("ship-build").disabled = !b.network;
        return b;
      };
      $$("select[data-f]", m).forEach(sel => sel.addEventListener("change", preview));
      preview();
      el("ship-build").addEventListener("click", () => {
        const b = preview(); if (!b.network) return;
        b.network.name = (fileName || "Shipment history").replace(/\.[a-z]+$/i, "") + " (from shipments)";
        state.customNet = b.network; state.customRaw = { nodes: null, lanes: null, shipments: true }; state.networkSource = "custom"; el("network-source").value = "custom";
        state.products = {}; state.portfolio = null; state.mc = null; state.opt = null; state.worst = null;
        el("network-status").textContent = `Built from ${fmtInt(b.stats.used)} shipments: ${b.stats.factories} origins, ${b.stats.dcs} DCs, ${b.stats.lanes} sea lanes.`; el("network-status").className = "narrative success";
        bump("shipments-built"); closeModal(); render(); renderFamilies();
        const pts = b.network.factories.concat(b.network.dcs);
        world.pointOfView({ lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length, altitude: 2.4 }, 1200);
      });
    });
  }
  function sampleShipments() {
    const base = M.evaluate(D.network, M.conditions([]), {}, M.params(D)), names = {};
    D.products.forEach(p => { names[p.id] = p.name; });
    return AtlasShipments.sampleCsv(D.network, base, 26, names);
  }
  el("open-shipments").addEventListener("click", () => openShipmentWizard(null));

  // ------------------------------------------------------------------ workspaces (v5): saved in this browser, shareable as files
  const WS_KEY = "atlas-workspaces-v1";
  function wsList() { try { return JSON.parse(localStorage.getItem(WS_KEY) || "[]") || []; } catch (e) { return []; } }
  function wsStore(list) { try { localStorage.setItem(WS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  function snapshotState(name, notes) {
    return { atlasWorkspace: 1, appVersion: APP_VERSION, name, notes: notes || "", saved: new Date().toISOString(),
      state: { eventIds: [...state.eventIds], fromLive: state.fromLive, duration: state.duration, levers: state.levers, assume: state.assume, products: state.products, risk: state.risk,
        networkSource: state.networkSource, customNet: state.networkSource === "custom" ? state.customNet : null, customRaw: state.customRaw, projection: state.projection, customEvents: state.customEvents } };
  }
  function restoreState(ws) {
    const s2 = ws.state || {};
    state.eventIds = new Set(s2.eventIds || []); state.fromLive = !!s2.fromLive; state.duration = s2.duration || null;
    state.levers = Object.assign({ buffer: 0, bufferScope: "all" }, s2.levers || {}); state.assume = Object.assign({}, DEFAULT_ASSUME, s2.assume || {});
    state.products = s2.products || {}; state.risk = Object.assign({ source: "assumed", climate: "today", correlated: true }, s2.risk || {});
    state.customNet = s2.customNet || null; state.customRaw = s2.customRaw || { nodes: null, lanes: null };
    state.customEvents = s2.customEvents || []; refreshDynamicEvents(true);
    state.networkSource = s2.networkSource === "custom" && state.customNet ? "custom" : "sample"; el("network-source").value = state.networkSource;
    Object.keys(DEFAULT_ASSUME).forEach(k => { const i = el("a-" + k); if (i) i.value = state.assume[k]; });
    el("lik-source").value = state.risk.source; el("lik-climate").value = state.risk.climate; el("lik-correlated").checked = state.risk.correlated;
    state.mc = null; state.portfolio = null; state.opt = null; state.worst = null;
    const f = activeEvents()[0]; if (f) state.tab = f.kind === "alert" ? "live" : f.kind;
    render(); renderFamilies(); renderLikelihood();
    if (s2.projection && s2.projection !== state.projection) setProjection(s2.projection);
  }
  function openWorkspaces() {
    const list = wsList();
    openModal("Workspaces", `
      <p class="tut-lead">A workspace saves everything you've set up — network (including imported ones), scenario, levers, families, assumptions and likelihood settings — under a name. They're kept in this browser; <b>export</b> one to a file to share it with a colleague or keep it with a project.</p>
      <div class="ws-save"><input type="text" id="ws-name" placeholder="Workspace name, e.g. Q4 Red Sea review" maxlength="80"><input type="text" id="ws-notes" placeholder="Notes (optional)" maxlength="300"><button type="button" class="tut-btn primary" id="ws-save">Save current</button></div>
      <div class="bf-table-wrap"><table class="ws-table"><thead><tr><th>Name</th><th>Saved</th><th>Network · scenario</th><th></th></tr></thead><tbody>
      ${list.length ? list.map((w, i) => `<tr><td><b>${esc(w.name)}</b>${w.notes ? `<div class="mut small">${esc(w.notes)}</div>` : ""}</td><td class="mut small">${esc((w.saved || "").slice(0, 16).replace("T", " "))}</td>
        <td class="small">${esc(w.state.customNet ? w.state.customNet.name || "custom network" : "sample network")} · ${esc((w.state.eventIds || []).join(", ") || "baseline")}</td>
        <td class="ws-actions"><button type="button" class="btn-link" data-ws-load="${i}">Load</button><button type="button" class="btn-link" data-ws-export="${i}">Export</button><button type="button" class="btn-link warn" data-ws-del="${i}">Delete</button></td></tr>`).join("")
        : '<tr><td colspan="4" class="mut">No saved workspaces yet.</td></tr>'}
      </tbody></table></div>
      <div class="btn-row"><label class="field-label" style="margin:0">Import a workspace file<input type="file" id="ws-import" accept=".json,application/json"></label></div>
      <p id="ws-msg" class="narrative"></p>`, m => {
      const msg = t => { el("ws-msg").textContent = t; };
      el("ws-save").addEventListener("click", () => {
        const name = el("ws-name").value.trim() || "Workspace " + new Date().toISOString().slice(0, 16).replace("T", " ");
        const l = wsList().filter(w => w.name !== name); l.unshift(snapshotState(name, el("ws-notes").value.trim()));
        if (!wsStore(l)) { msg("This browser won't store workspaces here (private mode or storage blocked) — use Export instead."); return; }
        bump("ws-save"); openWorkspaces();
      });
      $$("[data-ws-load]", m).forEach(b => b.addEventListener("click", () => { restoreState(wsList()[+b.dataset.wsLoad]); bump("ws-load"); closeModal(); }));
      $$("[data-ws-export]", m).forEach(b => b.addEventListener("click", () => { const w = wsList()[+b.dataset.wsExport]; download((w.name || "workspace").replace(/[^\w-]+/g, "_") + ".atlas.json", JSON.stringify(w, null, 2), "application/json"); bump("ws-export"); }));
      $$("[data-ws-del]", m).forEach(b => b.addEventListener("click", () => { const l = wsList(); l.splice(+b.dataset.wsDel, 1); wsStore(l); openWorkspaces(); }));
      el("ws-import").addEventListener("change", e => {
        const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
        rd.onload = () => { try { const w = JSON.parse(String(rd.result)); if (!w.atlasWorkspace || !w.state) throw new Error("not an Atlas workspace file"); const l = wsList().filter(x => x.name !== w.name); l.unshift(w); wsStore(l); restoreState(w); bump("ws-load"); closeModal(); } catch (err) { msg("Couldn't import: " + err.message); } };
        rd.readAsText(f);
      });
    });
  }
  el("open-workspaces").addEventListener("click", openWorkspaces);

  // ------------------------------------------------------------------ steering-committee report (v5)
  function svgOf(id) { const s = el(id) && el(id).querySelector("svg"); return s ? s.outerHTML : ""; }
  function buildReport() {
    const r = state.result, evs = activeEvents(); if (!r) return null;
    const net = currentNet(), today = new Date().toISOString().slice(0, 10), snap = SIG ? Object.values(SIG.chokepoints)[0].asOf : "n/a";
    const lv = M.leverAnnualCost(D, net, state.levers, M.params(D, overrides()));
    const leverRows = Object.keys(lv.parts).map(k => `<tr><td>${esc(k === "buffer" ? "Extra safety stock" : (D.levers[k] || { name: k }).name)}</td><td class="num">${fmtMoney(lv.parts[k])}/yr</td></tr>`).join("") || '<tr><td colspan="2">No options held</td></tr>';
    const fam = (r.products || []).map(f => `<tr><td>${esc(f.name)}</td><td class="num">${(f.worst4w * 100).toFixed(1)}%</td><td class="num">${Math.round(f.target * 100)}%</td><td class="num">${fmtInt(f.lostTeu)}</td><td>${f.meets ? "on target" : "<b>below target</b>"}</td></tr>`).join("");
    const dcs = r.dcs.map(d => `<tr><td>${esc(d.name)}</td><td class="num">${d.tts === null ? "&gt; " + r.ttr + " d" : "day " + d.tts}</td><td class="num">${fmtInt(d.lostTeu)}</td></tr>`).join("");
    const comp = Object.keys(r.comps).filter(k => Math.abs(r.comps[k]) >= 1).map(k => `<tr><td>${esc({ surcharge: "Freight-rate surcharges", freight: "Ocean freight (distance)", inland: "Road / rail / barge", carrying: "Inventory in transit and delays", production: "Production (source shift)", air: "Air freight", lostMargin: "Lost sales" }[k] || k)}</td><td class="num">${fmtMoney(r.comps[k], true)}</td></tr>`).join("");
    const mc = state.mc && state.mcKey === scenarioKey() ? `<h2>Range of outcomes</h2><p>${state.mc.runs} simulated durations and rate shocks: median ${fmtMoney(state.mc.p50)}, bad case (P90) ${fmtMoney(state.mc.p90)}, severe (P99) ${fmtMoney(state.mc.p99)}; a DC runs short in ${Math.round(state.mc.pShortfall * 100)}% of runs.</p>` : "";
    const opt = state.opt && state.opt.best ? (() => { const b = state.opt.best, n = state.opt.none; const rows = state.opt.vars.map((v, i) => ({ v, val: v.levels[b.x[i]] })).filter(x => x.val);
      return `<h2>Recommended flexibility</h2><p>Optimised over the whole event library (${state.risk.source === "data" ? "data-informed" : "stated"} likelihoods, ${esc(((D.climate || {})[state.risk.climate] || {}).name || "")}, risk weight ${state.opt.lambda}). Annual cost of risk ${fmtMoney(n.total)} → <b>${fmtMoney(b.total)}</b>; worst-10% years ${fmtMoney(n.cvar90)} → <b>${fmtMoney(b.cvar90)}</b>.</p>
        <table><tbody>${rows.map(x => `<tr><td>${esc(x.v.label)}</td><td class="num">${esc(amountText(x.v, x.val))}</td></tr>`).join("") || "<tr><td>Hold nothing</td></tr>"}<tr><td><b>Annual cost of the options</b></td><td class="num"><b>${fmtMoney(b.premium)}</b></td></tr></tbody></table>${svgOf("opt-chart")}`; })() : "";
    const worst = state.worst ? `<h2>Most damaging scenarios for this network</h2><table><thead><tr><th>Scenario</th><th class="num">Cost</th><th class="num">Lost TEU</th></tr></thead><tbody>${state.worst.slice(0, 5).map(w => `<tr><td>${w.names.map(esc).join(" + ")}</td><td class="num">${fmtMoney(w.total)}</td><td class="num">${fmtInt(w.lostTeu)}</td></tr>`).join("")}</tbody></table>` : "";
    const val = AtlasValidation ? AtlasValidation.run(SIG, D) : [];
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Disruption review — ${esc(evs.map(e => e.name).join(" + ") || "baseline")}</title>
<style>
:root{--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--cost-up:#e34948;--cost-down:#2a78d6;--grid:#e3e8f0;--axis:#9aa6b8;--ref:#6b7385;--ink-soft:#55627a;--text:#13203a;--panel-2:#fff}
body{font:13.5px/1.55 "Segoe UI",Roboto,sans-serif;color:#13203a;max-width:820px;margin:28px auto;padding:0 22px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 8px;border-bottom:1px solid #d5dde9;padding-bottom:4px}
.meta{color:#55627a;font-size:12px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0}.kpi{border:1px solid #d5dde9;border-radius:8px;padding:8px 10px}.kpi span{display:block;font-size:10px;text-transform:uppercase;color:#55627a;letter-spacing:.05em}.kpi b{font-size:18px}
table{width:100%;border-collapse:collapse;margin:6px 0}td,th{padding:4px 8px;border-bottom:1px solid #e3e8f0;text-align:left;font-size:12.5px}.num{text-align:right;font-variant-numeric:tabular-nums}
svg{max-width:100%;height:auto;display:block;margin:8px 0}svg .ax{fill:#55627a;font-size:11px}svg .val,svg .lbl{fill:#13203a;font-size:11px}.g-grid{stroke:#e3e8f0}.g-axis{stroke:#9aa6b8}.g-ref{stroke:#6b7385}.g-xh{stroke:#13203a;opacity:0}.hit{fill:transparent}
.caveat{font-size:11.5px;color:#55627a}.print{position:fixed;top:12px;right:12px}@media print{.print{display:none}body{margin:0}h2{break-after:avoid}table,svg{break-inside:avoid}}
</style></head><body>
<button class="print" onclick="window.print()">Print / save as PDF</button>
<h1>Disruption review: ${esc(evs.map(e => e.name).join(" + ") || "baseline network")}</h1>
<p class="meta">${esc(net.name || "Network")} · prepared ${today} with the Global Disruption Atlas v${APP_VERSION} (Estay Dynamics) · live data to ${esc(snap)}</p>
<div class="kpis"><div class="kpi"><span>Disruption cost</span><b>${fmtMoney(r.total)}</b></div><div class="kpi"><span>Time-to-survive</span><b>${r.tts === null ? "&gt; " + r.ttr + " d" : "day " + r.tts}</b></div><div class="kpi"><span>Lost sales</span><b>${fmtInt(r.lostTeu)} TEU</b></div><div class="kpi"><span>Service back to normal</span><b>${r.recoveredAt == null ? "&gt; 1 yr" : "day " + r.recoveredAt}</b></div></div>
<h2>What happens</h2><p>${el("story").textContent}</p>
${evs.length ? `<h2>The scenario</h2><ul>${evs.map(e => `<li><b>${esc(e.name)}</b> (${esc(e.period || e.kind)}) — ${esc(e.description || "")}</li>`).join("")}</ul>` : ""}
<h2>Where the money goes</h2><table><tbody>${comp}</tbody></table>${svgOf("cost-chart")}
${fam ? `<h2>Service by product family</h2><table><thead><tr><th>Family</th><th class="num">Worst 4 weeks</th><th class="num">Target</th><th class="num">Lost TEU</th><th></th></tr></thead><tbody>${fam}</tbody></table>${svgOf("fam-chart")}` : ""}
<h2>Distribution centres</h2><table><thead><tr><th>DC</th><th class="num">Time-to-survive</th><th class="num">Lost TEU</th></tr></thead><tbody>${dcs}</tbody></table>${svgOf("inv-chart")}
<h2>Options held</h2><table><tbody>${leverRows}</tbody></table>
${mc}${opt}${worst}
<h2>Assumptions and caveats</h2>
<p class="caveat">Cargo value, lost-sale costs and fill targets per family as set in the Atlas; carrying ${state.assume.carryingRatePct}%/yr, holding ${state.assume.holdingRatePct}%/yr; planners react ${state.assume.reactionDays} days late; ports clear backlogs at +${state.assume.portHeadroomPct}%, canals at +${state.assume.chokeHeadroomPct}%. Event effect sizes are calibrated assumptions; event likelihoods are ${state.risk.source === "data" ? "data-informed (PortWatch episodes)" : "stated assumptions"}. ${val.length ? `The model passes ${val.filter(v => v.ok).length} of ${val.length} checks against history.` : ""} One aggregate container per family; weekly re-planning; results support comparing options, they are not a forecast.</p>
</body></html>`;
    return html;
  }
  el("open-report").addEventListener("click", () => {
    const html = buildReport(); if (!html) return;
    bump("report");
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (!w) download("atlas-disruption-review.html", html, "text/html");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  el("download-report").addEventListener("click", () => { const html = buildReport(); if (html) { bump("report"); download("atlas-disruption-review.html", html, "text/html"); } });

  // ------------------------------------------------------------------ API in the page (v5)
  const SPEC_EXAMPLE = { atlasSpec: 1, events: ["redsea-2023"], levers: { controlTower: true, hedgeCoverage: 0.7 }, analyses: { monteCarlo: { runs: 100, seed: 1 }, likelihood: { source: "data", climate: "today", correlated: true } } };
  el("api-spec").value = JSON.stringify(SPEC_EXAMPLE, null, 2);
  el("api-run").addEventListener("click", () => {
    const out = el("api-out"), btn = el("api-run"); let spec;
    try { spec = JSON.parse(el("api-spec").value); } catch (e) { out.textContent = "Spec is not valid JSON: " + e.message; return; }
    btn.disabled = true; btn.textContent = "Running…"; out.textContent = "";
    setTimeout(() => {
      try { const res = AtlasApi.run(spec, D, SIG, APP_VERSION); state.apiResult = res; out.textContent = JSON.stringify(res, null, 2); bump("api-run"); }
      catch (e) { out.textContent = "Error: " + e.message; }
      btn.disabled = false; btn.textContent = "Run spec";
    }, 30);
  });
  el("api-current").addEventListener("click", () => {
    const spec = { atlasSpec: 1, events: [...state.eventIds].map(id => { const c = state.customEvents.find(x => x.id === id); return c || id; }), liveBase: state.fromLive, durationDays: state.duration || null, levers: state.levers,
      assumptions: Object.assign({}, state.assume), products: state.products, analyses: { likelihood: state.risk } };
    if (state.networkSource === "custom" && state.customNet) spec.network = state.customNet;
    el("api-spec").value = JSON.stringify(spec, null, 2); bump("api-current");
  });
  el("api-download").addEventListener("click", () => { if (state.apiResult) download("atlas-result.json", JSON.stringify(state.apiResult, null, 2), "application/json"); });

  // ------------------------------------------------------------------ share / export
  function updateHash() {
    const parts = [];
    if (state.eventIds.size) parts.push("e=" + [...state.eventIds].join(","));
    if (state.fromLive) parts.push("live=1");
    if (state.duration) parts.push("d=" + state.duration);
    const lv = []; if (state.levers.buffer) lv.push("b" + state.levers.buffer); LEVER_BOOL.forEach(k => { if (state.levers[k]) lv.push(k); });
    if (lv.length) parts.push("lv=" + lv.join(","));
    if (state.projection === "2d") parts.push("v=2d");
    const h = parts.join("&");
    try { history.replaceState(null, "", h ? "#" + h : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }
  function readHash() {
    const h = location.hash.replace(/^#/, ""); if (!h) return;
    h.split("&").forEach(kvp => {
      const [k, v] = kvp.split("="); if (!v) return;
      if (k === "e") v.split(",").forEach(id => { if (evById[id]) state.eventIds.add(id); });
      if (k === "live") state.fromLive = v === "1";
      if (k === "d") state.duration = Math.max(1, Math.min(730, +v || 0)) || null;
      if (k === "lv") v.split(",").forEach(x => { if (/^b\d+$/.test(x)) state.levers.buffer = Math.min(45, +x.slice(1)); else if (LEVER_BOOL.includes(x)) state.levers[x] = true; });
      if (k === "v" && v === "2d") state.projection = "2d";
    });
    const first = activeEvents()[0]; if (first) state.tab = first.kind;
  }
  el("share-link").addEventListener("click", () => {
    updateHash(); bump("share");
    const url = location.href;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => flash("share-link", "Link copied ✓"), () => flash("share-link", "Copy from the address bar"));
  });
  function flash(id, text) { const b = el(id), t = b.textContent; b.textContent = text; setTimeout(() => { b.textContent = t; }, 1800); }
  el("export-json").addEventListener("click", () => {
    const r = state.result; if (!r) return;
    bump("export");
    const out = {
      app: "Global Disruption Atlas", version: APP_VERSION, generated: new Date().toISOString(),
      dataSnapshot: SIG ? SIG.generated : null, network: currentNet().name,
      scenario: activeEvents().map(e => ({ id: e.id, name: e.name, kind: e.kind })), startFromLive: state.fromLive, durationDays: r.ttr,
      levers: state.levers, assumptions: state.assume,
      engine: "time-phased simulation (v3)", reactionDays: r.prep.reactionDays, serviceRecoveredDay: r.recoveredAt, recoveryTailDays: r.tail, peakBacklogTeu: r.series ? Math.max(...r.series.backlog) : null,
      result: { totalCost: r.total, components: r.comps, lostTeu: r.lostTeu, airTeu: r.airTeu, timeToSurvive: r.tts, timeToRecover: r.ttr, leverAnnualCost: r.leverCost },
      productFamilies: (r.products || []).map(f => ({ id: f.id, name: f.name, demandTeuWeek: f.demand, fillRate: f.fill, worst4WeekFill: f.worst4w, target: f.target, meetsTarget: f.meets, lostTeu: f.lostTeu, lostSaleCost: f.lostCost, airTeu: f.airTeu, critical: f.critical })),
      dcs: r.dcs.map(d => ({ id: d.id, name: d.name, demandTeuWeek: d.demand, bufferDays: d.buffer, tts: d.tts, lostTeu: d.lostTeu, airTeu: d.airTeu, servedShare: d.servedShare })),
      services: r.prep.dis.services.map(s => ({ id: s.id, from: s.from, to: s.to, ok: s.ok, days: s.days, normalDays: (r.prep.base.services.find(b => b.id === s.id) || {}).days, capacity: s.cap, rate: s.rate + (s.uplift || 0), via: s.chokes })),
      exposure: r.exposure, monteCarlo: state.mc && state.mcKey === scenarioKey() ? { runs: state.mc.runs, mean: state.mc.mean, p10: state.mc.p10, p50: state.mc.p50, p90: state.mc.p90, p99: state.mc.p99, pShortfall: state.mc.pShortfall } : null
    };
    download("atlas-scenario.json", JSON.stringify(out, null, 2), "application/json");
  });

  // ------------------------------------------------------------------ render
  function syncControls() {
    const L = effectiveDuration();
    const dur = el("duration");
    dur.value = L || 30; dur.disabled = !activeEvents().length;
    el("duration-val").textContent = activeEvents().length ? `${L} days${state.duration ? " (set)" : " (actual)"}` : "—";
    el("lever-buffer").value = state.levers.buffer;
    el("lever-scope").value = state.levers.bufferScope || "all";
    el("lever-scope").disabled = !isMulti();
    const note = el("lever-amounts-note");
    if (note) {
      const l = state.levers, bits = [];
      if (l.bufferByFamily) { const fb = Object.keys(l.bufferByFamily).filter(k => l.bufferByFamily[k] > 0); if (fb.length) bits.push("stock " + fb.map(k => (D.products.find(p => p.id === k) || { name: k }).name.split(" ")[0] + " " + l.bufferByFamily[k] + " d").join(", ")); }
      if (l.hedgeCoverage) bits.push("contracts " + Math.round(l.hedgeCoverage * 100) + "%");
      if (l.dualSourceCap) bits.push("second source " + l.dualSourceCap + " TEU/wk");
      if (l.airCapPerDc) bits.push("air " + l.airCapPerDc + " TEU/wk per DC");
      if (l.gatewayBoost) bits.push("gateways +" + Math.round(l.gatewayBoost * 100) + "%");
      note.hidden = !hasAmounts();
      note.innerHTML = hasAmounts() ? `<b>Optimiser amounts applied:</b> ${esc(bits.join(" · ") || "none")}. Changing a lever below switches that lever back to its standard amount.` : "";
    }
    el("lever-buffer-val").textContent = state.levers.buffer + " days";
    $$("#lever-checks input[data-lever]").forEach(cb => { cb.checked = !!state.levers[cb.dataset.lever]; });
    el("from-live").checked = state.fromLive;
  }
  function renderMap() {
    layers = buildLayers();
    world.pathsData(layers.paths).pointsData(layers.points).ringsData(layers.rings).labelsData(layers.labels)
      .polygonsData(state.toggles.borders ? COUNTRY_FEATURES : []);
    if (state.projection === "2d") drawMap2D();
  }
  function render() {
    refreshDynamicEvents();
    if (renderFamilies._net !== state.networkSource + (state.customNet ? state.customNet.name : "")) { renderFamilies._net = state.networkSource + (state.customNet ? state.customNet.name : ""); renderFamilies(); }
    compute();
    syncControls();
    renderEventList();
    renderMap();
    renderResults();
    renderLanes();
    renderLive();
    renderDeps();
    renderBrief();
    if (state.mc) renderMc();
    if (state.portfolio) renderPortfolio();
    updateHash();
  }

  // data-as-of chip + sources
  if (SIG) {
    const pw = Object.values(SIG.chokepoints)[0];
    el("asof-chip").innerHTML = `Live data: PortWatch to <b>${esc(pw ? pw.asOf : "?")}</b>`;
    el("asof-chip").title = `Snapshot generated ${SIG.generated}. ${SIG.errors && SIG.errors.length ? "Errors: " + SIG.errors.join("; ") : "All sources fetched."}`;
    el("data-sources").innerHTML = Object.values(SIG.sources).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(" · ") + `. Snapshot ${esc(SIG.generated.slice(0, 16).replace("T", " "))} UTC, refreshed daily. Port and sea-lane geometry: built in. Event sources are linked on each event card.`;
  } else { el("asof-chip").textContent = "Live data unavailable"; el("data-sources").textContent = "Live snapshot missing."; }

  // ------------------------------------------------------------------ theme
  el("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("atlas-theme", next); } catch (e) { /* storage blocked: theme lasts this visit */ }
    bump("theme");
  });

  // ------------------------------------------------------------------ stale-data warning
  // PortWatch publishes with a lag of a few days; warn once the data is clearly older than that.
  (function staleCheck() {
    const b = el("stale-banner");
    if (!SIG) { b.textContent = "Live data snapshot missing — live conditions and the chokepoint monitor are unavailable; everything else works."; b.hidden = false; return; }
    const asOf = Object.values(SIG.chokepoints).map(c => c.asOf).filter(Boolean).sort().pop();
    const age = asOf ? Math.floor((Date.now() - Date.parse(asOf + "T00:00:00Z")) / 864e5) : null;
    const stale = Object.values(SIG.chokepoints).filter(c => c.stale).map(c => c.name);
    const msgs = [];
    if (age != null && age > 12) msgs.push(`PortWatch data is ${age} days old (last day ${asOf}) — the daily refresh may be failing; treat live conditions with care.`);
    if (stale.length) msgs.push(`Last fetch failed for ${stale.join(", ")}; showing earlier values.`);
    if (msgs.length) { b.textContent = "⚠ " + msgs.join(" "); b.hidden = false; }
  })();

  // ------------------------------------------------------------------ validation
  function renderValidation() {
    const tb = document.querySelector("#validation-table tbody");
    if (!window.AtlasValidation) return;
    const rows = AtlasValidation.run(SIG, D);
    const ok = rows.filter(r => r.ok).length;
    el("validation-summary").textContent = `${ok} of ${rows.length} checks pass`;
    tb.innerHTML = rows.map(r => `<tr><td>${esc(r.topic)}</td><td>${esc(r.claim)}<div class="mut small">${esc(r.note || "")}</div></td><td>${esc(r.model)}</td><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.observed)}</a>` : esc(r.observed)}</td><td>${r.ok ? '<span class="v-pass">✓ Pass</span>' : '<span class="v-flag">✕ Flag</span>'}</td></tr>`).join("");
  }

  // ------------------------------------------------------------------ boot
  refreshDynamicEvents(true);
  readHash();
  renderLikelihood();
  // remember what this visit saw, for the next visit's brief
  setTimeout(() => { try { if (briefNow) localStorage.setItem(BRIEF_KEY, JSON.stringify(briefNow)); } catch (e) { /* storage blocked */ } }, 1500);
  if (state.projection === "2d") setTimeout(() => setProjection("2d"), 0);
  resize();
  render();
  renderValidation();

  // ------------------------------------------------------------------ tutorial API
  window.AtlasApp = {
    version: APP_VERSION,
    flag: k => flags[k] || 0,
    flagSnapshot: () => Object.assign({}, flags),
    events: () => [...state.eventIds],
    setEvents: ids => { state.eventIds = new Set(ids); state.duration = null; const f = activeEvents()[0]; if (f) state.tab = f.kind; render(); },
    setTab: t => { state.tab = t; renderEventList(); },
    levers: () => Object.assign({}, state.levers),
    products: () => JSON.parse(JSON.stringify(state.products)),
    setLevers: lv => { Object.assign(state.levers, lv); render(); },
    duration: () => effectiveDuration(),
    setDuration: d => { state.duration = d; bump("duration"); render(); },
    fromLive: () => state.fromLive,
    setFromLive: v => { state.fromLive = !!v; render(); },
    result: () => state.result,
    projection: () => state.projection,
    setProjection,
    network: () => state.networkSource,
    loadDemoNetwork: loadDemo,
    alerts: () => ALERTS.map(a => a.id),
    modelAlert,
    resetNetwork: () => el("clear-network").click(),
    runMc, runPortfolio: () => el("run-portfolio").click(),
    mc: () => state.mc, portfolio: () => state.portfolio, opt: () => state.opt,
    runOptimise: () => el("run-optimise").click(), applyOptimised,
    runWorst: () => el("run-worst").click(), worst: () => state.worst, risk: () => Object.assign({}, state.risk),
    openShipments: () => openShipmentWizard(null), buildSampleShipments: () => { openShipmentWizard(sampleShipments(), "sample-shipments.csv"); setTimeout(() => { const b = el("ship-build"); if (b) b.click(); }, 50); },
    describe: text => { el("describe-text").value = text; el("describe-go").click(); const a = el("describe-add"); if (a) a.click(); },
    openWorkspaces, saveWorkspace: name => { const l = wsList().filter(w => w.name !== name); l.unshift(snapshotState(name, "")); wsStore(l); bump("ws-save"); },
    workspaces: () => wsList().map(w => w.name), openReport: () => el("download-report").click(), reportHtml: () => buildReport(), runApi: () => el("api-run").click(),
    setRisk: r => { Object.assign(state.risk, r); el("lik-source").value = state.risk.source; el("lik-climate").value = state.risk.climate; el("lik-correlated").checked = state.risk.correlated; renderLikelihood(); },
    showInfo, openDetails: id => { const d = el(id); if (d) { const det = d.querySelector("details") || (d.tagName === "DETAILS" ? d : null); if (det) det.open = true; } },
    resetAll: () => {
      state.eventIds.clear(); state.duration = null; state.fromLive = false;
      state.levers = { buffer: 0, bufferScope: "all", dualSource: false, airBridge: false, gateways: false, rateHedge: false, controlTower: false };
      state.products = {}; renderFamilies();
      state.assume = Object.assign({}, DEFAULT_ASSUME); Object.keys(DEFAULT_ASSUME).forEach(k => { const i = el("a-" + k); if (i) i.value = state.assume[k]; });
      state.tab = "live"; state.mc = null; state.portfolio = null; state.opt = null; el("opt-out").innerHTML = '<p class="mut">Choose a risk attitude and run the optimiser.</p>';
      el("mc-out").innerHTML = '<p class="mut">Select a scenario, then run.</p>'; el("portfolio-out").innerHTML = '<p class="mut">Run to compare.</p>';
      render();
    },
    focusGlobe: (lat, lng, alt) => world.pointOfView({ lat, lng, altitude: alt || 2.2 }, 1000)
  };
  if (window.AtlasTutorial) window.AtlasTutorial.init(window.AtlasApp);
})();
