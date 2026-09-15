/* ============================================================
   Dynamic Cyber-Risk Assessment (DDRA) — JS port of ddra_model.py
   Attack-defence loop for a CyberShip ballast control system.
   Same Euler-integration equations as the paper's companion code —
   this is an independent re-implementation, not an export of Vensim.
   ============================================================ */

const BASE_PARAMS = {
  r_a: 0.50, e0: 0.45, e_max: 1.60, mu: 0.30,
  tau_d: 2.0, tau_m: 2.0, p_thr: 0.08, s: 0.01,
  R_max: 1.0, phi: 1.60, rho: 0.50, B_crit: 1.50,
  A0: 0.02, T: 30.0, dt: 0.01
};

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function simulate(overrides) {
  const p = Object.assign({}, BASE_PARAMS, overrides);
  const n = Math.floor(p.T / p.dt) + 1;
  const t = new Float64Array(n);
  const A = new Float64Array(n), P = new Float64Array(n), R = new Float64Array(n);
  const B = new Float64Array(n), E = new Float64Array(n);
  A[0] = p.A0; P[0] = 0; R[0] = 0; B[0] = 0; E[0] = p.e0;
  for (let k = 0; k < n; k++) t[k] = k * p.dt;

  let mobilised = false;
  let t_erad = NaN;
  const p_lo = (overrides && overrides.p_lo !== undefined) ? overrides.p_lo : null;
  const A_floor = (overrides && overrides.A_floor !== undefined) ? overrides.A_floor : 0.0;

  for (let k = 0; k < n - 1; k++) {
    let thr = p.p_thr;
    if (p_lo !== null) {
      if (P[k] > p.p_thr) mobilised = true;
      else if (P[k] < p_lo) mobilised = false;
      thr = mobilised ? p_lo : p.p_thr;
    }
    const act = sigmoid((P[k] - thr) / p.s);
    const R_star = p.R_max * act;

    const dA = p.r_a * A[k] * (1 - A[k]) - E[k] * R[k] * A[k];
    const dP = (A[k] - P[k]) / p.tau_d;
    const dR = (R_star - R[k]) / p.tau_m;
    const dB = p.phi * A[k] - p.rho * R[k] * B[k];
    const dE = p.mu * (p.e_max - E[k]) * act;

    let nextA = A[k] + dA * p.dt;
    nextA = Math.min(Math.max(nextA, 0), 1);
    if (A_floor > 0 && nextA > 0 && nextA < A_floor && R[k] > 0.5 * p.R_max) {
      nextA = 0;
      if (isNaN(t_erad)) t_erad = t[k + 1];
    }
    A[k + 1] = nextA;
    P[k + 1] = P[k] + dP * p.dt;
    R[k + 1] = Math.min(Math.max(R[k] + dR * p.dt, 0), p.R_max);
    B[k + 1] = Math.max(B[k] + dB * p.dt, 0);
    E[k + 1] = Math.min(E[k] + dE * p.dt, p.e_max);
  }
  p.t_erad = t_erad;
  return { t, A, P, R, B, E, p };
}

function hazardMetrics(t, B, p) {
  let idx = -1;
  for (let i = 0; i < B.length; i++) {
    if (B[i] >= p.B_crit) { idx = i; break; }
  }
  const hazard = idx !== -1;
  const tth = hazard ? t[idx] : NaN;
  let peak = 0;
  for (let i = 0; i < B.length; i++) if (B[i] > peak) peak = B[i];
  return { hazard, tth, peak };
}

/* ---------------- canvas plotting ---------------- */

function downsample(arr, targetN) {
  const n = arr.length;
  if (n <= targetN) return arr;
  const stride = Math.ceil(n / targetN);
  const out = [];
  for (let i = 0; i < n; i += stride) out.push(arr[i]);
  return out;
}

function drawChart(canvas, series, opts) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width, H = rect.height;
  const padL = 46, padR = 14, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  ctx.clearRect(0, 0, W, H);

  const xMin = opts.xDomain[0], xMax = opts.xDomain[1];
  const yMin = opts.yDomain[0], yMax = opts.yDomain[1];
  const xToPx = x => padL + ((x - xMin) / (xMax - xMin)) * plotW;
  const yToPx = y => padT + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  // grid
  ctx.strokeStyle = '#1c3350';
  ctx.lineWidth = 1;
  const gridLinesY = 4;
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#5f7a91';
  for (let i = 0; i <= gridLinesY; i++) {
    const yVal = yMin + (i / gridLinesY) * (yMax - yMin);
    const py = yToPx(yVal);
    ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR, py); ctx.stroke();
    ctx.fillText(opts.yFormat ? opts.yFormat(yVal) : yVal.toFixed(2), 4, py + 3);
  }
  const gridLinesX = 5;
  for (let i = 0; i <= gridLinesX; i++) {
    const xVal = xMin + (i / gridLinesX) * (xMax - xMin);
    const px = xToPx(xVal);
    ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, H - padB); ctx.stroke();
    ctx.fillText(xVal.toFixed(0), px - 8, H - 10);
  }

  // reference lines
  if (opts.refLines) {
    opts.refLines.forEach(rl => {
      const py = yToPx(rl.y);
      ctx.strokeStyle = rl.color || '#7f9cb3';
      ctx.setLineDash(rl.dash || [4, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR, py); ctx.stroke();
      ctx.setLineDash([]);
      if (rl.label) {
        ctx.fillStyle = rl.color || '#7f9cb3';
        ctx.fillText(rl.label, W - padR - ctx.measureText(rl.label).width - 4, py - 4);
      }
    });
  }

  // vertical marker (e.g. eradication time)
  if (opts.vMarker !== undefined && !isNaN(opts.vMarker)) {
    const px = xToPx(opts.vMarker);
    ctx.strokeStyle = '#7cff8a';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, H - padB); ctx.stroke();
    ctx.setLineDash([]);
  }

  // series
  series.forEach(s => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 1.8;
    ctx.setLineDash(s.dash || []);
    ctx.beginPath();
    for (let i = 0; i < s.x.length; i++) {
      const px = xToPx(s.x[i]);
      const yVal = Math.min(Math.max(s.y[i], yMin), yMax);
      const py = yToPx(yVal);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // border
  ctx.strokeStyle = '#2a4a63';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, padT, plotW, plotH);
}

/* ---------------- app wiring ---------------- */

function currentOverrides() {
  const tau_d = parseFloat(document.getElementById('tau_d').value);
  const r_a = parseFloat(document.getElementById('r_a').value);
  const policy = document.getElementById('policy').value;
  const horizon = parseFloat(document.getElementById('horizon').value);

  const overrides = { tau_d, r_a, T: horizon };
  if (policy === 'hysteresis') {
    overrides.p_lo = 0.01;
  } else if (policy === 'hysteresis_floor') {
    overrides.p_lo = 0.01;
    overrides.A_floor = 1e-3;
  }
  return overrides;
}

function render() {
  const overrides = currentOverrides();
  document.getElementById('tau_d_val').textContent = overrides.tau_d.toFixed(1) + ' d';
  document.getElementById('r_a_val').textContent = overrides.r_a.toFixed(2) + ' /d';

  const result = simulate(overrides);
  const { t, A, P, R, B, E, p } = result;
  const hz = hazardMetrics(t, B, p);

  const targetPoints = 1200;
  const tD = downsample(Array.from(t), targetPoints);
  const AD = downsample(Array.from(A), targetPoints);
  const PD = downsample(Array.from(P), targetPoints);
  const RD = downsample(Array.from(R), targetPoints);
  const BD = downsample(Array.from(B), targetPoints);

  const topCanvas = document.getElementById('chart-top');
  drawChart(topCanvas, [
    { x: tD, y: AD, color: '#e8a33d', width: 2 },
    { x: tD, y: PD, color: '#5fc9e8', width: 1.4, dash: [5, 4] },
    { x: tD, y: RD, color: '#c98bff', width: 1.4, dash: [2, 3] }
  ], {
    xDomain: [0, p.T], yDomain: [0, 1],
    vMarker: p.t_erad,
    refLines: [{ y: p.p_thr, color: '#4f6a80', dash: [2, 3], label: 'p_thr' }]
  });

  const botCanvas = document.getElementById('chart-bottom');
  drawChart(botCanvas, [
    { x: tD, y: BD, color: '#ff5c7a', width: 2 }
  ], {
    xDomain: [0, p.T], yDomain: [0, Math.max(p.B_crit * 1.3, hz.peak * 1.15)],
    vMarker: p.t_erad,
    refLines: [{ y: p.B_crit, color: '#ff5c7a', dash: [6, 4], label: 'B_crit (stability loss)' }]
  });

  const statusEl = document.getElementById('hazard-status');
  const metaEl = document.getElementById('hazard-meta');
  if (hz.hazard) {
    statusEl.textContent = 'HAZARD — stability loss';
    statusEl.className = 'status-chip status-bad';
    metaEl.textContent = `Ballast deviation crossed B_crit at t = ${hz.tth.toFixed(1)} days. Peak deviation ${hz.peak.toFixed(2)} m.`;
  } else {
    statusEl.textContent = 'Contained';
    statusEl.className = 'status-chip status-good';
    metaEl.textContent = `Peak ballast deviation ${hz.peak.toFixed(2)} m, stayed under B_crit = ${p.B_crit.toFixed(2)} m.`;
  }

  const eradEl = document.getElementById('erad-meta');
  if (!isNaN(p.t_erad)) {
    eradEl.textContent = `Attacker eradicated at t = ${p.t_erad.toFixed(1)} days (dashed green line).`;
    eradEl.style.display = 'block';
  } else {
    eradEl.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', function () {
  ['tau_d', 'r_a', 'policy', 'horizon'].forEach(id => {
    document.getElementById(id).addEventListener('input', render);
  });
  window.addEventListener('resize', render);
  render();
});
