"use strict";
/* Pharos dashboard. All data is precomputed by the trained models and loaded
   from ./data. Charts are hand-built SVG so the bundle stays small and the
   look stays consistent. */

const CATS = ["M01AB","M01AE","N02BA","N02BE","N05B","N05C","R03","R06"];
const CAT_COLORS = {M01AB:"#15736b",M01AE:"#2e6f9e",N02BA:"#6e8b3d",N02BE:"#b4463c",
                    N05B:"#7a6ca3",N05C:"#4c7a74",R03:"#c07b2e",R06:"#3f8e6e"};
const state = {};
const $ = s => document.querySelector(s);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = n => Math.round(n).toLocaleString("en-US");
const fmt1 = n => (Math.round(n*10)/10).toLocaleString("en-US");

/* ---------------- theme ---------------- */
(function initTheme(){
  const saved = localStorage.getItem("pharos-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  updateThemeLabel();
})();
function currentTheme(){
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function updateThemeLabel(){ $("#themeLabel").textContent = currentTheme()==="dark" ? "Light" : "Dark"; }
$("#themeBtn").addEventListener("click", () => {
  const next = currentTheme()==="dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("pharos-theme", next);
  updateThemeLabel(); renderAll();
});

/* ---------------- nav ---------------- */
const navBtns = [...document.querySelectorAll(".nav button")];
navBtns.forEach((b,i) => b.addEventListener("click", () => activate(b.dataset.panel)));
function activate(id){
  if(!document.getElementById(id)) return;
  navBtns.forEach(b => b.setAttribute("aria-current", String(b.dataset.panel===id)));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id===id));
  if(location.hash.slice(1) !== id) history.replaceState(null, "", "#"+id);
  renderAll();
}
addEventListener("hashchange", () => activate(location.hash.slice(1)));
addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  const n = parseInt(e.key,10);
  if (n>=1 && n<=navBtns.length) activate(navBtns[n-1].dataset.panel);
});

/* ---------------- svg helpers ---------------- */
function svgSize(svg){ const w = svg.clientWidth || svg.parentElement.clientWidth || 600;
  const h = +svg.getAttribute("height"); svg.setAttribute("viewBox",`0 0 ${w} ${h}`); return {w,h}; }
function path(xs, ys){ return xs.map((x,i)=>`${i?"L":"M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" "); }
function niceMax(v){ if(v<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(v)));
  const n=v/p; const m=n<=1?1:n<=2?2:n<=5?5:10; return m*p; }

const tip = $("#tip");
function showTip(x,y,text){ tip.textContent=text; tip.style.left=(x+12)+"px"; tip.style.top=(y-10)+"px"; tip.classList.add("on"); }
function hideTip(){ tip.classList.remove("on"); }

/* line chart: series=[{name,color,x:[],y:[],dashed,band:{lo:[],hi:[]}}], xcount, xticks:[{i,label}] */
function lineChart(svg, cfg){
  const {w,h} = svgSize(svg);
  const mL=42, mR=14, mT=12, mB=26;
  const ink3=cssVar("--ink-3"), line=cssVar("--line"), line2=cssVar("--line-2");
  const n = cfg.xcount;
  const xAt = i => mL + (n<=1?0:(w-mL-mR)*i/(n-1));
  let yMax = cfg.yMax ?? niceMax(Math.max(...cfg.series.flatMap(s=>[...s.y, ...(s.band?s.band.hi:[])]).filter(Number.isFinite)));
  const yMin = 0;
  const yAt = v => mT + (h-mT-mB)*(1-(v-yMin)/(yMax-yMin));
  let out = "";
  // grid + y labels
  const steps=4;
  for(let k=0;k<=steps;k++){ const v=yMax*k/steps, y=yAt(v);
    out += `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${w-mR}" y2="${y.toFixed(1)}" stroke="${line2}" stroke-width="1"/>`;
    out += `<text x="${mL-8}" y="${(y+3.5).toFixed(1)}" text-anchor="end" font-size="10.5" font-family="var(--mono)" fill="${ink3}">${fmt(v)}</text>`;
  }
  // x ticks
  (cfg.xticks||[]).forEach(t => { const x=xAt(t.i);
    out += `<text x="${x.toFixed(1)}" y="${h-8}" text-anchor="middle" font-size="10.5" fill="${ink3}">${t.label}</text>`; });
  // bands
  cfg.series.forEach(s => { if(!s.band) return;
    const xs=s.x.map(xAt); const up=s.band.hi.map(yAt); const lo=s.band.lo.map(yAt);
    const dd = path(xs,up) + " L"+xs[xs.length-1].toFixed(1)+" "+lo[lo.length-1].toFixed(1)+" "
      + [...xs].reverse().map((x,i)=>`L${x.toFixed(1)} ${[...lo].reverse()[i].toFixed(1)}`).join(" ")+" Z";
    out += `<path d="${dd}" fill="${s.color}" opacity="0.13"/>`; });
  // lines
  cfg.series.forEach(s => { const xs=s.x.map(xAt), ys=s.y.map(yAt);
    out += `<path d="${path(xs,ys)}" fill="none" stroke="${s.color}" stroke-width="${s.width||2}" ${s.dashed?'stroke-dasharray="5 4"':''} stroke-linejoin="round" stroke-linecap="round" opacity="${s.op||1}"/>`; });
  // vertical marker line for forecast split
  if (cfg.split != null){ const x=xAt(cfg.split);
    out += `<line x1="${x.toFixed(1)}" y1="${mT}" x2="${x.toFixed(1)}" y2="${h-mB}" stroke="${cssVar('--ink-3')}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`; }
  // value lookup per x index, so the hover marker works across every region
  const yByX = new Array(n).fill(null), cByX = new Array(n).fill(cfg.series[0].color);
  cfg.series.forEach(s => s.x.forEach((xi,k) => {
    if (Number.isFinite(s.y[k])) { yByX[xi] = s.y[k]; cByX[xi] = s.color; } }));
  // hover layer
  out += `<rect x="${mL}" y="${mT}" width="${w-mL-mR}" height="${h-mT-mB}" fill="transparent" id="hv"/>`;
  svg.innerHTML = out;
  const hv = svg.querySelector("#hv");
  const marker = document.createElementNS("http://www.w3.org/2000/svg","circle");
  marker.setAttribute("r","3.4"); marker.style.opacity="0";
  svg.appendChild(marker);
  hv.addEventListener("mousemove", e => {
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX-rect.left)*(w/rect.width);
    let i = Math.round((px-mL)/((w-mL-mR)/(n-1)));
    i = Math.max(0, Math.min(n-1, i));
    if (yByX[i] == null) { hideTip(); marker.style.opacity="0"; return; }
    marker.setAttribute("cx", xAt(i)); marker.setAttribute("cy", yAt(yByX[i]));
    marker.setAttribute("fill", cByX[i]); marker.style.opacity="1";
    showTip(e.clientX, e.clientY, cfg.tipText ? cfg.tipText(i) : fmt1(yByX[i]));
  });
  hv.addEventListener("mouseleave", () => { hideTip(); marker.style.opacity="0"; });
}

/* horizontal bars: rows=[{label,value,color,sub}] */
function barChart(svg, rows, opts={}){
  const {w,h} = svgSize(svg);
  const mL = opts.mL ?? 150, mR=46, mT=6, mB=6;
  const ink=cssVar("--ink-2"), ink3=cssVar("--ink-3");
  const max = opts.max ?? niceMax(Math.max(...rows.map(r=>r.value)));
  const bh = (h-mT-mB)/rows.length;
  let out="";
  rows.forEach((r,i) => {
    const y = mT + i*bh;
    const bw = (w-mL-mR) * (r.value/max);
    out += `<text x="${mL-10}" y="${(y+bh/2+3.5).toFixed(1)}" text-anchor="end" font-size="12.5" fill="${ink}">${r.label}</text>`;
    out += `<rect x="${mL}" y="${(y+bh*0.18).toFixed(1)}" width="${Math.max(bw,1).toFixed(1)}" height="${(bh*0.64).toFixed(1)}" rx="3" fill="${r.color}"/>`;
    out += `<text x="${(mL+bw+8).toFixed(1)}" y="${(y+bh/2+3.5).toFixed(1)}" font-size="12" font-family="var(--mono)" fill="${ink3}">${opts.fmt?opts.fmt(r.value):fmt(r.value)}</text>`;
  });
  svg.innerHTML = out;
}

/* ---------------- renderers ---------------- */
function renderOverview(){
  const m = state.meta, ov = m.overview, s = state.series;
  $("#asof1").textContent = "Data to "+m.as_of;
  // readouts
  const totalNext7 = CATS.reduce((a,c)=> a + s[c].forecast.forecast.slice(0,7).reduce((x,y)=>x+y,0), 0);
  const ro = [
    {lbl:"Forecast units, next 7 days", val:fmt(totalNext7), cls:"", meta:"across all groups"},
    {lbl:"Items to restock", val:ov.n_low_stock, cls: ov.n_low_stock? "warn":"", meta:"below reorder point"},
    {lbl:"Expiry alerts", val:ov.n_expiry, cls: ov.n_expiry? "danger":"", meta:"batches within 90 days"},
    {lbl:"Unusual days flagged", val:ov.n_unusual_days, cls:"", meta:"over "+m.n_days+" days"},
  ];
  $("#readouts").innerHTML = ro.map(r =>
    `<div class="readout"><div class="lbl">${r.lbl}</div><div class="val ${r.cls}">${r.val}</div><div class="meta">${r.meta}</div></div>`).join("");

  // trend chart: weekly history + dashed 4-week projection
  const wk = ov.weekly_total.slice(), wd = ov.weekly_dates.slice();
  const projWeekly = CATS.reduce((a,c)=>a+ov.forecast_next30[c],0)/30*7;
  const histX = wk.map((_,i)=>i);
  const projN = 4;
  const total = wk.length + projN;
  const xticks = [];
  for(let i=0;i<wk.length;i+=Math.floor(wk.length/5)) xticks.push({i, label: wd[i].slice(0,4)});
  const series = [
    {name:"History", color:cssVar("--primary"), x:histX, y:wk, width:1.8},
    {name:"Outlook", color:cssVar("--primary-strong"), x:[wk.length-1,...Array.from({length:projN},(_,i)=>wk.length+i)],
     y:[wk[wk.length-1], ...Array(projN).fill(projWeekly)], dashed:true, width:1.8},
  ];
  lineChart($("#trendChart"), {series, xcount: total, xticks, split: wk.length-1,
    tipText: i => i<wk.length ? `${wd[i]}  ${fmt(wk[i])} units` : `outlook ~${fmt(projWeekly)}/wk`});
  $("#trendLegend").innerHTML =
    `<span><i class="swatch line" style="background:${cssVar('--primary')}"></i>Weekly history</span>`+
    `<span><i class="swatch line" style="background:${cssVar('--primary-strong')};opacity:.7"></i>Model outlook</span>`;

  // mix
  const mix = CATS.map(c=>({label:s[c].name, value:ov.mix90[c], color:CAT_COLORS[c]}))
                  .sort((a,b)=>b.value-a.value);
  barChart($("#mixChart"), mix, {mL:150});
  // skill
  const skill = CATS.map(c=>({label:s[c].name, value:s[c].metrics.mae_skill_vs_seasonal_naive_pct, color:CAT_COLORS[c]}))
                    .sort((a,b)=>b.value-a.value);
  barChart($("#skillChart"), skill, {mL:150, max:40, fmt:v=>"+"+v+"%"});
}

function renderForecast(){
  const s = state.series, m = state.meta;
  $("#asof2").textContent = "Generated from "+m.as_of;
  if(!state.fcCat) state.fcCat = "N02BE";
  if(!state.fcH) state.fcH = 14;
  // category segmented control
  $("#catSeg").innerHTML = CATS.map(c =>
    `<button data-c="${c}" aria-pressed="${c===state.fcCat}">${c}</button>`).join("");
  $("#catSeg").querySelectorAll("button").forEach(b => b.onclick = () => { state.fcCat=b.dataset.c; renderForecast(); });
  $("#horizonSeg").querySelectorAll("button").forEach(b => { b.setAttribute("aria-pressed", String(+b.dataset.h===state.fcH));
    b.onclick = () => { state.fcH=+b.dataset.h; renderForecast(); }; });

  const cat = state.fcCat, d = s[cat];
  const hist = d.history.slice(-45);
  const fc = d.forecast;
  const H = state.fcH;
  const fdates = fc.dates.slice(0,H), fvals = fc.forecast.slice(0,H),
        flo = fc.lower.slice(0,H), fhi = fc.upper.slice(0,H);
  const histY = hist.map(p=>p.actual);
  const predY = hist.map(p=>p.predicted);
  const n = hist.length + H;
  const allDates = [...hist.map(p=>p.date), ...fdates];
  const xticks=[]; for(let i=0;i<n;i+=Math.floor(n/5)) xticks.push({i,label:allDates[i].slice(5)});
  const col = CAT_COLORS[cat];
  const series = [
    {name:"Actual", color:col, x:hist.map((_,i)=>i), y:histY, width:2},
    {name:"Model fit", color:cssVar("--ink-3"), x:hist.map((_,i)=>i).filter((_,i)=>predY[i]!=null),
     y:predY.filter(v=>v!=null), dashed:true, width:1.4, op:0.9},
    {name:"Forecast", color:cssVar("--primary"), x:Array.from({length:H},(_,i)=>hist.length+i), y:fvals,
     dashed:true, width:2.2, band:{lo:flo,hi:fhi}},
  ];
  lineChart($("#fcChart"), {series, xcount:n, xticks, split:hist.length-1,
    tipText:i => i<hist.length ? `${allDates[i]}  actual ${fmt1(histY[i])}` : `${allDates[i]}  forecast ${fmt1(fvals[i-hist.length])}`});
  $("#fcLegend").innerHTML =
    `<span><i class="swatch line" style="background:${col}"></i>Actual</span>`+
    `<span><i class="swatch line" style="background:${cssVar('--ink-3')}"></i>Model fit (backtest)</span>`+
    `<span><i class="swatch line" style="background:${cssVar('--primary')}"></i>Forecast</span>`+
    `<span><i class="swatch" style="background:${cssVar('--primary')};opacity:.18"></i>80% range</span>`;

  const mt = d.metrics;
  const next7 = fvals.slice(0,7).reduce((a,b)=>a+b,0);
  const nextH = fvals.reduce((a,b)=>a+b,0);
  const roc = [
    {lbl:`Units next 7 days`, val:fmt(next7), meta:d.name},
    {lbl:`Units next ${H} days`, val:fmt(nextH), meta:"total demand"},
    {lbl:"Mean error (MAE)", val:fmt1(mt.model.mae), meta:"units/day on held out test"},
    {lbl:"Skill vs baseline", val:"+"+mt.mae_skill_vs_seasonal_naive_pct+"%", meta:"lower MAE than seasonal naive"},
  ];
  $("#fcReadouts").innerHTML = roc.map(r =>
    `<div class="readout"><div class="lbl">${r.lbl}</div><div class="val">${r.val}</div><div class="meta">${r.meta}</div></div>`).join("");
  $("#fcNote").textContent = `${d.name} (${cat}). ${state.metaSeason(cat)} Tested on the last ${mt.test_days} days: `+
    `model MAE ${mt.model.mae} versus seasonal naive ${mt.seasonal_naive.mae} and persistence ${mt.naive_persistence.mae}.`;
}

function renderAlerts(){
  const inv = state.inventory;
  $("#asof3").textContent = "As of "+inv.as_of;
  const c = inv.counts;
  const ro = [
    {lbl:"Products tracked", val:inv.n_products, cls:""},
    {lbl:"Restock now", val:c.low_stock, cls:c.low_stock?"warn":""},
    {lbl:"Urgent or expired", val:c.expiring_urgent+c.expired, cls:(c.expiring_urgent+c.expired)?"danger":""},
    {lbl:"Expiring within 90 days", val:c.expiring_soon+c.expiring_urgent+c.expired, cls:""},
  ];
  $("#alertReadouts").innerHTML = ro.map(r =>
    `<div class="readout"><div class="lbl">${r.lbl}</div><div class="val ${r.cls}">${r.val}</div></div>`).join("");

  $("#lowCount").textContent = inv.low_stock.length+" items";
  $("#lowTable").innerHTML =
    `<thead><tr><th>Product</th><th class="num">On hand</th><th class="num">Reorder at</th><th class="num">Cover</th><th class="num">Order</th></tr></thead><tbody>`+
    inv.low_stock.map(r=>`<tr><td>${r.product}<div class="muted" style="font-size:11.5px">${r.category}</div></td>`+
      `<td class="num">${r.on_hand}</td><td class="num">${r.reorder_point}</td>`+
      `<td class="num">${r.cover_days}d</td><td class="num">${r.suggested_order}</td></tr>`).join("")+`</tbody>`;

  $("#expCount").textContent = inv.expiry.length+" batches";
  $("#expTable").innerHTML =
    `<thead><tr><th>Product</th><th>Batch</th><th class="num">Qty</th><th>Expiry</th><th></th></tr></thead><tbody>`+
    inv.expiry.map(r=>{ const lbl = r.severity==="expired"?"expired":r.severity==="urgent"?r.days_to_expiry+"d":r.days_to_expiry+"d";
      return `<tr><td>${r.product}</td><td class="mono" style="font-size:12px">${r.batch_no}</td>`+
      `<td class="num">${r.qty}</td><td class="mono" style="font-size:12px">${r.expiry}</td>`+
      `<td><span class="tag ${r.severity}">${lbl}</span></td></tr>`; }).join("")+`</tbody>`;
}

function renderAnomalies(){
  const a = state.anomalies, m = state.meta;
  $("#asof4").textContent = "Scanned "+m.n_days+" days";
  $("#anCount").textContent = a.n_unusual_days+" whole-day outliers";
  // timeline
  const svg = $("#anChart"); const {w,h}=svgSize(svg);
  const mL=10,mR=10,mT=14,mB=22;
  const days = a.unusual_days.map(d=>({t:new Date(d.date).getTime(), u:d.total_units, date:d.date, top:d.top_category}));
  const t0=new Date(m.data_span[0]).getTime(), t1=new Date(m.data_span[1]).getTime();
  const uMax=niceMax(Math.max(...days.map(d=>d.u)));
  const xAt=t=>mL+(w-mL-mR)*(t-t0)/(t1-t0);
  const yAt=u=>mT+(h-mT-mB)*(1-u/uMax);
  let out=`<line x1="${mL}" y1="${h-mB}" x2="${w-mR}" y2="${h-mB}" stroke="${cssVar('--line')}"/>`;
  // year labels
  for(let y=new Date(t0).getFullYear(); y<=new Date(t1).getFullYear(); y++){ const x=xAt(new Date(y,0,1).getTime());
    if(x>=mL&&x<=w-mR) out+=`<text x="${x.toFixed(1)}" y="${h-7}" font-size="10.5" fill="${cssVar('--ink-3')}" text-anchor="middle">${y}</text>`; }
  days.forEach(d=>{ out+=`<line x1="${xAt(d.t).toFixed(1)}" y1="${(h-mB).toFixed(1)}" x2="${xAt(d.t).toFixed(1)}" y2="${yAt(d.u).toFixed(1)}" stroke="${CAT_COLORS[d.top]||cssVar('--danger')}" stroke-width="2" opacity="0.8"/>`;
    out+=`<circle cx="${xAt(d.t).toFixed(1)}" cy="${yAt(d.u).toFixed(1)}" r="3" fill="${CAT_COLORS[d.top]||cssVar('--danger')}"/>`; });
  svg.innerHTML=out;

  $("#anTable").innerHTML =
    `<thead><tr><th>Date</th><th>Group</th><th></th><th class="num">Sold</th><th class="num">Expected</th><th class="num">z-score</th></tr></thead><tbody>`+
    a.residual_top.slice(0,20).map(r=>`<tr><td class="mono" style="font-size:12.5px">${r.date}</td>`+
      `<td>${r.category} <span class="muted" style="font-size:11px">${r.direction}</span></td>`+
      `<td><span class="tag cat">${r.category}</span></td>`+
      `<td class="num">${r.value}</td><td class="num">${r.expected}</td>`+
      `<td class="num" style="color:${r.direction==='spike'?cssVar('--danger'):cssVar('--info')}">${r.z>0?'+':''}${r.z}</td></tr>`).join("")+`</tbody>`;
}

/* ---------------- assistant (in-browser RAG) ---------------- */
const UNSAFE = /\b(how much|what dose|how many (pills|tablets)|should i take|can i take|is it safe for me|i (feel|have|took)|my (symptom|pain|dose|child)|overdos|mix with|combine with|interact)/i;
const SAFETY = {en:"I can share general information about these medicine groups, but not advice on personal doses, diagnoses or whether a medicine is safe for you. Please speak to a pharmacist or doctor for that.",
  ar:"يمكنني تقديم معلومات عامة عن هذه المجموعات الدوائية، لكن لا يمكنني تقديم نصائح حول الجرعات الشخصية أو التشخيص. يرجى مراجعة الصيدلي أو الطبيب.",
  fr:"Je peux donner des informations generales sur ces groupes de medicaments, mais pas de conseils sur les doses personnelles ou le diagnostic. Consultez un pharmacien ou un medecin.",
  es:"Puedo dar informacion general sobre estos grupos de medicamentos, pero no sobre dosis personales o diagnosticos. Consulte a un farmaceutico o medico.",
  de:"Ich kann allgemeine Informationen zu diesen Arzneimittelgruppen geben, aber keine Ratschlaege zu persoenlichen Dosen oder Diagnosen. Bitte wenden Sie sich an eine Apotheke oder einen Arzt."};
const INTRO = {en:"From the knowledge base:",ar:"من قاعدة المعرفة:",fr:"D'apres la base de connaissances :",es:"Segun la base de conocimiento:",de:"Aus der Wissensdatenbank:"};
const NOMATCH = {en:"I can only help with the eight drug groups in this catalogue (NSAIDs, analgesics, anxiolytics, sedatives, airway drugs and antihistamines) and how the platform works.",
  ar:"يمكنني المساعدة فقط في مجموعات الأدوية الثماني وكيفية عمل المنصة.",fr:"Je peux seulement aider sur les huit groupes de medicaments et le fonctionnement de la plateforme.",
  es:"Solo puedo ayudar con los ocho grupos de medicamentos y como funciona la plataforma.",de:"Ich kann nur zu den acht Arzneimittelgruppen und zur Funktionsweise der Plattform helfen."};

function detectLang(t){
  if(/[؀-ۿ]/.test(t)) return "ar";
  const low=" "+t.toLowerCase()+" ";
  const hints={fr:[" le "," la "," les "," pour "," avec "," est ","quoi","comment"],
    es:[" el "," la "," los "," para "," con "," que ","como","cuales"],
    de:[" der "," die "," das "," und "," ist "," wie "]};
  for(const [l,ws] of Object.entries(hints)) if(ws.filter(w=>low.includes(w)).length>=2) return l;
  return "en";
}
function tokenize(t){ return (t.toLowerCase().match(/[a-z]{2,}/g)||[]); }
function queryVec(q, idf){
  const toks=tokenize(q), tf={};
  toks.forEach(t=>tf[t]=(tf[t]||0)+1);
  for(let i=0;i<toks.length-1;i++){ const bg=toks[i]+" "+toks[i+1]; tf[bg]=(tf[bg]||0)+1; }
  const vec={}; let norm=0;
  for(const [term,f] of Object.entries(tf)){ if(idf[term]!=null){ const w=(1+Math.log(f))*idf[term]; vec[term]=w; norm+=w*w; } }
  norm=Math.sqrt(norm)||1; for(const k in vec) vec[k]/=norm; return vec;
}
function retrieve(q){
  const kb=state.knowledge, qv=queryVec(q, kb.idf);
  const scored = kb.docs.map(d=>{ let dot=0; for(const [t,w] of Object.entries(qv)) if(d.weights[t]) dot+=w*d.weights[t];
    return {doc:d, score:dot}; }).sort((a,b)=>b.score-a.score);
  return scored.filter(s=>s.score>=0.06).slice(0,3);
}
function answer(q){
  const lang=detectLang(q);
  if(UNSAFE.test(q)) return {text:SAFETY[lang]||SAFETY.en, sources:[], engine:"guardrail", lang};
  const hits=retrieve(q);
  if(!hits.length) return {text:NOMATCH[lang]||NOMATCH.en, sources:[], engine:"retrieval", lang};
  const body=hits.slice(0,2).map(h=>`${h.doc.title}: ${h.doc.text}`).join("\n\n");
  return {text:(INTRO[lang]||INTRO.en)+"\n\n"+body, sources:hits.map(h=>({title:h.doc.title,score:h.score})), engine:"local", lang};
}
function addMsg(text, who, sources, guard){
  const log=$("#chatLog");
  const div=document.createElement("div");
  div.className="msg "+who+(guard?" guard":"");
  div.textContent=text;
  if(sources&&sources.length){ const s=document.createElement("div"); s.className="src";
    s.innerHTML="<b>Sources:</b> "+sources.map(x=>`${x.title} (${x.score.toFixed(2)})`).join(" · "); div.appendChild(s); }
  log.appendChild(div); log.scrollTop=log.scrollHeight;
}
function ask(q){ if(!q.trim()) return; addMsg(q,"user");
  const r=answer(q); setTimeout(()=>addMsg(r.text,"bot",r.sources,r.engine==="guardrail"),140); }

function initAssistant(){
  if(state.assistantReady) return; state.assistantReady=true;
  const chips=["What is ibuprofen used for?","When does antihistamine demand peak?","How should inhalers be stored?","How do reorder points work?","Quel est l'usage du paracetamol ?"];
  $("#chips").innerHTML=chips.map(c=>`<button class="chip">${c}</button>`).join("");
  $("#chips").querySelectorAll(".chip").forEach(b=>b.onclick=()=>{ $("#chatInput").value=b.textContent; ask(b.textContent); $("#chatInput").value=""; });
  $("#chatForm").addEventListener("submit", e=>{ e.preventDefault(); const v=$("#chatInput").value; $("#chatInput").value=""; ask(v); });
  addMsg("Hello. Ask me about any of the eight drug groups, how to store them, when demand peaks, or how the platform works. I answer in your language and cite my sources.","bot");
}

/* ---------------- boot ---------------- */
let booted=false;
function renderAll(){
  if(!state.meta) return;
  const active=document.querySelector(".panel.active").id;
  try {
    if(active==="overview") renderOverview();
    else if(active==="forecast") renderForecast();
    else if(active==="alerts") renderAlerts();
    else if(active==="anomalies") renderAnomalies();
    else if(active==="assistant") initAssistant();
  } catch(err){ console.error(err); }
}
let rz; addEventListener("resize", ()=>{ clearTimeout(rz); rz=setTimeout(renderAll,150); });

async function boot(){
  const [meta,series,anomalies,inventory,knowledge] = await Promise.all(
    ["meta","series","anomalies","inventory","knowledge"].map(f=>fetch(`data/${f}.json`).then(r=>r.json())));
  state.meta=meta; state.series=series; state.anomalies=anomalies; state.inventory=inventory; state.knowledge=knowledge;
  state.metaSeason = c => meta.categories[c].seasonality;
  $("#asofFoot").textContent="Data to "+meta.as_of;
  $("#alertCount").textContent = meta.overview.n_low_stock + meta.overview.n_expiry || "";
  booted=true;
  const h = location.hash.slice(1);
  if(h && document.getElementById(h)) activate(h); else renderAll();
}
boot();
