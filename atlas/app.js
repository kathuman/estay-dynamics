(() => {
  const { network, disruptions, scenarios } = ATLAS_DATA;

  // User-imported network — starts empty, filled in by CSV upload.
  const customNetwork = { ports: [], warehouses: [], factories: [], corridors: [] };

  const TYPE_RGB = {
    weather: [79, 163, 255],
    strike: [255, 207, 79],
    geopolitical: [255, 92, 122]
  };
  const COLORS = {
    port: '#3fd0ff',
    warehouse: '#2dd4bf',
    factory: '#ffb84f',
    buffer: '#7cff8a',
    altsupplier: '#c98bff',
    baseline: 'rgba(63,208,255,0.55)',
    disabled: 'rgba(255,77,94,0.25)',
    atrisk: 'rgba(255,140,60,0.85)',
    reroute: '#7cff8a'
  };

  const disruptionById = {};
  disruptions.forEach(d => { disruptionById[d.id] = d; });

  // Country borders/names — vendored locally (vendor/countries.js) as a plain
  // JS global, same reason as ATLAS_DATA: this runs from a local file:// path
  // with no server, so a fetch() of a local JSON file would be CORS-blocked.
  const COUNTRY_FEATURES = (typeof COUNTRIES_GEOJSON !== 'undefined' && COUNTRIES_GEOJSON.features) || [];
  const countryCentroidCache = COUNTRY_FEATURES.map(f => {
    const c = countryCentroid(f.geometry);
    return { name: f.properties.name, lat: c.lat, lng: c.lng, kind: 'country' };
  });

  // ---- State ----
  const state = {
    scenarioId: 'baseline',
    dataSource: 'sample', // 'sample' | 'custom' | 'both'
    projection: '3d', // '3d' | '2d'
    toggles: {
      ports: true, warehouses: true, factories: true, corridors: true, disruptions: true,
      labels: false, borders: true, countryNames: false
    }
  };

  // ---- DOM refs ----
  const el = id => document.getElementById(id);
  const scenarioSelect = el('scenario-select');
  const scenarioNarrative = el('scenario-narrative');
  const scenarioStats = el('scenario-stats');
  const infoPanel = el('info-panel');
  const infoBody = el('info-body');
  const signalFeed = el('signal-feed');
  const clockEl = el('clock');
  const loadingEl = el('loading');
  const sourceSelect = el('network-source');
  const networkStatus = el('network-status');

  scenarios.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.shortLabel;
    scenarioSelect.appendChild(opt);
  });
  scenarioSelect.addEventListener('change', () => {
    state.scenarioId = scenarioSelect.value;
    render();
  });

  ['ports', 'warehouses', 'factories', 'corridors', 'disruptions', 'labels', 'borders', 'countryNames'].forEach(key => {
    el(`toggle-${key}`).addEventListener('change', e => {
      state.toggles[key] = e.target.checked;
      render();
    });
  });
  state.toggles.labels = el('toggle-labels').checked;
  // Country borders/names are baked into the cached 2D basemap (see buildBasemap)
  // for performance, so toggling them needs an explicit rebuild, not just render().
  ['borders', 'countryNames'].forEach(key => {
    el(`toggle-${key}`).addEventListener('change', () => buildBasemap());
  });

  el('info-close').addEventListener('click', () => infoPanel.classList.add('hidden'));

  // ---- Globe setup ----
  const world = Globe()(el('globe'))
    .globeImageUrl('vendor/img/earth-blue-marble.jpg')
    .bumpImageUrl('vendor/img/earth-topology.png')
    .backgroundImageUrl('vendor/img/night-sky.png')
    .atmosphereColor('#3fd0ff')
    .atmosphereAltitude(0.18)
    .pointAltitude(0.012)
    .pointRadius(d => (d.kind === 'disruption' ? 0.28 + d.severity * 0.05 : d.kind === 'port' ? 0.45 : 0.35))
    .pointColor(pointColor)
    .pointLabel(pointTooltip)
    .pointsMerge(false)
    .onPointClick(showInfo)
    .polygonCapColor(() => 'rgba(0,0,0,0)')
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => 'rgba(127,156,179,0.55)')
    .polygonAltitude(0.004)
    .polygonLabel(d => `<div style="font:12px sans-serif;color:#fff"><b>${d.properties.name}</b></div>`)
    .onPolygonClick(d => showInfo({ kind: 'country', name: d.properties.name }))
    .arcColor(d => arcColorFor(d.status))
    .arcAltitude(0.22)
    .arcStroke(d => (d.status === 'reroute' ? 0.6 : d.status === 'disabled' ? 0.25 : 0.4))
    .arcDashLength(d => (d.status === 'reroute' ? 0.45 : 0.35))
    .arcDashGap(d => (d.status === 'reroute' ? 0.2 : 0.5))
    .arcDashAnimateTime(d => (d.status === 'reroute' || d.status === 'atrisk' ? 2200 : 5500))
    .arcLabel(d => `${d.lane || ''}${d.note ? ` — ${d.note}` : ''}`)
    .ringColor(d => ringColorFn(d))
    .ringMaxRadius(d => 2 + d.severity * 0.7)
    .ringPropagationSpeed(d => 1 + d.severity * 0.4)
    .ringRepeatPeriod(d => Math.max(500, 2400 - d.severity * 320))
    .labelText(d => d.name)
    .labelSize(d => (d.kind === 'port' ? 0.55 : d.kind === 'country' ? 0.34 : 0.45))
    .labelColor(d => labelColorFor(d.kind))
    .labelDotRadius(0)
    .labelAltitude(d => (d.kind === 'country' ? 0.006 : 0.014))
    .onGlobeReady(() => loadingEl.classList.add('hidden'));

  world.pointOfView({ lat: 18, lng: 20, altitude: 2.3 }, 0);

  const controls = world.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;

  const rotateSpeedSlider = el('rotate-speed');
  const rotateSpeedVal = el('rotate-speed-val');
  rotateSpeedSlider.addEventListener('input', () => {
    const speed = parseFloat(rotateSpeedSlider.value);
    controls.autoRotateSpeed = speed;
    controls.autoRotate = speed > 0; // dragging the slider to 0 stops rotation entirely
    rotateSpeedVal.textContent = speed.toFixed(2);
  });

  function resize() {
    const wrap = el('globe-wrap');
    world.width(wrap.clientWidth).height(wrap.clientHeight);
  }
  window.addEventListener('resize', () => { resize(); resizeMap2D(); });
  resize();

  // ---- 2D Equal Earth map ----
  // globe.gl/three-globe only render a 3D sphere, so the 2D view is a
  // separate canvas renderer. It reuses the SAME data builders (buildArcs,
  // buildPoints, buildRings) as the globe — one source of truth, two views.
  //
  // Uses the Equal Earth projection (Šavrič, Patterson & Jenny, 2018) rather
  // than Mercator — it's equal-area, so northern-hemisphere ports don't get
  // visually inflated relative to equatorial ones the way they would on
  // Mercator, while keeping a clean closed-form formula (no lookup tables).
  const map2dCanvas = el('map2d');
  const map2dCtx = map2dCanvas.getContext('2d');

  // Equal Earth constants (Šavrič et al. 2018)
  const EE_A1 = 1.340264, EE_A2 = -0.081106, EE_A3 = 0.000893, EE_A4 = 0.003796;
  const EE_M = Math.sqrt(3) / 2;

  // Forward projection, raw (unscaled) units. lambda/phi in radians.
  function eqEarthRaw(lambda, phi) {
    const l = Math.asin(EE_M * Math.sin(phi));
    const l2 = l * l, l6 = l2 * l2 * l2;
    const x = (lambda * Math.cos(l)) / (EE_A1 + 3 * EE_A2 * l2 + l6 * (7 * EE_A3 + 9 * EE_A4 * l2));
    const y = l * (EE_A1 + EE_A2 * l2 + l6 * (EE_A3 + EE_A4 * l2));
    return [x, y];
  }
  const EE_X_MAX = eqEarthRaw(Math.PI, 0)[0];        // raw x at equator, ±180°
  const EE_Y_MAX = eqEarthRaw(0, Math.PI / 2)[1];    // raw y at the poles

  // y(phi) has no lambda term, so it's invertible per output row via bisection
  // (Equal Earth has no closed-form inverse — this is the standard approach).
  function eqEarthInvPhi(yRaw) {
    let lo = -Math.PI / 2 + 1e-6, hi = Math.PI / 2 - 1e-6;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (eqEarthRaw(0, mid)[1] < yRaw) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // Fit-to-canvas scale (like a CSS "contain"), computed on every resize.
  let eeScale = 1, eeOffsetX = 0, eeOffsetY = 0;
  function computeEqEarthFit(w, h) {
    const pad = 0.94; // small margin so the map doesn't touch the canvas edge
    eeScale = Math.min(w / (2 * EE_X_MAX), h / (2 * EE_Y_MAX)) * pad;
    eeOffsetX = w / 2;
    eeOffsetY = h / 2;
  }

  function projPoint(lngDeg, latDeg) {
    const [xr, yr] = eqEarthRaw((lngDeg * Math.PI) / 180, (latDeg * Math.PI) / 180);
    return { x: eeOffsetX + xr * eeScale, y: eeOffsetY - yr * eeScale };
  }

  // Real reprojection of the vendored equirectangular Earth texture into
  // Equal Earth, row by row: each output row maps to one latitude (via
  // bisection) and is drawn horizontally scaled to that latitude's map
  // width — this is what gives the projection its characteristic "eye"
  // shape instead of a plain rectangle. Cached as an offscreen canvas,
  // rebuilt on resize.
  let basemapCanvas = null;
  const basemapImg = new Image();
  basemapImg.src = 'vendor/img/earth-blue-marble.jpg';
  basemapImg.onload = () => { buildBasemap(); if (state.projection === '2d') drawMap2D(currentScenario()); };

  function buildBasemap() {
    if (!basemapImg.complete || !basemapImg.naturalWidth) return;
    const w = map2dCanvas.width, h = map2dCanvas.height;
    if (!w || !h) return;
    computeEqEarthFit(w, h);
    basemapCanvas = document.createElement('canvas');
    basemapCanvas.width = w; basemapCanvas.height = h;
    const bctx = basemapCanvas.getContext('2d');
    bctx.fillStyle = '#050a14';
    bctx.fillRect(0, 0, w, h);
    const imgW = basemapImg.naturalWidth, imgH = basemapImg.naturalHeight;
    for (let y = 0; y < h; y++) {
      const yRaw = (eeOffsetY - y) / eeScale;
      if (Math.abs(yRaw) > EE_Y_MAX + 1e-6) continue; // outside the projected map (letterbox area)
      const phi = eqEarthInvPhi(yRaw);
      const latDeg = (phi * 180) / Math.PI;
      const xScale = eqEarthRaw(1, phi)[0]; // dx/dlambda at this latitude
      const rowWidth = 2 * Math.PI * xScale * eeScale;
      const xOff = eeOffsetX - rowWidth / 2;
      const srcRow = Math.min(imgH - 1, Math.max(0, Math.round(((90 - latDeg) / 180) * imgH)));
      bctx.drawImage(basemapImg, 0, srcRow, imgW, 1, xOff, y, rowWidth, 1);
    }
    bctx.fillStyle = 'rgba(5,10,20,0.45)'; // match the site's dark theme
    bctx.fillRect(0, 0, w, h);

    // Country borders/names are static, so they're baked into this cached
    // basemap (rebuilt on resize or when their toggles change) instead of
    // being redrawn every animation frame in drawMap2D.
    const dpr = window.devicePixelRatio || 1;
    if (state.toggles.borders) drawCountryBorders(bctx, w, dpr);
    if (state.toggles.countryNames) drawCountryNames(bctx, dpr);
  }

  // Projects a country's rings and strokes them, breaking the path instead of
  // drawing a line whenever a segment jumps more than half the map width —
  // that jump means the ring crossed the antimeridian, which would otherwise
  // draw a spurious line clear across the map (e.g. Russia, Fiji, Alaska).
  function drawCountryBorders(bctx, canvasW, dpr) {
    bctx.strokeStyle = 'rgba(127,156,179,0.55)';
    bctx.lineWidth = dpr;
    bctx.setLineDash([]);
    COUNTRY_FEATURES.forEach(f => {
      countryRings(f.geometry).forEach(ring => {
        bctx.beginPath();
        let prev = null;
        ring.forEach(([lng, lat]) => {
          const pt = projPoint(lng, lat);
          if (!prev || Math.abs(pt.x - prev.x) > canvasW / 2) bctx.moveTo(pt.x, pt.y);
          else bctx.lineTo(pt.x, pt.y);
          prev = pt;
        });
        bctx.stroke();
      });
    });
  }

  function drawCountryNames(bctx, dpr) {
    bctx.fillStyle = 'rgba(220,232,240,0.55)';
    bctx.font = `${8.5 * dpr}px "IBM Plex Mono", monospace`;
    bctx.textAlign = 'center';
    countryCentroidCache.forEach(c => {
      const pt = projPoint(c.lng, c.lat);
      bctx.fillText(c.name, pt.x, pt.y);
    });
    bctx.textAlign = 'left';
  }

  function resizeMap2D() {
    const wrap = el('globe-wrap');
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    map2dCanvas.width = Math.round(cw * dpr);
    map2dCanvas.height = Math.round(ch * dpr);
    map2dCanvas.style.width = cw + 'px';
    map2dCanvas.style.height = ch + 'px';
    computeEqEarthFit(map2dCanvas.width, map2dCanvas.height);
    buildBasemap();
    if (state.projection === '2d') drawMap2D(currentScenario());
  }

  let map2dPointCache = [];

  function drawMap2D(scenario) {
    const w = map2dCanvas.width, h = map2dCanvas.height;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    map2dCtx.clearRect(0, 0, w, h);
    if (basemapCanvas) map2dCtx.drawImage(basemapCanvas, 0, 0, w, h);
    else { map2dCtx.fillStyle = '#050a14'; map2dCtx.fillRect(0, 0, w, h); }

    // corridors
    if (state.toggles.corridors) {
      buildArcs(scenario).forEach(a => {
        const p1 = projPoint(a.startLng, a.startLat), p2 = projPoint(a.endLng, a.endLat);
        map2dCtx.strokeStyle = arcColorFor(a.status);
        map2dCtx.lineWidth = (a.status === 'reroute' ? 2.2 : 1.3) * dpr;
        map2dCtx.setLineDash(a.status === 'disabled' ? [4 * dpr, 4 * dpr] : a.status === 'reroute' ? [6 * dpr, 3 * dpr] : []);
        map2dCtx.beginPath(); map2dCtx.moveTo(p1.x, p1.y); map2dCtx.lineTo(p2.x, p2.y); map2dCtx.stroke();
      });
      map2dCtx.setLineDash([]);
    }

    const now = performance.now();

    // disruption pulse rings
    if (state.toggles.disruptions) {
      buildRings().forEach(d => {
        const p = projPoint(d.lng, d.lat);
        const rgb = TYPE_RGB[d.type] || [255, 255, 255];
        const pulse = (Math.sin(now / 500 + d.severity) + 1) / 2;
        const r = (5 + d.severity * 2 + pulse * 6) * dpr;
        map2dCtx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, 0.75 - pulse * 0.45)})`;
        map2dCtx.lineWidth = 1.4 * dpr;
        map2dCtx.beginPath(); map2dCtx.arc(p.x, p.y, r, 0, Math.PI * 2); map2dCtx.stroke();
      });
    }

    // nodes (ports / warehouses / factories)
    const pts = buildPoints(scenario);
    const cache = [];
    pts.filter(p => p.kind !== 'disruption').forEach(p => {
      const pt = projPoint(p.lng, p.lat);
      const radius = (p.kind === 'port' ? 4.5 : p.isBuffer || p.isAltSupplier ? 4 : 3.4) * dpr;
      map2dCtx.fillStyle = pointColor(p);
      if (p.isBuffer || p.isAltSupplier) {
        map2dCtx.shadowColor = pointColor(p);
        map2dCtx.shadowBlur = 6 * dpr;
      }
      map2dCtx.beginPath(); map2dCtx.arc(pt.x, pt.y, radius, 0, Math.PI * 2); map2dCtx.fill();
      map2dCtx.shadowBlur = 0;
      if (state.toggles.labels) {
        map2dCtx.fillStyle = labelColorFor(p.kind);
        map2dCtx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
        map2dCtx.fillText(p.name, pt.x + radius + 3 * dpr, pt.y + 3 * dpr);
      }
      cache.push({ d: p, x: pt.x, y: pt.y });
    });

    // disruption center dots (on top, after rings)
    if (state.toggles.disruptions) {
      buildRings().forEach(d => {
        const pt = projPoint(d.lng, d.lat);
        const rgb = TYPE_RGB[d.type] || [255, 255, 255];
        map2dCtx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        map2dCtx.beginPath(); map2dCtx.arc(pt.x, pt.y, 3 * dpr, 0, Math.PI * 2); map2dCtx.fill();
        cache.push({ d, x: pt.x, y: pt.y });
      });
    }

    map2dPointCache = cache;
  }

  function map2dPick(evt) {
    const rect = map2dCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (evt.clientX - rect.left) * dpr;
    const my = (evt.clientY - rect.top) * dpr;
    let best = null, bestDist = 16 * dpr;
    map2dPointCache.forEach(p => {
      const dist = Math.hypot(p.x - mx, p.y - my);
      if (dist < bestDist) { bestDist = dist; best = p.d; }
    });
    return best;
  }
  map2dCanvas.addEventListener('click', evt => {
    const d = map2dPick(evt);
    if (d) showInfo(d);
  });
  map2dCanvas.addEventListener('mousemove', evt => {
    const d = map2dPick(evt);
    map2dCanvas.style.cursor = d ? 'pointer' : 'default';
    map2dCanvas.title = d ? d.name : '';
  });

  let map2dAnimating = false;
  function map2dLoop() {
    if (state.projection !== '2d') { map2dAnimating = false; return; }
    drawMap2D(currentScenario());
    requestAnimationFrame(map2dLoop);
  }

  const view3dBtn = el('view-3d'), view2dBtn = el('view-2d');
  function setProjection(mode) {
    state.projection = mode;
    const globeEl = el('globe');
    if (mode === '3d') {
      globeEl.classList.remove('hidden');
      map2dCanvas.classList.add('hidden');
      controls.autoRotate = true;
      view3dBtn.classList.add('active'); view2dBtn.classList.remove('active');
    } else {
      globeEl.classList.add('hidden');
      map2dCanvas.classList.remove('hidden');
      controls.autoRotate = false;
      view3dBtn.classList.remove('active'); view2dBtn.classList.add('active');
      resizeMap2D();
      if (!map2dAnimating) { map2dAnimating = true; map2dLoop(); }
    }
  }
  view3dBtn.addEventListener('click', () => setProjection('3d'));
  view2dBtn.addEventListener('click', () => setProjection('2d'));
  resizeMap2D();

  // ---- Color helpers ----
  function arcColorFor(status) {
    switch (status) {
      case 'reroute': return COLORS.reroute;
      case 'atrisk': return COLORS.atrisk;
      case 'disabled': return COLORS.disabled;
      default: return COLORS.baseline;
    }
  }

  function labelColorFor(kind) {
    if (kind === 'port') return COLORS.port;
    if (kind === 'warehouse') return COLORS.warehouse;
    if (kind === 'country') return 'rgba(220,232,240,0.55)';
    return COLORS.factory;
  }

  function ringColorFn(d) {
    const rgb = TYPE_RGB[d.type] || [255, 255, 255];
    return t => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, 1 - t)})`;
  }

  function pointColor(d) {
    if (d.kind === 'disruption') {
      const rgb = TYPE_RGB[d.type] || [255, 255, 255];
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
    if (d.isAltSupplier) return COLORS.altsupplier;
    if (d.isBuffer) return COLORS.buffer;
    return COLORS[d.kind] || COLORS.port;
  }

  function pointTooltip(d) {
    if (d.kind === 'disruption') {
      return `<div style="font:12px sans-serif;color:#fff"><b>${d.name}</b><br/>${d.type.toUpperCase()} · severity ${d.severity}/5</div>`;
    }
    const tag = d.kind === 'port' ? 'Port' : d.kind === 'warehouse' ? 'Warehouse' : 'Factory';
    const extra = d.isBuffer ? ' · buffer active' : d.isAltSupplier ? ' · alt-supplier active' : '';
    const src = d.source === 'custom' ? ' · your network' : '';
    return `<div style="font:12px sans-serif;color:#fff"><b>${d.name}</b><br/>${tag}${extra}${src}</div>`;
  }

  // ---- Merged network (sample + custom, per data-source selector) ----
  function activeSources() {
    const list = [];
    if (state.dataSource === 'sample' || state.dataSource === 'both') list.push({ net: network, source: 'sample' });
    if (state.dataSource === 'custom' || state.dataSource === 'both') list.push({ net: customNetwork, source: 'custom' });
    return list;
  }

  function mergedList(key) {
    const map = new Map();
    activeSources().forEach(({ net, source }) => {
      (net[key] || []).forEach(item => map.set(item.id, { ...item, source }));
    });
    return [...map.values()];
  }

  function allNodesIndex() {
    // Union across BOTH sample and custom regardless of the display filter — used for lookups
    // (feeder ports, route validation) that shouldn't disappear just because a layer is hidden.
    const map = {};
    [{ net: network, source: 'sample' }, { net: customNetwork, source: 'custom' }].forEach(({ net, source }) => {
      (net.ports || []).forEach(n => { map[n.id] = { ...n, kind: 'port', source }; });
      (net.warehouses || []).forEach(n => { map[n.id] = { ...n, kind: 'warehouse', source }; });
      (net.factories || []).forEach(n => { map[n.id] = { ...n, kind: 'factory', source }; });
    });
    return map;
  }

  function mergedNodeById() {
    const map = {};
    mergedList('ports').forEach(n => { map[n.id] = { ...n, kind: 'port' }; });
    mergedList('warehouses').forEach(n => { map[n.id] = { ...n, kind: 'warehouse' }; });
    mergedList('factories').forEach(n => { map[n.id] = { ...n, kind: 'factory' }; });
    return map;
  }

  // ---- Data builders ----
  function currentScenario() {
    return scenarios.find(s => s.id === state.scenarioId) || scenarios[0];
  }

  function buildArcs(scenario) {
    const nodeById = mergedNodeById();
    const disabledSet = new Set(scenario.disabledCorridors);
    const affected = new Set(disruptions.flatMap(d => d.affectsCorridors));
    const arcs = [];
    mergedList('corridors').forEach(c => {
      const from = nodeById[c.from], to = nodeById[c.to];
      if (!from || !to) return;
      const status = disabledSet.has(c.id) ? 'disabled' : affected.has(c.id) ? 'atrisk' : 'normal';
      arcs.push({ ...c, startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng, status });
    });
    scenario.addedArcs.forEach(a => {
      const from = nodeById[a.from], to = nodeById[a.to];
      if (!from || !to) return;
      arcs.push({ ...a, startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng, status: 'reroute' });
    });
    return arcs;
  }

  function buildPoints(scenario) {
    const bufferMap = {};
    scenario.bufferSites.forEach(b => { bufferMap[b.portId] = b.note; });
    const altMap = {};
    scenario.alternateSuppliers.forEach(a => { altMap[a.factoryId] = a.note; });

    const pts = [];
    if (state.toggles.ports) {
      mergedList('ports').forEach(p => {
        pts.push({ ...p, kind: 'port', isBuffer: !!bufferMap[p.id], bufferNote: bufferMap[p.id] || null });
      });
    }
    if (state.toggles.warehouses) {
      mergedList('warehouses').forEach(w => pts.push({ ...w, kind: 'warehouse' }));
    }
    if (state.toggles.factories) {
      mergedList('factories').forEach(f => {
        pts.push({ ...f, kind: 'factory', isAltSupplier: !!altMap[f.id], altNote: altMap[f.id] || null });
      });
    }
    if (state.toggles.disruptions) {
      disruptions.forEach(d => pts.push({ ...d, kind: 'disruption' }));
    }
    return pts;
  }

  function buildLabels() {
    const labels = [];
    if (state.toggles.labels) {
      if (state.toggles.ports) mergedList('ports').forEach(p => labels.push({ ...p, kind: 'port' }));
      if (state.toggles.warehouses) mergedList('warehouses').forEach(w => labels.push({ ...w, kind: 'warehouse' }));
      if (state.toggles.factories) mergedList('factories').forEach(f => labels.push({ ...f, kind: 'factory' }));
    }
    if (state.toggles.countryNames) labels.push(...countryCentroidCache);
    return labels;
  }

  function buildRings() {
    if (!state.toggles.disruptions) return [];
    return disruptions;
  }

  // ---- Country geometry helpers (borders + name-label placement) ----
  // Centroid/area use the planar shoelace formula on raw [lng,lat] pairs —
  // not true spherical area, but plenty accurate for placing a name label
  // and picking the largest landmass of a multi-polygon (e.g. archipelagos).
  function ringArea(ring) {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      sum += x1 * y2 - x2 * y1;
    }
    return sum / 2;
  }

  function ringCentroid(ring) {
    let cx = 0, cy = 0, areaSum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const cross = x1 * y2 - x2 * y1;
      areaSum += cross;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    const area = areaSum / 2;
    if (Math.abs(area) < 1e-9) {
      const n = ring.length;
      let sx = 0, sy = 0;
      ring.forEach(([x, y]) => { sx += x; sy += y; });
      return { lng: sx / n, lat: sy / n, area: 0 };
    }
    return { lng: cx / (6 * area), lat: cy / (6 * area), area: Math.abs(area) };
  }

  function countryCentroid(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let best = null;
    polys.forEach(poly => {
      const c = ringCentroid(poly[0]); // outer ring only — holes don't matter for label placement
      if (!best || c.area > best.area) best = c;
    });
    return best || { lng: 0, lat: 0 };
  }

  function countryRings(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const rings = [];
    polys.forEach(poly => poly.forEach(ring => rings.push(ring)));
    return rings;
  }

  // ---- Info panel ----
  function showInfo(d) {
    infoPanel.classList.remove('hidden');
    if (d.kind === 'country') {
      infoBody.innerHTML = `<span class="kind">Country</span><h3>${d.name}</h3>`;
      return;
    }
    if (d.kind === 'disruption') {
      const lanes = d.affectsCorridors
        .map(id => mergedList('corridors').find(c => c.id === id))
        .filter(Boolean)
        .map(c => c.lane);
      infoBody.innerHTML = `
        <span class="kind">${d.type} signal</span>
        <h3>${d.name}</h3>
        <p class="sev">Severity ${d.severity} / 5</p>
        <p>${d.description}</p>
        <p class="kv"><b>Affected lanes:</b> ${[...new Set(lanes)].join(', ') || 'none'}</p>
      `;
      return;
    }
    const kindLabel = d.kind === 'port' ? 'Port' : d.kind === 'warehouse' ? 'Warehouse' : 'Factory';
    let rows = '';
    if (d.throughputTEU) rows += `<p class="kv">Annual throughput: ${Number(d.throughputTEU).toLocaleString()} TEU</p>`;
    if (d.sector) rows += `<p class="kv">Sector: ${d.sector}</p>`;
    if (d.feederPort) {
      const feeder = allNodesIndex()[d.feederPort];
      rows += `<p class="kv">Feeder port: ${feeder ? feeder.name : d.feederPort}</p>`;
    }
    if (d.detail) rows += `<p class="kv">${d.detail}</p>`;
    if (d.isBuffer) rows += `<p class="kv" style="color:${COLORS.buffer}"><b>Buffer stock active:</b> ${d.bufferNote}</p>`;
    if (d.isAltSupplier) rows += `<p class="kv" style="color:${COLORS.altsupplier}"><b>Alternate supplier active:</b> ${d.altNote}</p>`;
    if (d.source === 'custom') rows += `<p class="kv" style="color:${COLORS.warehouse}">From your imported network</p>`;
    infoBody.innerHTML = `<span class="kind">${kindLabel}</span><h3>${d.name}</h3>${rows}`;
  }

  // ---- Scenario panel ----
  function renderScenarioPanel(scenario) {
    scenarioNarrative.textContent = scenario.narrative;
    const chips = [];
    if (scenario.extraTransitDays > 0) {
      chips.push(`<span class="stat-chip warn">+${scenario.extraTransitDays} days transit</span>`);
    } else {
      chips.push(`<span class="stat-chip good">On-schedule</span>`);
    }
    chips.push(`<span class="stat-chip">${scenario.disabledCorridors.length} lanes suspended</span>`);
    chips.push(`<span class="stat-chip good">${scenario.addedArcs.length} reroutes active</span>`);
    if (scenario.bufferSites.length) chips.push(`<span class="stat-chip good">${scenario.bufferSites.length} buffer sites</span>`);
    if (scenario.alternateSuppliers.length) chips.push(`<span class="stat-chip good">${scenario.alternateSuppliers.length} alt suppliers</span>`);
    if (state.dataSource !== 'sample') {
      chips.push(`<span class="stat-chip">Scenario reroutes apply to the sample network</span>`);
    }
    scenarioStats.innerHTML = chips.join('');
  }

  // ---- CSV import ----
  const NODES_TEMPLATE = [
    'id,name,type,lat,lng,detail',
    'wh-dallas,Dallas Regional DC,warehouse,32.7767,-96.7970,"120,000 sq ft cross-dock, 3 days safety stock"',
    'port-savannah,Port of Savannah,port,32.0835,-81.0998,4th largest US container port',
    'plant-columbus,Columbus Assembly Plant,factory,39.9612,-82.9988,Tier-1 automotive assembly'
  ].join('\n') + '\n';

  const ROUTES_TEMPLATE = [
    'id,from,to,name,note',
    'dallas-savannah,wh-dallas,port-savannah,Inbound replenishment,Weekly LTL consolidation'
  ].join('\n') + '\n';

  function splitCSVLine(line) {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length);
    if (!lines.length) return [];
    const headers = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (cols[idx] ?? '').trim(); });
      rows.push(obj);
    }
    return rows;
  }

  function upsert(arr, item) {
    const i = arr.findIndex(x => x.id === item.id);
    if (i >= 0) arr[i] = item; else arr.push(item);
  }

  function reportStatus(message, kind) {
    networkStatus.textContent = message;
    networkStatus.classList.remove('error', 'success');
    if (kind) networkStatus.classList.add(kind);
  }

  function fitCameraToNodes(nodes) {
    if (!nodes.length) return;
    const lats = nodes.map(n => n.lat), lngs = nodes.map(n => n.lng);
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const spread = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs), 4);
    const altitude = Math.min(3, Math.max(0.5, spread / 35));
    world.pointOfView({ lat, lng, altitude }, 1200);
  }

  function handleNodesFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(String(reader.result));
      const errors = [];
      const counts = { port: 0, warehouse: 0, factory: 0 };
      rows.forEach((row, idx) => {
        const lineNo = idx + 2;
        const id = row.id, name = row.name, type = (row.type || '').toLowerCase();
        const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
        if (!id || !name) { errors.push(`Row ${lineNo}: missing id or name`); return; }
        if (!['port', 'warehouse', 'factory'].includes(type)) {
          errors.push(`Row ${lineNo}: type must be port, warehouse, or factory`); return;
        }
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
          errors.push(`Row ${lineNo}: invalid lat/lng`); return;
        }
        const node = { id, name, lat, lng, detail: row.detail || '' };
        if (type === 'port') { upsert(customNetwork.ports, node); counts.port++; }
        else if (type === 'warehouse') { upsert(customNetwork.warehouses, node); counts.warehouse++; }
        else { upsert(customNetwork.factories, node); counts.factory++; }
      });
      const total = counts.port + counts.warehouse + counts.factory;
      const summary = `Loaded ${total} node(s): ${counts.port} port(s), ${counts.warehouse} warehouse(s), ${counts.factory} factory/factories.`;
      reportStatus(errors.length ? `${summary} ${errors.length} row(s) skipped — ${errors.slice(0, 5).join('; ')}` : summary, errors.length ? 'error' : 'success');
      if (total > 0 && state.dataSource === 'sample') { state.dataSource = 'custom'; sourceSelect.value = 'custom'; }
      render();
      fitCameraToNodes([...customNetwork.ports, ...customNetwork.warehouses, ...customNetwork.factories]);
    };
    reader.readAsText(file);
  }

  function handleRoutesFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(String(reader.result));
      const errors = [];
      const idIndex = allNodesIndex();
      let count = 0;
      rows.forEach((row, idx) => {
        const lineNo = idx + 2;
        const from = row.from, to = row.to;
        if (!from || !to) { errors.push(`Row ${lineNo}: missing from/to`); return; }
        if (!idIndex[from] || !idIndex[to]) {
          errors.push(`Row ${lineNo}: "${!idIndex[from] ? from : to}" not found — upload matching nodes first`); return;
        }
        const id = row.id || `${from}-${to}`;
        upsert(customNetwork.corridors, { id, from, to, lane: row.name || row.lane || 'Route', note: row.note || '' });
        count++;
      });
      const summary = `Loaded ${count} route(s).`;
      reportStatus(errors.length ? `${summary} ${errors.length} row(s) skipped — ${errors.slice(0, 5).join('; ')}` : summary, errors.length ? 'error' : 'success');
      if (count > 0 && state.dataSource === 'sample') { state.dataSource = 'custom'; sourceSelect.value = 'custom'; }
      render();
    };
    reader.readAsText(file);
  }

  function downloadCSV(filename, content) {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  sourceSelect.addEventListener('change', () => { state.dataSource = sourceSelect.value; render(); });
  el('nodes-csv-input').addEventListener('change', e => { if (e.target.files[0]) handleNodesFile(e.target.files[0]); });
  el('routes-csv-input').addEventListener('change', e => { if (e.target.files[0]) handleRoutesFile(e.target.files[0]); });
  el('download-nodes-template').addEventListener('click', () => downloadCSV('nodes-template.csv', NODES_TEMPLATE));
  el('download-routes-template').addEventListener('click', () => downloadCSV('routes-template.csv', ROUTES_TEMPLATE));
  el('clear-network').addEventListener('click', () => {
    customNetwork.ports = []; customNetwork.warehouses = []; customNetwork.factories = []; customNetwork.corridors = [];
    state.dataSource = 'sample'; sourceSelect.value = 'sample';
    el('nodes-csv-input').value = ''; el('routes-csv-input').value = '';
    reportStatus('Cleared. Showing the sample network.', null);
    render();
  });

  // ---- Live signal feed (simulated) ----
  const feedTemplates = [
    n => `Monitoring update: severity holding for "${n}".`,
    n => `New satellite/AIS pass confirms elevated risk near "${n}".`,
    n => `Carrier advisory reiterated for "${n}".`,
    n => `Sensor network refreshed status for "${n}" — no material change.`
  ];

  function timeStr(date) {
    return date.toTimeString().slice(0, 8);
  }

  function addFeedItem(type, title, text) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="feed-time">${timeStr(new Date())}</span><span class="feed-type ${type}">${type}</span> — ${title}: ${text}`;
    signalFeed.prepend(li);
    while (signalFeed.children.length > 14) signalFeed.removeChild(signalFeed.lastChild);
  }

  function seedFeed() {
    signalFeed.innerHTML = '';
    [...disruptions].sort((a, b) => b.severity - a.severity).forEach(d => {
      addFeedItem(d.type, d.name, d.description);
    });
  }

  function tickFeed() {
    const d = disruptions[Math.floor(Math.random() * disruptions.length)];
    const template = feedTemplates[Math.floor(Math.random() * feedTemplates.length)];
    addFeedItem(d.type, d.name, template(d.name));
  }

  // ---- Clock ----
  function tickClock() {
    clockEl.textContent = timeStr(new Date());
  }
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(tickFeed, 6000);

  // ---- Main render ----
  function render() {
    const scenario = currentScenario();
    world
      .arcsData(state.toggles.corridors ? buildArcs(scenario) : [])
      .pointsData(buildPoints(scenario))
      .ringsData(buildRings())
      .labelsData(buildLabels())
      .polygonsData(state.toggles.borders ? COUNTRY_FEATURES : []);
    renderScenarioPanel(scenario);
    if (state.projection === '2d') drawMap2D(scenario);
  }

  seedFeed();
  render();
})();
