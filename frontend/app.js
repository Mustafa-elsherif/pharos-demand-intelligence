"use strict";
/* Pharos dashboard. Every reading is precomputed by the trained models and read
   from ./data. Charts are hand-built SVG so the bundle stays small and the look
   stays consistent: one accent carries demand, status colour is used only where
   a reading needs a decision. */

const CATS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"];
const state = {};
const $ = s => document.querySelector(s);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = n => Math.round(n).toLocaleString("en-US");
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/* Optional live API. Leave unset to run fully in the browser on the exported
   index. Set window.PHAROS_API (or a <meta name="pharos-api">) to a Pharos API
   base to route the assistant through the backend, where Gemini answers in any
   language. No key ever lives in the browser. */
const API_BASE = (window.PHAROS_API ||
  (document.querySelector('meta[name="pharos-api"]') || {}).content || "").replace(/\/+$/, "");

/* ---------------- theme ---------------- */
(function initTheme() {
  const saved = localStorage.getItem("pharos-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  updateThemeLabel();
})();
function currentTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function updateThemeLabel() { $("#themeLabel").textContent = currentTheme() === "dark" ? "Light" : "Dark"; }
$("#themeBtn").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("pharos-theme", next);
  updateThemeLabel(); renderAll();
});

/* ---------------- nav ---------------- */
const navBtns = [...document.querySelectorAll(".nav button")];
navBtns.forEach(b => b.addEventListener("click", () => activate(b.dataset.panel)));
function activate(id) {
  if (!document.getElementById(id)) return;
  navBtns.forEach(b => b.setAttribute("aria-current", String(b.dataset.panel === id)));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === id));
  if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  renderAll();
}
addEventListener("hashchange", () => activate(location.hash.slice(1)));
addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= navBtns.length) activate(navBtns[n - 1].dataset.panel);
});

/* ---------------- svg helpers ---------------- */
function svgSize(svg) {
  const w = svg.clientWidth || svg.parentElement.clientWidth || 600;
  const h = +svg.getAttribute("height"); svg.setAttribute("viewBox", `0 0 ${w} ${h}`); return { w, h };
}
function path(xs, ys) { return xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" "); }
function niceMax(v) {
  if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p; const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10; return m * p;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

const tip = $("#tip");
function showTip(x, y, text) { tip.textContent = text; tip.style.left = (x + 12) + "px"; tip.style.top = (y - 10) + "px"; tip.classList.add("on"); }
function hideTip() { tip.classList.remove("on"); }

/* line chart: series=[{name,color,x:[],y:[],dashed,band:{lo:[],hi:[]}}] */
function lineChart(svg, cfg) {
  const { w, h } = svgSize(svg);
  const mL = 46, mR = 14, mT = 12, mB = 26;
  const ink3 = cssVar("--ink-3"), line2 = cssVar("--line-2");
  const n = cfg.xcount;
  const xAt = i => mL + (n <= 1 ? 0 : (w - mL - mR) * i / (n - 1));
  let yMax = cfg.yMax ?? niceMax(Math.max(...cfg.series.flatMap(s => [...s.y, ...(s.band ? s.band.hi : [])]).filter(Number.isFinite)));
  const yMin = 0;
  const yAt = v => mT + (h - mT - mB) * (1 - (v - yMin) / (yMax - yMin));
  let out = "";
  const steps = 4;
  for (let k = 0; k <= steps; k++) {
    const v = yMax * k / steps, y = yAt(v);
    out += `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${w - mR}" y2="${y.toFixed(1)}" stroke="${line2}" stroke-width="1"/>`;
    out += `<text x="${mL - 9}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10.5" font-family="var(--mono)" fill="${ink3}">${fmt(v)}</text>`;
  }
  (cfg.xticks || []).forEach(t => {
    const x = xAt(t.i);
    out += `<text x="${x.toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10.5" fill="${ink3}">${esc(t.label)}</text>`;
  });
  cfg.series.forEach(s => {
    if (!s.band) return;
    const xs = s.x.map(xAt); const up = s.band.hi.map(yAt); const lo = s.band.lo.map(yAt);
    const dd = path(xs, up) + " L" + xs[xs.length - 1].toFixed(1) + " " + lo[lo.length - 1].toFixed(1) + " "
      + [...xs].reverse().map((x, i) => `L${x.toFixed(1)} ${[...lo].reverse()[i].toFixed(1)}`).join(" ") + " Z";
    out += `<path d="${dd}" fill="${s.color}" opacity="0.14"/>`;
  });
  cfg.series.forEach(s => {
    const xs = s.x.map(xAt), ys = s.y.map(yAt);
    out += `<path d="${path(xs, ys)}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round" opacity="${s.op || 1}"/>`;
  });
  if (cfg.split != null) {
    const x = xAt(cfg.split);
    out += `<line x1="${x.toFixed(1)}" y1="${mT}" x2="${x.toFixed(1)}" y2="${h - mB}" stroke="${ink3}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`;
  }
  const yByX = new Array(n).fill(null), cByX = new Array(n).fill(cfg.series[0].color);
  cfg.series.forEach(s => s.x.forEach((xi, k) => {
    if (Number.isFinite(s.y[k])) { yByX[xi] = s.y[k]; cByX[xi] = s.color; }
  }));
  out += `<rect x="${mL}" y="${mT}" width="${w - mL - mR}" height="${h - mT - mB}" fill="transparent" id="hv"/>`;
  svg.innerHTML = out;
  const hv = svg.querySelector("#hv");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  marker.setAttribute("r", "3.4"); marker.style.opacity = "0";
  svg.appendChild(marker);
  hv.addEventListener("mousemove", e => {
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (w / rect.width);
    let i = Math.round((px - mL) / ((w - mL - mR) / (n - 1)));
    i = Math.max(0, Math.min(n - 1, i));
    if (yByX[i] == null) { hideTip(); marker.style.opacity = "0"; return; }
    marker.setAttribute("cx", xAt(i)); marker.setAttribute("cy", yAt(yByX[i]));
    marker.setAttribute("fill", cByX[i]); marker.style.opacity = "1";
    showTip(e.clientX, e.clientY, cfg.tipText ? cfg.tipText(i) : fmt1(yByX[i]));
  });
  hv.addEventListener("mouseleave", () => { hideTip(); marker.style.opacity = "0"; });
}

/* horizontal bars, one accent for all. rows=[{label,value,sub}] */
function barChart(svg, rows, opts = {}) {
  const { w, h } = svgSize(svg);
  const mL = opts.mL ?? 150, mR = 52, mT = 6, mB = 20;
  const ink = cssVar("--ink-2"), ink3 = cssVar("--ink-3"), track = cssVar("--line-2");
  const accent = cssVar("--accent");
  const max = opts.max ?? niceMax(Math.max(...rows.map(r => r.value)));
  const plotW = w - mL - mR;
  const bh = (h - mT - mB) / rows.length;
  const barH = Math.min(bh * 0.5, 20);
  let out = "";
  /* baseline + a single reference tick at the scale max, so bars are readable */
  out += `<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${(h - mB).toFixed(1)}" stroke="${cssVar("--line")}" stroke-width="1"/>`;
  out += `<text x="${(mL + plotW).toFixed(1)}" y="${(h - 6).toFixed(1)}" text-anchor="end" font-size="10" font-family="var(--mono)" fill="${ink3}">${opts.fmt ? opts.fmt(max) : fmt(max)}</text>`;
  out += `<text x="${mL}" y="${(h - 6).toFixed(1)}" text-anchor="start" font-size="10" font-family="var(--mono)" fill="${ink3}">0</text>`;
  rows.forEach((r, i) => {
    const yMid = mT + i * bh + bh / 2;
    const bw = plotW * (r.value / max);
    const by = yMid - barH / 2;
    out += `<text x="${mL - 12}" y="${(yMid + 3.5).toFixed(1)}" text-anchor="end" font-size="12" fill="${ink}">${esc(r.label)}</text>`;
    out += `<rect x="${mL}" y="${by.toFixed(1)}" width="${plotW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2.5" fill="${track}"/>`;
    out += `<rect x="${mL}" y="${by.toFixed(1)}" width="${Math.max(bw, 2).toFixed(1)}" height="${barH.toFixed(1)}" rx="2.5" fill="${accent}"/>`;
    out += `<text x="${(mL + plotW + 8).toFixed(1)}" y="${(yMid + 3.5).toFixed(1)}" font-size="12" font-family="var(--mono)" fill="${ink}">${opts.fmt ? opts.fmt(r.value) : fmt(r.value)}</text>`;
  });
  svg.innerHTML = out;
}

/* ---------------- renderers ---------------- */
function renderOverview() {
  const m = state.meta, ov = m.overview, s = state.series;
  $("#asof1").textContent = "Data to " + m.as_of;
  const totalNext7 = CATS.reduce((a, c) => a + s[c].forecast.forecast.slice(0, 7).reduce((x, y) => x + y, 0), 0);
  const ro = [
    { lbl: "Forecast demand, next 7 days", val: fmt(totalNext7), cls: "", meta: "units across all groups" },
    { lbl: "Items to restock", val: ov.n_low_stock, cls: ov.n_low_stock ? "warn" : "ok", meta: "below reorder point" },
    { lbl: "Expiry alerts", val: ov.n_expiry, cls: ov.n_expiry ? "danger" : "ok", meta: "batches within 90 days" },
    { lbl: "Unusual days flagged", val: ov.n_unusual_days, cls: "", meta: "over " + fmt(m.n_days) + " days" },
  ];
  $("#readouts").innerHTML = ro.map(r =>
    `<div class="readout"><div class="lbl">${r.lbl}</div><div class="val ${r.cls}">${r.val}</div><div class="meta">${r.meta}</div></div>`).join("");

  const wk = ov.weekly_total.slice(), wd = ov.weekly_dates.slice();
  const projWeekly = CATS.reduce((a, c) => a + ov.forecast_next30[c], 0) / 30 * 7;
  const histX = wk.map((_, i) => i);
  const projN = 4;
  const total = wk.length + projN;
  const xticks = [];
  for (let i = 0; i < wk.length; i += Math.floor(wk.length / 5)) xticks.push({ i, label: wd[i].slice(0, 4) });
  const series = [
    { name: "History", color: cssVar("--accent"), x: histX, y: wk, width: 1.8 },
    {
      name: "Outlook", color: cssVar("--accent-soft"), x: [wk.length - 1, ...Array.from({ length: projN }, (_, i) => wk.length + i)],
      y: [wk[wk.length - 1], ...Array(projN).fill(projWeekly)], dashed: true, width: 2
    },
  ];
  lineChart($("#trendChart"), {
    series, xcount: total, xticks, split: wk.length - 1,
    tipText: i => i < wk.length ? `${wd[i]}  ${fmt(wk[i])} units` : `outlook ~${fmt(projWeekly)}/wk`
  });
  $("#trendLegend").innerHTML =
    `<span><i class="swatch line" style="background:${cssVar('--accent')}"></i>Weekly history</span>` +
    `<span style="color:${cssVar('--accent-soft')}"><i class="swatch dash"></i>Model outlook</span>`;

  const mix = CATS.map(c => ({ label: s[c].name, value: ov.mix90[c] }))
    .sort((a, b) => b.value - a.value);
  barChart($("#mixChart"), mix, { mL: 182 });

  const skill = CATS.map(c => ({ label: s[c].name, value: s[c].metrics.mae_skill_vs_seasonal_naive_pct }))
    .sort((a, b) => b.value - a.value);
  barChart($("#skillChart"), skill, { mL: 182, max: 40, fmt: v => v + "%" });
}

function renderForecast() {
  const s = state.series, m = state.meta;
  $("#asof2").textContent = "Generated from " + m.as_of;
  if (!state.fcCat) state.fcCat = "N02BE";
  if (!state.fcH) state.fcH = 14;
  $("#catSeg").innerHTML = CATS.map(c =>
    `<button data-c="${c}" aria-pressed="${c === state.fcCat}">${c}</button>`).join("");
  $("#catSeg").querySelectorAll("button").forEach(b => b.onclick = () => { state.fcCat = b.dataset.c; renderForecast(); });
  $("#horizonSeg").querySelectorAll("button").forEach(b => {
    b.setAttribute("aria-pressed", String(+b.dataset.h === state.fcH));
    b.onclick = () => { state.fcH = +b.dataset.h; renderForecast(); };
  });

  const cat = state.fcCat, d = s[cat];
  const hist = d.history.slice(-45);
  const fc = d.forecast;
  const H = state.fcH;
  const fdates = fc.dates.slice(0, H), fvals = fc.forecast.slice(0, H),
    flo = fc.lower.slice(0, H), fhi = fc.upper.slice(0, H);
  const histY = hist.map(p => p.actual);
  const predY = hist.map(p => p.predicted);
  const n = hist.length + H;
  const allDates = [...hist.map(p => p.date), ...fdates];
  const xticks = []; for (let i = 0; i < n; i += Math.floor(n / 5)) xticks.push({ i, label: allDates[i].slice(5) });
  const accent = cssVar("--accent"), neutral = cssVar("--ink-3");
  const series = [
    { name: "Actual", color: accent, x: hist.map((_, i) => i), y: histY, width: 2 },
    {
      name: "Model fit", color: neutral, x: hist.map((_, i) => i).filter((_, i) => predY[i] != null),
      y: predY.filter(v => v != null), dashed: true, width: 1.4, op: 0.9
    },
    {
      name: "Forecast", color: accent, x: Array.from({ length: H }, (_, i) => hist.length + i), y: fvals,
      dashed: true, width: 2.2, band: { lo: flo, hi: fhi }
    },
  ];
  lineChart($("#fcChart"), {
    series, xcount: n, xticks, split: hist.length - 1,
    tipText: i => i < hist.length ? `${allDates[i]}  actual ${fmt1(histY[i])}` : `${allDates[i]}  forecast ${fmt1(fvals[i - hist.length])}`
  });
  $("#fcLegend").innerHTML =
    `<span><i class="swatch line" style="background:${accent}"></i>Actual</span>` +
    `<span style="color:${neutral}"><i class="swatch dash"></i>Model fit (backtest)</span>` +
    `<span style="color:${accent}"><i class="swatch dash"></i>Forecast</span>` +
    `<span><i class="swatch" style="background:${accent};opacity:.18"></i>80% range</span>`;

  const mt = d.metrics;
  const next7 = fvals.slice(0, 7).reduce((a, b) => a + b, 0);
  const nextH = fvals.reduce((a, b) => a + b, 0);
  const roc = [
    { lbl: `Units next 7 days`, val: fmt(next7), meta: d.name },
    { lbl: `Units next ${H} days`, val: fmt(nextH), meta: "total demand" },
    { lbl: "Mean error (MAE)", val: fmt1(mt.model.mae), meta: "units/day on held out test" },
    { lbl: "Skill vs baseline", val: "+" + mt.mae_skill_vs_seasonal_naive_pct + "%", meta: "lower MAE than seasonal naive" },
  ];
  $("#fcReadouts").innerHTML = roc.map(r =>
    `<div class="readout"><div class="lbl">${r.lbl}</div><div class="val">${r.val}</div><div class="meta">${r.meta}</div></div>`).join("");
  $("#fcNote").textContent = `${d.name} (${cat}). ${state.metaSeason(cat)} Tested on the last ${mt.test_days} days: ` +
    `model MAE ${mt.model.mae} versus seasonal naive ${mt.seasonal_naive.mae} and persistence ${mt.naive_persistence.mae}.`;
}

function renderAlerts() {
  const inv = state.inventory;
  $("#asof3").textContent = "As of " + inv.as_of;
  const c = inv.counts;
  const ro = [
    { lbl: "Products tracked", val: inv.n_products, cls: "" },
    { lbl: "Restock now", val: c.low_stock, cls: c.low_stock ? "warn" : "ok" },
    { lbl: "Urgent or expired", val: c.expiring_urgent + c.expired, cls: (c.expiring_urgent + c.expired) ? "danger" : "ok" },
    { lbl: "Expiring within 90 days", val: c.expiring_soon + c.expiring_urgent + c.expired, cls: "" },
  ];
  $("#alertReadouts").innerHTML = ro.map(r =>
    `<div class="readout"><div class="lbl">${r.lbl}</div><div class="val ${r.cls}">${r.val}</div></div>`).join("");

  $("#lowCount").textContent = inv.low_stock.length + (inv.low_stock.length === 1 ? " item" : " items");
  $("#lowTable").innerHTML =
    `<thead><tr><th>Product</th><th class="num">On hand <span class="u">units</span></th><th class="num">Reorder at <span class="u">units</span></th><th class="num">Cover <span class="u">days</span></th><th class="num">Order <span class="u">units</span></th></tr></thead><tbody>` +
    inv.low_stock.map(r => `<tr><td class="strong">${esc(r.product)}<div class="sub2">${r.category}</div></td>` +
      `<td class="num">${fmt(r.on_hand)}</td><td class="num">${fmt(r.reorder_point)}</td>` +
      `<td class="num">${fmt1(r.cover_days)}</td><td class="num">+${fmt(r.suggested_order)}</td></tr>`).join("") + `</tbody>`;

  $("#expCount").textContent = inv.expiry.length + (inv.expiry.length === 1 ? " batch" : " batches");
  $("#expTable").innerHTML =
    `<thead><tr><th>Product</th><th>Batch</th><th class="num">Qty <span class="u">units</span></th><th class="num">Expiry</th><th class="num">Status</th></tr></thead><tbody>` +
    inv.expiry.map(r => {
      const lbl = r.severity === "expired" ? "Expired"
        : (r.days_to_expiry + (r.days_to_expiry === 1 ? " day" : " days"));
      return `<tr><td class="strong">${esc(r.product)}</td><td class="mono" style="font-size:12px">${esc(r.batch_no)}</td>` +
        `<td class="num">${fmt(r.qty)}</td><td class="num">${esc(r.expiry)}</td>` +
        `<td class="num"><span class="tag ${r.severity}">${lbl}</span></td></tr>`;
    }).join("") + `</tbody>`;
}

function renderAnomalies() {
  const a = state.anomalies, m = state.meta;
  $("#asof4").textContent = "Scanned " + fmt(m.n_days) + " days";
  $("#anCount").textContent = a.n_unusual_days + " whole-day outliers";
  const svg = $("#anChart"); const { w, h } = svgSize(svg);
  const mL = 10, mR = 10, mT = 14, mB = 22;
  const days = a.unusual_days.map(d => ({ t: new Date(d.date).getTime(), u: d.total_units, date: d.date, top: d.top_category }));
  const t0 = new Date(m.data_span[0]).getTime(), t1 = new Date(m.data_span[1]).getTime();
  const uMax = niceMax(Math.max(...days.map(d => d.u)));
  const xAt = t => mL + (w - mL - mR) * (t - t0) / (t1 - t0);
  const yAt = u => mT + (h - mT - mB) * (1 - u / uMax);
  const danger = cssVar("--danger");
  let out = `<line x1="${mL}" y1="${h - mB}" x2="${w - mR}" y2="${h - mB}" stroke="${cssVar('--line')}"/>`;
  for (let y = new Date(t0).getFullYear(); y <= new Date(t1).getFullYear(); y++) {
    const x = xAt(new Date(y, 0, 1).getTime());
    if (x >= mL && x <= w - mR) out += `<text x="${x.toFixed(1)}" y="${h - 7}" font-size="10.5" fill="${cssVar('--ink-3')}" text-anchor="middle">${y}</text>`;
  }
  /* one colour: these are flagged days, nothing else. Height encodes the day's volume. */
  days.forEach(d => {
    out += `<line x1="${xAt(d.t).toFixed(1)}" y1="${(h - mB).toFixed(1)}" x2="${xAt(d.t).toFixed(1)}" y2="${yAt(d.u).toFixed(1)}" stroke="${danger}" stroke-width="1.6" opacity="0.55"/>`;
    out += `<circle cx="${xAt(d.t).toFixed(1)}" cy="${yAt(d.u).toFixed(1)}" r="2.8" fill="${danger}"/>`;
  });
  svg.innerHTML = out;

  const arrowUp = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 19V6M6 12l6-6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const arrowDn = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v13M6 12l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  $("#anTable").innerHTML =
    `<thead><tr><th>Date</th><th>Group</th><th>Movement</th><th class="num">Sold <span class="u">units</span></th><th class="num">Expected <span class="u">units</span></th><th class="num">z-score</th></tr></thead><tbody>` +
    a.residual_top.slice(0, 20).map(r => `<tr><td class="mono" style="font-size:12.5px">${esc(r.date)}</td>` +
      `<td><span class="tag cat">${esc(r.category)}</span></td>` +
      `<td><span class="dir ${r.direction}">${r.direction === 'spike' ? arrowUp + 'Spike' : arrowDn + 'Drop'}</span></td>` +
      `<td class="num">${fmt(r.value)}</td><td class="num">${fmt(r.expected)}</td>` +
      `<td class="num" style="color:${r.direction === 'spike' ? cssVar('--danger') : cssVar('--info')}">${r.z > 0 ? '+' : ''}${fmt1(r.z)}</td></tr>`).join("") + `</tbody>`;
}

/* ---------------- assistant ---------------- */
/* Guardrail: personal dosing, diagnosis and interaction advice are refused in
   any language. The pattern is English and Arabic leaning; the backend applies
   the same rule for every language it answers in. */
const UNSAFE = /\b(how much|what dose|how many (pills|tablets)|should i take|can i take|is it safe for me|i (feel|have|took)|my (symptom|pain|dose|child)|overdos|mix with|combine with|interact|dois-je|puis-je prendre|debo tomar|cuanto debo|wie viel soll|darf ich)\b|جرعت|اتناول|اخذ|اعراض/i;

/* Localised framing for the offline grounded fallback. The backend covers every
   language through Gemini; here we reply in the user's language for a broad set
   and in English otherwise, always grounded in the same data. Numbers, drug
   names and ATC codes stay as they are, so they read the same everywhere. */
const L = {
  en: {
    hello: "Hello. Ask about any of the eight drug groups, how to store them, when demand peaks, the stock and expiry alerts, or how the forecast works. I reply in your language and show where each answer comes from.",
    safety: "I can share general information about these medicine groups, but not advice on personal doses, diagnosis or whether a medicine is safe for you. Please speak to a pharmacist or doctor for that.",
    nomatch: "I can help with the eight drug groups in this catalogue, the stock and expiry alerts, the unusual-sales checks and how the forecast is built. Try a drug group, a product, or a word like restock, expiry or forecast.",
    from: "From the knowledge base:",
    restock: n => `${n} ${n === 1 ? "product is" : "products are"} below their reorder point right now:`,
    restockNone: "No products are below their reorder point right now.",
    expiry: (ex, ur, so) => `Expiry watch: ${ex} expired, ${ur} urgent (within 30 days), ${so} due within 90 days.`,
    forecastAll: (u, d) => `Forecast demand over the next 7 days is ${u} units across all groups, data to ${d}.`,
    forecastCat: (name, code, u) => `${name} (${code}): about ${u} units forecast over the next 7 days.`,
    anomaly: (n, days) => `${n} whole days over the last ${days} stood out from the normal product mix. The largest single-group swing:`,
    accuracy: p => `Across the eight groups the model's mean error is about ${p}% lower than a seasonal baseline on held-out data.`,
    group: "Group", examples: "Common drugs", seasonality: "Seasonality", forecast7: "Next 7 days", storage: "Storage",
  },
  ar: {
    hello: "مرحبا. اسأل عن أي من مجموعات الأدوية الثماني، أو طريقة تخزينها، أو مواسم الطلب، أو تنبيهات المخزون والصلاحية، أو كيفية عمل التنبؤ. أرد بلغتك وأبيّن مصدر كل إجابة.",
    safety: "يمكنني تقديم معلومات عامة عن هذه المجموعات الدوائية، لكن لا أقدم نصائح حول الجرعات الشخصية أو التشخيص أو مدى ملاءمة الدواء لك. يرجى مراجعة الصيدلي أو الطبيب.",
    nomatch: "يمكنني المساعدة في مجموعات الأدوية الثماني وتنبيهات المخزون والصلاحية وفحوص المبيعات غير المعتادة وكيفية بناء التنبؤ. جرّب اسم مجموعة أو منتج أو كلمة مثل مخزون أو صلاحية أو تنبؤ.",
    from: "من قاعدة المعرفة:",
    restock: n => `${n} من المنتجات حاليا تحت نقطة إعادة الطلب:`,
    restockNone: "لا توجد منتجات تحت نقطة إعادة الطلب حاليا.",
    expiry: (ex, ur, so) => `متابعة الصلاحية: ${ex} منتهية، ${ur} عاجلة (خلال 30 يوما)، ${so} خلال 90 يوما.`,
    forecastAll: (u, d) => `الطلب المتوقع خلال الأيام السبعة القادمة هو ${u} وحدة لكل المجموعات، حتى تاريخ ${d}.`,
    forecastCat: (name, code, u) => `${name} (${code}): نحو ${u} وحدة متوقعة خلال الأيام السبعة القادمة.`,
    anomaly: (n, days) => `${n} يوما خلال آخر ${days} يوما خرجت عن المزيج المعتاد. أكبر انحراف لمجموعة واحدة:`,
    accuracy: p => `عبر المجموعات الثماني، متوسط خطأ النموذج أقل بنحو ${p}% من الأساس الموسمي على بيانات اختبار.`,
    group: "المجموعة", examples: "أدوية شائعة", seasonality: "الموسمية", forecast7: "الأيام السبعة القادمة", storage: "التخزين",
  },
  fr: {
    hello: "Bonjour. Posez une question sur l'un des huit groupes de medicaments, leur conservation, les pics de demande, les alertes de stock et de peremption, ou le fonctionnement de la prevision. Je reponds dans votre langue et j'indique la source de chaque reponse.",
    safety: "Je peux donner des informations generales sur ces groupes de medicaments, mais pas de conseils sur les doses personnelles, le diagnostic ou la securite d'un medicament pour vous. Consultez un pharmacien ou un medecin.",
    nomatch: "Je peux aider sur les huit groupes de medicaments, les alertes de stock et de peremption, les ventes inhabituelles et la construction de la prevision. Essayez un groupe, un produit, ou un mot comme stock, peremption ou prevision.",
    from: "D'apres la base de connaissances :",
    restock: n => `${n} produit(s) sont actuellement sous leur point de recommande :`,
    restockNone: "Aucun produit n'est sous son point de recommande actuellement.",
    expiry: (ex, ur, so) => `Suivi de peremption : ${ex} perimes, ${ur} urgents (sous 30 jours), ${so} sous 90 jours.`,
    forecastAll: (u, d) => `La demande prevue sur les 7 prochains jours est de ${u} unites tous groupes confondus, donnees au ${d}.`,
    forecastCat: (name, code, u) => `${name} (${code}) : environ ${u} unites prevues sur les 7 prochains jours.`,
    anomaly: (n, days) => `${n} journees sur les ${days} dernieres se sont ecartees du mix habituel. Le plus grand ecart pour un groupe :`,
    accuracy: p => `Sur les huit groupes, l'erreur moyenne du modele est environ ${p}% plus faible qu'une reference saisonniere sur donnees de test.`,
    group: "Groupe", examples: "Medicaments courants", seasonality: "Saisonnalite", forecast7: "7 prochains jours", storage: "Conservation",
  },
  es: {
    hello: "Hola. Pregunta por cualquiera de los ocho grupos de medicamentos, como se almacenan, cuando sube la demanda, las alertas de stock y caducidad, o como funciona la prevision. Respondo en tu idioma e indico la fuente de cada respuesta.",
    safety: "Puedo dar informacion general sobre estos grupos de medicamentos, pero no consejos sobre dosis personales, diagnostico o si un medicamento es seguro para ti. Consulta a un farmaceutico o medico.",
    nomatch: "Puedo ayudar con los ocho grupos de medicamentos, las alertas de stock y caducidad, las ventas inusuales y como se construye la prevision. Prueba un grupo, un producto, o una palabra como stock, caducidad o prevision.",
    from: "Segun la base de conocimiento:",
    restock: n => `${n} producto(s) estan por debajo de su punto de pedido ahora mismo:`,
    restockNone: "Ningun producto esta por debajo de su punto de pedido ahora mismo.",
    expiry: (ex, ur, so) => `Control de caducidad: ${ex} caducados, ${ur} urgentes (en 30 dias), ${so} en 90 dias.`,
    forecastAll: (u, d) => `La demanda prevista para los proximos 7 dias es de ${u} unidades en todos los grupos, datos al ${d}.`,
    forecastCat: (name, code, u) => `${name} (${code}): unas ${u} unidades previstas para los proximos 7 dias.`,
    anomaly: (n, days) => `${n} dias de los ultimos ${days} se salieron de la mezcla habitual. La mayor desviacion de un grupo:`,
    accuracy: p => `En los ocho grupos, el error medio del modelo es un ${p}% menor que una referencia estacional en datos de prueba.`,
    group: "Grupo", examples: "Medicamentos comunes", seasonality: "Estacionalidad", forecast7: "Proximos 7 dias", storage: "Almacenamiento",
  },
  de: {
    hello: "Hallo. Fragen Sie nach einer der acht Arzneimittelgruppen, ihrer Lagerung, den Nachfragespitzen, den Bestands- und Verfallswarnungen oder zur Prognose. Ich antworte in Ihrer Sprache und zeige, woher jede Antwort stammt.",
    safety: "Ich kann allgemeine Informationen zu diesen Arzneimittelgruppen geben, aber keine Ratschlage zu persoenlichen Dosen, zur Diagnose oder dazu, ob ein Medikament fuer Sie sicher ist. Bitte wenden Sie sich an eine Apotheke oder einen Arzt.",
    nomatch: "Ich helfe bei den acht Arzneimittelgruppen, den Bestands- und Verfallswarnungen, den ungewoehnlichen Verkaeufen und dem Aufbau der Prognose. Versuchen Sie eine Gruppe, ein Produkt oder ein Wort wie Bestand, Verfall oder Prognose.",
    from: "Aus der Wissensdatenbank:",
    restock: n => `${n} Produkt(e) liegen derzeit unter ihrem Meldebestand:`,
    restockNone: "Derzeit liegt kein Produkt unter seinem Meldebestand.",
    expiry: (ex, ur, so) => `Verfallsueberwachung: ${ex} abgelaufen, ${ur} dringend (binnen 30 Tagen), ${so} binnen 90 Tagen.`,
    forecastAll: (u, d) => `Die prognostizierte Nachfrage fuer die naechsten 7 Tage betraegt ${u} Einheiten ueber alle Gruppen, Daten bis ${d}.`,
    forecastCat: (name, code, u) => `${name} (${code}): rund ${u} Einheiten fuer die naechsten 7 Tage prognostiziert.`,
    anomaly: (n, days) => `${n} von den letzten ${days} Tagen wichen vom ueblichen Produktmix ab. Der groesste Ausschlag einer Gruppe:`,
    accuracy: p => `Ueber die acht Gruppen liegt der mittlere Modellfehler etwa ${p}% unter einer saisonalen Referenz auf Testdaten.`,
    group: "Gruppe", examples: "Haeufige Wirkstoffe", seasonality: "Saisonalitaet", forecast7: "Naechste 7 Tage", storage: "Lagerung",
  },
};
/* A few more languages reuse English data templates but carry their own greeting
   and refusal, so the assistant still opens and declines in-language. */
["pt", "it", "nl", "ru", "tr", "zh", "ja", "ko", "hi"].forEach(k => { if (!L[k]) L[k] = Object.assign({}, L.en); });
Object.assign(L.pt, { hello: "Ola. Pergunte sobre qualquer um dos oito grupos de medicamentos, armazenamento, picos de procura, alertas de stock e validade, ou como funciona a previsao. Respondo no seu idioma.", safety: "Posso dar informacao geral sobre estes grupos de medicamentos, mas nao conselhos sobre doses pessoais, diagnostico ou seguranca para si. Consulte um farmaceutico ou medico." });
Object.assign(L.it, { hello: "Ciao. Chiedi di uno degli otto gruppi di farmaci, della conservazione, dei picchi di domanda, degli avvisi di scorte e scadenza, o di come funziona la previsione. Rispondo nella tua lingua.", safety: "Posso dare informazioni generali su questi gruppi di farmaci, ma non consigli su dosi personali, diagnosi o sicurezza per te. Rivolgiti a un farmacista o a un medico." });
Object.assign(L.nl, { hello: "Hallo. Vraag naar een van de acht geneesmiddelgroepen, bewaring, vraagpieken, voorraad- en vervalmeldingen, of hoe de voorspelling werkt. Ik antwoord in uw taal.", safety: "Ik kan algemene informatie geven over deze geneesmiddelgroepen, maar geen advies over persoonlijke doses, diagnose of veiligheid voor u. Raadpleeg een apotheker of arts." });
Object.assign(L.ru, { hello: "Здравствуйте. Спросите о любой из восьми групп препаратов, их хранении, пиках спроса, оповещениях о запасах и сроках годности или о том, как работает прогноз. Я отвечаю на вашем языке.", safety: "Я могу дать общую информацию об этих группах препаратов, но не советы по личным дозам, диагнозу или безопасности для вас. Обратитесь к фармацевту или врачу." });
Object.assign(L.tr, { hello: "Merhaba. Sekiz ilac grubundan herhangi biri, saklama, talep zirveleri, stok ve son kullanma uyarilari ya da tahminin nasil calistigi hakkinda soru sorun. Sizin dilinizde yanit veririm.", safety: "Bu ilac gruplari hakkinda genel bilgi verebilirim, ancak kisisel doz, tani veya sizin icin guvenli olup olmadigi konusunda tavsiye veremem. Lutfen bir eczaci veya doktora danisin." });
Object.assign(L.zh, { hello: "您好。可以询问八个药品组中的任意一个、储存方式、需求高峰、库存与效期提醒，或预测的工作原理。我会用您的语言回答。", safety: "我可以提供这些药品组的一般信息，但不能就个人剂量、诊断或某种药物是否适合您提供建议。请咨询药师或医生。" });
Object.assign(L.ja, { hello: "こんにちは。8つの薬効群、保管方法、需要のピーク、在庫と有効期限の通知、予測の仕組みについて質問できます。あなたの言語でお答えします。", safety: "これらの薬効群に関する一般的な情報はお伝えできますが、個人の用量、診断、安全性についての助言はできません。薬剤師または医師にご相談ください。" });
Object.assign(L.ko, { hello: "안녕하세요. 여덟 개 약물군, 보관 방법, 수요 급증, 재고 및 유효기간 알림, 예측 작동 방식에 대해 물어보세요. 사용하시는 언어로 답합니다.", safety: "이 약물군에 대한 일반 정보는 제공할 수 있지만 개인 용량, 진단, 안전 여부에 대한 조언은 드릴 수 없습니다. 약사나 의사와 상담하세요." });
Object.assign(L.hi, { hello: "नमस्ते। आठ दवा समूहों में से किसी के बारे में, भंडारण, मांग के शिखर, स्टॉक और समाप्ति अलर्ट, या पूर्वानुमान कैसे काम करता है, पूछें। मैं आपकी भाषा में उत्तर दूंगा।", safety: "मैं इन दवा समूहों की सामान्य जानकारी दे सकता हूं, लेकिन व्यक्तिगत खुराक, निदान या आपके लिए सुरक्षा पर सलाह नहीं। कृपया किसी फार्मासिस्ट या डॉक्टर से परामर्श करें।" });

function tr(lang, key, ...args) {
  const pack = L[lang] || L.en;
  let v = pack[key] !== undefined ? pack[key] : L.en[key];
  if (typeof v === "function") v = v(...args);
  return v;
}

function detectLang(t) {
  if (/[؀-ۿ]/.test(t)) return "ar";
  if (/[֐-׿]/.test(t)) return "he";
  if (/[Ѐ-ӿ]/.test(t)) return "ru";
  if (/[Ͱ-Ͽ]/.test(t)) return "el";
  if (/[ऀ-ॿ]/.test(t)) return "hi";
  if (/[가-힯]/.test(t)) return "ko";
  if (/[぀-ヿ]/.test(t)) return "ja";
  if (/[฀-๿]/.test(t)) return "th";
  if (/[一-鿿]/.test(t)) return "zh";
  const low = " " + t.toLowerCase() + " ";
  const hints = {
    fr: [" le ", " la ", " les ", " pour ", " avec ", " est ", " quel ", "quoi", "comment", "medicament", "peremption"],
    es: [" el ", " la ", " los ", " para ", " con ", " que ", "como", "cuales", "caducidad", "medicamento"],
    de: [" der ", " die ", " das ", " und ", " ist ", " wie ", " fuer ", "lagerung", "bestand"],
    it: [" il ", " lo ", " gli ", " per ", " con ", " che ", "come", "scadenza", "farmaci"],
    pt: [" o ", " os ", " para ", " com ", " que ", "como", "validade", "medicamento", "estoque"],
    nl: [" de ", " het ", " een ", " voor ", " met ", " hoe ", "voorraad", "vervaldatum"],
    tr: [" ve ", " bir ", " icin ", " nasil ", " nedir ", "stok", "ilac", "tarihi"],
  };
  let best = "en", bestN = 1;
  for (const [l, ws] of Object.entries(hints)) {
    const n = ws.filter(w => low.includes(w)).length;
    if (n > bestN) { bestN = n; best = l; }
  }
  return best;
}

/* in-browser TF-IDF retrieval over the exported knowledge index */
function tokenize(t) { return (t.toLowerCase().match(/[a-z]{2,}/g) || []); }
function queryVec(q, idf) {
  const toks = tokenize(q), tf = {};
  toks.forEach(t => tf[t] = (tf[t] || 0) + 1);
  for (let i = 0; i < toks.length - 1; i++) { const bg = toks[i] + " " + toks[i + 1]; tf[bg] = (tf[bg] || 0) + 1; }
  const vec = {}; let norm = 0;
  for (const [term, f] of Object.entries(tf)) { if (idf[term] != null) { const w = (1 + Math.log(f)) * idf[term]; vec[term] = w; norm += w * w; } }
  norm = Math.sqrt(norm) || 1; for (const k in vec) vec[k] /= norm; return vec;
}
function retrieve(q) {
  const kb = state.knowledge, qv = queryVec(q, kb.idf);
  const scored = kb.docs.map(d => {
    let dot = 0; for (const [t, w] of Object.entries(qv)) if (d.weights[t]) dot += w * d.weights[t];
    return { doc: d, score: dot };
  }).sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score >= 0.06).slice(0, 3);
}

/* Which drug group, if any, a short/casual message points at: ATC code, display
   name, group name or a brand/example drug all resolve to a category. */
function matchCategory(q) {
  const low = q.toLowerCase();
  for (const c of CATS) if (new RegExp("\\b" + c.toLowerCase() + "\\b").test(low)) return c;
  const meta = state.meta.categories;
  for (const c of CATS) {
    const m = meta[c];
    if (low.includes(m.name.toLowerCase())) return c;
    if (m.examples.some(e => low.includes(e.toLowerCase().split(" ")[0]))) return c;
  }
  return null;
}

/* Intent from short/casual input. Keywords are English-leaning; the backend
   handles every language, so here we cover the common operational words. */
function detectIntent(q) {
  const s = q.toLowerCase();
  if (/\b(restock|re-?order|reorder|low stock|out of stock|order more|running low)\b|مخزون|stock bas|bajo stock|nachbestell/.test(s)) return "restock";
  if (/\b(expir|expiry|expire|batch|shelf life|use by)\b|صلاحي|peremption|caducidad|verfall/.test(s)) return "expiry";
  if (/\b(anomal|unusual|outlier|spike|drop|strange|weird)\b|غير معتاد|anormal|inusual|ungewoehnlich/.test(s)) return "anomaly";
  if (/\b(accuracy|how good|error|mae|skill|reliable|trust)\b|دقة|precision|genauigkeit/.test(s)) return "accuracy";
  if (/\b(forecast|demand|predict|next week|next 7|how many|how much will|units)\b|تنبؤ|طلب|prevision|prevoir|nachfrage|prognose/.test(s)) return "forecast";
  return null;
}

function catAnswer(lang, c) {
  const m = state.meta.categories[c], d = state.series[c];
  const next7 = d.forecast.forecast.slice(0, 7).reduce((a, b) => a + b, 0);
  const text =
    `${d.name} (${c}). ${m.group}.\n` +
    `${tr(lang, "examples")}: ${m.examples.join(", ")}.\n` +
    `${tr(lang, "seasonality")}: ${m.seasonality}\n` +
    `${tr(lang, "forecast7")}: ~${fmt(next7)} ${lang === "en" ? "units" : ""}`.trim() + ".";
  const follow = [
    { label: tr(lang, "storage"), q: `How should ${m.name} be stored?` },
    { label: tr(lang, "seasonality"), q: `When does ${m.name} demand peak?` },
    { label: tr(lang, "forecast7") + " ›", q: `forecast ${c}` },
  ];
  return { text, sources: [{ title: `${d.name} (${c})`, score: 1 }], engine: "data", follow };
}

function localAnswer(q) {
  const lang = detectLang(q);
  if (UNSAFE.test(q)) return { text: tr(lang, "safety"), sources: [], engine: "guardrail", guard: true, follow: [] };

  const cat = matchCategory(q);
  const intent = detectIntent(q);
  const inv = state.inventory, an = state.anomalies, m = state.meta;

  if (intent === "restock") {
    const rows = inv.low_stock;
    if (!rows.length) return { text: tr(lang, "restockNone"), sources: [], engine: "data", follow: [] };
    const lines = rows.map(r => `  ${r.product} (${r.category}): ${r.on_hand} on hand, reorder at ${r.reorder_point}, order +${r.suggested_order}`).join("\n");
    return { text: tr(lang, "restock", rows.length) + "\n" + lines, sources: [{ title: "Stock alerts", score: 1 }], engine: "data", follow: [{ label: tr(lang, "storage"), q: "How do reorder points work?" }] };
  }
  if (intent === "expiry") {
    const c = inv.counts;
    const lines = inv.expiry.map(r => `  ${r.product} - batch ${r.batch_no}, ${r.qty} units, ${r.severity === "expired" ? "expired" : r.days_to_expiry + " days"} (${r.expiry})`).join("\n");
    return { text: tr(lang, "expiry", c.expired, c.expiring_urgent, c.expiring_soon + c.expiring_urgent + c.expired) + "\n" + lines, sources: [{ title: "Expiry management", score: 1 }], engine: "data", follow: [] };
  }
  if (intent === "anomaly") {
    const top = an.residual_top[0];
    return { text: tr(lang, "anomaly", an.n_unusual_days, fmt(m.n_days)) + `\n  ${top.date} ${top.category}: ${top.value} vs expected ${top.expected} (z ${top.z > 0 ? "+" : ""}${top.z}).`, sources: [{ title: "Unusual sales days", score: 1 }], engine: "data", follow: [] };
  }
  if (intent === "accuracy") {
    return { text: tr(lang, "accuracy", m.metrics_summary.avg_mae_skill_vs_seasonal_naive_pct), sources: [{ title: "How the demand forecast is made", score: 1 }], engine: "data", follow: [] };
  }
  if (intent === "forecast") {
    if (cat) {
      const next7 = state.series[cat].forecast.forecast.slice(0, 7).reduce((a, b) => a + b, 0);
      return { text: tr(lang, "forecastCat", state.series[cat].name, cat, fmt(next7)), sources: [{ title: `${state.series[cat].name} (${cat})`, score: 1 }], engine: "data", follow: [{ label: tr(lang, "seasonality"), q: `When does ${state.meta.categories[cat].name} demand peak?` }] };
    }
    const total = CATS.reduce((a, c) => a + state.series[c].forecast.forecast.slice(0, 7).reduce((x, y) => x + y, 0), 0);
    return { text: tr(lang, "forecastAll", fmt(total), m.as_of), sources: [{ title: "How the demand forecast is made", score: 1 }], engine: "data", follow: [] };
  }

  if (cat && !intent) return catAnswer(lang, cat);

  const hits = retrieve(q);
  if (!hits.length) return { text: tr(lang, "nomatch"), sources: [], engine: "retrieval", follow: [] };
  const body = hits.slice(0, 2).map(h => `${h.doc.title}: ${h.doc.text}`).join("\n\n");
  return { text: tr(lang, "from") + "\n\n" + body, sources: hits.map(h => ({ title: h.doc.title, score: h.score })), engine: "local", follow: [] };
}

async function getAnswer(q) {
  if (API_BASE) {
    try {
      const r = await fetch(API_BASE + "/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q })
      });
      if (r.ok) {
        const j = await r.json();
        return { text: j.answer, sources: j.sources || [], engine: j.engine || "gemini", guard: j.engine === "guardrail", follow: [] };
      }
    } catch (e) { /* fall through to the in-browser grounded fallback */ }
  }
  return localAnswer(q);
}

function addMsg(text, who, sources, guard) {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = "msg " + who + (guard ? " guard" : "");
  div.textContent = text;
  if (sources && sources.length) {
    const s = document.createElement("div"); s.className = "src";
    s.innerHTML = "<b>Source:</b> " + sources.map(x => `${esc(x.title)}${x.score < 1 ? ` (${x.score.toFixed(2)})` : ""}`).join(" · ");
    div.appendChild(s);
  }
  log.appendChild(div); log.scrollTop = log.scrollHeight;
  return div;
}
function addFollowups(items) {
  if (!items || !items.length) return;
  const log = $("#chatLog");
  const wrap = document.createElement("div"); wrap.className = "followups";
  items.forEach(it => {
    const b = document.createElement("button");
    b.textContent = it.label; b.onclick = () => ask(it.q, it.label);
    wrap.appendChild(b);
  });
  log.appendChild(wrap); log.scrollTop = log.scrollHeight;
}

let asking = false;
async function ask(q, display) {
  if (!q || !q.trim() || asking) return;
  asking = true;
  addMsg(display || q, "user");
  const typing = addMsg("…", "bot"); typing.classList.add("typing");
  try {
    const r = await getAnswer(q);
    typing.remove();
    addMsg(r.text, "bot", r.sources, r.guard);
    addFollowups(r.follow);
  } catch (e) {
    typing.remove();
    addMsg(localAnswer(q).text, "bot");
  } finally { asking = false; }
}

function initAssistant() {
  if (state.assistantReady) return; state.assistantReady = true;
  const chips = ["What is ibuprofen used for?", "When does antihistamine demand peak?", "What needs restocking?", "How do reorder points work?", "¿Que hay que reponer?", "Quand la demande d'antihistaminiques augmente-t-elle ?"];
  $("#chips").innerHTML = chips.map(c => `<button class="chip">${esc(c)}</button>`).join("");
  $("#chips").querySelectorAll(".chip").forEach(b => b.onclick = () => ask(b.textContent));
  $("#chatForm").addEventListener("submit", e => { e.preventDefault(); const v = $("#chatInput").value; $("#chatInput").value = ""; ask(v); });
  addMsg(tr("en", "hello"), "bot");
}

/* ---------------- boot ---------------- */
function renderAll() {
  if (!state.meta) return;
  const active = document.querySelector(".panel.active").id;
  try {
    if (active === "overview") renderOverview();
    else if (active === "forecast") renderForecast();
    else if (active === "alerts") renderAlerts();
    else if (active === "anomalies") renderAnomalies();
    else if (active === "assistant") initAssistant();
  } catch (err) { console.error(err); }
}
let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(renderAll, 150); });

async function boot() {
  const [meta, series, anomalies, inventory, knowledge] = await Promise.all(
    ["meta", "series", "anomalies", "inventory", "knowledge"].map(f => fetch(`data/${f}.json`).then(r => r.json())));
  state.meta = meta; state.series = series; state.anomalies = anomalies; state.inventory = inventory; state.knowledge = knowledge;
  state.metaSeason = c => meta.categories[c].seasonality;
  $("#asofFoot").textContent = meta.as_of;
  $("#alertCount").textContent = meta.overview.n_low_stock + meta.overview.n_expiry || "";
  $("#engineLabel").textContent = API_BASE ? "Connected to Pharos API" : "Local models loaded";
  const h = location.hash.slice(1);
  if (h && document.getElementById(h)) activate(h); else renderAll();
}
boot();
