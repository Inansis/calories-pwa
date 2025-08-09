/* PWA Calories App — RU UI, IndexedDB, CSV import/export (+предпросмотр), график с точками/подписями, сдвиг дня. */

// --- IndexedDB mini wrapper ---
const dbp = (() => {
  let _db;
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('calories-db', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('products')) {
        const s = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
  const dbReady = () => _db ? Promise.resolve(_db) : open();
  const tx = (store, mode='readonly') => dbReady().then(db => db.transaction(store, mode).objectStore(store));
  return {
    getAll: (store) => tx(store).then(s => new Promise((res, rej) => {
      const r = s.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    })),
    add: (store, obj) => tx(store, 'readwrite').then(s => new Promise((res, rej) => {
      const r = s.add(obj); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    })),
    put: (store, obj) => tx(store, 'readwrite').then(s => new Promise((res, rej) => {
      const r = s.put(obj); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    })),
    delete: (store, key) => tx(store, 'readwrite').then(s => new Promise((res, rej) => {
      const r = s.delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    })),
    get: (store, key) => tx(store).then(s => new Promise((res, rej) => {
      const r = s.get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    })),
  };
})();

// --- Settings ---
const Settings = {
  async get(key, def) { const rec = await dbp.get('settings', key).catch(()=>null); return rec ? rec.value : def; },
  async set(key, value) { return dbp.put('settings', { key, value }); },
  async initDefaults() {
    const defaults = { goalKcal: 2000, goalProt: 120, goalFat: 70, goalCarb: 220, dayStartHour: 3, darkTheme: false, specRecs: false };
    for (const [k,v] of Object.entries(defaults)) {
      const cur = await Settings.get(k, undefined);
      if (cur === undefined) await Settings.set(k, v);
    }
  }
};

// --- helpers ---
function logicalDay(date, dayStartHour){
  const d = new Date(date.getTime());
  d.setHours(d.getHours()-dayStartHour);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function formatDateISO(d){ return d.toISOString().slice(0,10); }

// --- UI mount ---
const view = document.getElementById('view');
const tabs = document.querySelectorAll('.tabs button');
tabs.forEach(b => b.addEventListener('click', () => {
  tabs.forEach(t => t.classList.remove('active'));
  b.classList.add('active');
  showTab(b.dataset.tab);
}));
document.getElementById('themeToggle').onclick = async ()=>{
  const cur = document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', !cur);
  await Settings.set('darkTheme', !cur);
};
async function applyTheme(){
  const dark = await Settings.get('darkTheme', false);
  document.documentElement.classList.toggle('dark', !!dark);
}

// --- TODAY ---
async function renderToday(){
  view.innerHTML = document.getElementById('tpl-today').innerHTML;
  document.getElementById('addManualBtn').onclick = () => openManualDialog();
  document.getElementById('addFromLibraryBtn').onclick = () => openLibraryPicker();
  await refreshToday();
}
async function refreshToday(){
  const dayStartHour = parseInt(await Settings.get('dayStartHour', 3));
  const now = new Date();
  const todayKey = +logicalDay(now, dayStartHour);

  const entries = (await dbp.getAll('entries'))
    .filter(e => +logicalDay(new Date(e.timestamp), dayStartHour) === todayKey)
    .sort((a,b)=>b.timestamp-a.timestamp);

  const sum = { kcal:0, prot:0, fat:0, carb:0 };
  entries.forEach(e => { sum.kcal+=e.kcal; sum.prot+=e.protein; sum.fat+=e.fat; sum.carb+=e.carb; });

  const gK = +await Settings.get('goalKcal', 2000);
  const gP = +await Settings.get('goalProt', 120);
  const gF = +await Settings.get('goalFat', 70);
  const gC = +await Settings.get('goalCarb', 220);

  const sumKcal = document.getElementById('sumKcal');
  const sumProt = document.getElementById('sumProt');
  const sumFat  = document.getElementById('sumFat');
  const sumCarb = document.getElementById('sumCarb');

  sumKcal.textContent = Math.round(sum.kcal);
  sumProt.textContent = Math.round(sum.prot);
  sumFat.textContent  = Math.round(sum.fat);
  sumCarb.textContent = Math.round(sum.carb);

  const color = (val, goal)=> val < goal ? 'red' : (val <= goal*1.10 ? 'green' : 'yellow');
  sumKcal.className = 'sum-value ' + color(sum.kcal, gK);
  sumProt.className = 'sum-value ' + color(sum.prot, gP);
  sumFat.className  = 'sum-value ' + color(sum.fat, gF);
  sumCarb.className = 'sum-value ' + color(sum.carb, gC);

  const list = document.getElementById('entriesList');
  list.innerHTML = '';
  for(const e of entries){
    const li = document.createElement('li');
    const left = document.createElement('div');
    const right = document.createElement('div');
    left.style.flex = '1';
    left.innerHTML = `<div><strong>${e.name}</strong></div>
      <div class="meta">Вес: ${Math.round(e.weight)} г</div>
      <div class="kpi"><span class="badge kcal">к ${Math.round(e.kcal)}</span>
      <span class="badge prot">б ${Math.round(e.protein)}</span>
      <span class="badge fat">ж ${Math.round(e.fat)}</span>
      <span class="badge carb">у ${Math.round(e.carb)}</span></div>`;
    right.innerHTML = `<button class="small" data-edit>✏️</button> <button class="small" data-del>🗑</button>`;
    right.style.whiteSpace = 'nowrap';
    li.append(left, right);
    list.appendChild(li);

    right.querySelector('[data-del]').onclick = async ()=>{ await dbp.delete('entries', e.id); refreshToday(); };
    right.querySelector('[data-edit]').onclick = async ()=>{
      const factor = e.weight ? (100.0 / e.weight) : 0;
      openManualDialog({
        name: e.name, weight: e.weight,
        kcal100: Math.round(e.kcal * factor),
        prot100: +(e.protein * factor).toFixed(1),
        fat100:  +(e.fat * factor).toFixed(1),
        carb100: +(e.carb * factor).toFixed(1),
        onSave: async (obj)=>{
          e.name = obj.name; e.weight = obj.weight;
          e.kcal = obj.kcal; e.protein = obj.protein; e.fat = obj.fat; e.carb = obj.carb;
          await dbp.put('entries', e); refreshToday();
        }
      });
    };
  }
}
function openManualDialog(prefill){
  const dlg = document.getElementById('dlgManual');
  const name = document.getElementById('mName');
  const w    = document.getElementById('mWeight');
  const k100 = document.getElementById('mKcal100');
  const p100 = document.getElementById('mProt100');
  const f100 = document.getElementById('mFat100');
  const c100 = document.getElementById('mCarb100');
  const btn  = document.getElementById('mSaveBtn');

  name.value = prefill?.name || '';
  w.value    = prefill?.weight ?? '';
  k100.value = prefill?.kcal100 ?? '';
  p100.value = prefill?.prot100 ?? '';
  f100.value = prefill?.fat100 ?? '';
  c100.value = prefill?.carb100 ?? '';

  btn.onclick = async (e)=>{
    e.preventDefault();
    if (!name.value.trim()) return;
    const weight = parseFloat(w.value); if (isNaN(weight) || weight < 0) return;
    const kcal100 = Math.max(0, parseFloat(k100.value)||0);
    const prot100 = Math.max(0, parseFloat(p100.value)||0);
    const fat100  = Math.max(0, parseFloat(f100.value)||0);
    const carb100 = Math.max(0, parseFloat(c100.value)||0);
    const factor = weight / 100.0;
    const obj = {
      name: name.value.trim(), weight,
      kcal: kcal100*factor, protein: prot100*factor, fat: fat100*factor, carb: carb100*factor,
      timestamp: Date.now()
    };
    if (prefill?.onSave) await prefill.onSave(obj); else await dbp.add('entries', obj);
    dlg.close(); refreshToday();
  };
  dlg.showModal();
}

// --- Library ---
async function renderLibrary(){
  view.innerHTML = document.getElementById('tpl-library').innerHTML;
  const list = document.getElementById('libList');
  const inp = document.getElementById('libSearch');
  const addBtn = document.getElementById('libAddBtn');
  const importBtn = document.getElementById('libImportBtn');
  const exportBtn = document.getElementById('libExportBtn');
  const file = document.getElementById('libImportFile');

  async function draw(){
    const q = (inp.value||'').trim().toLowerCase();
    const items = (await dbp.getAll('products'))
      .filter(p => !q || p.name.toLowerCase().includes(q))
      .sort((a,b)=> a.name.localeCompare(b.name));
    list.innerHTML = '';
    for(const p of items){
      const li = document.createElement('li');
      const left = document.createElement('div'); left.style.flex='1';
      left.innerHTML = `<div><strong>${p.name}</strong></div>
        <div class="meta">100 г: к ${Math.round(p.kcalPer100)}, б ${+(p.proteinPer100).toFixed(1)}, ж ${+(p.fatPer100).toFixed(1)}, у ${+(p.carbPer100).toFixed(1)}</div>`;
      const right = document.createElement('div');
      right.innerHTML = `<button class="small" data-use>➕</button> <button class="small" data-edit>✏️</button> <button class="small" data-del>🗑</button>`;
      li.append(left,right); list.appendChild(li);
      right.querySelector('[data-use]').onclick = ()=> openLibraryUse(p);
      right.querySelector('[data-edit]').onclick = ()=> openEditProduct(p);
      right.querySelector('[data-del]').onclick = async ()=>{ await dbp.delete('products', p.id); draw(); };
    }
  }

  inp.oninput = draw;
  addBtn.onclick = ()=> openEditProduct(null);
  exportBtn.onclick = exportLibraryCSV;
  importBtn.onclick = ()=> file.click();
  file.onchange = async ()=>{
    const f = file.files[0]; if (!f) return;
    const text = await f.text();
    await openCsvPreview(text);
    await draw();
    file.value = '';
  };

  await draw();
}
function openEditProduct(prod){
  const name = prompt("Название продукта/блюда:", prod?.name || "");
  if (name===null || !name.trim()) return;
  const num = (v)=> Math.max(0, parseFloat(v)||0);
  const prot = num(prompt("Белки /100г:",  prod?.proteinPer100 ?? 0));
  const fat  = num(prompt("Жиры /100г:",   prod?.fatPer100 ?? 0));
  const carb = num(prompt("Углеводы /100г:", prod?.carbPer100 ?? 0));
  let kcal   = prompt("Ккал /100г (пусто — рассчитать):", prod?.kcalPer100 ?? "");
  kcal = (kcal.trim()==="") ? prot*4 + fat*9 + carb*4 : num(kcal);

  const obj = { id: prod?.id, name: name.trim(),
    kcalPer100: kcal, proteinPer100: prot, fatPer100: fat, carbPer100: carb,
    createdAt: prod?.createdAt || Date.now()
  };
  if (prod?.id) dbp.put('products', obj); else dbp.add('products', obj);
  renderLibrary();
}
function openLibraryUse(prod){
  const dlg = document.getElementById('dlgLibAdd');
  document.getElementById('libSelName').textContent = prod.name;
  const weight = document.getElementById('libSelWeight'); weight.value = '';
  document.getElementById('libSelSave').onclick = async (e)=>{
    e.preventDefault();
    const w = Math.max(0, parseFloat(weight.value)||0);
    const factor = w/100.0;
    await dbp.add('entries', {
      name: prod.name, weight: w,
      kcal: prod.kcalPer100*factor, protein: prod.proteinPer100*factor, fat: prod.fatPer100*factor, carb: prod.carbPer100*factor,
      timestamp: Date.now()
    });
    dlg.close(); renderToday();
  };
  dlg.showModal();
}

// --- CSV Import/Export + Preview ---
async function exportLibraryCSV(){
  const items = await dbp.getAll('products');
  let csv = "Название;Ккал;Белки;Жиры;Углеводы\n";
  for(const p of items){ csv += `${p.name};${p.kcalPer100};${p.proteinPer100};${p.fatPer100};${p.carbPer100}\n`; }
  downloadText(csv, "Библиотека.csv");
}
async function openCsvPreview(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = lines.slice(1).map((line, idx) => {
    const parts = line.split(';');
    const rec = { idx: idx+1, raw: line, valid: false, name:'', kcal:0, prot:0, fat:0, carb:0, err:'' };
    if (parts.length !== 5) { rec.err='Ожидалось 5 столбцов'; return rec; }
    rec.name = parts[0].trim();
    const nums = parts.slice(1).map(v => v.trim()==='' ? 0 : Number(v));
    if (nums.some(n => Number.isNaN(n))) { rec.err = 'Неверные числа'; return rec; }
    if (nums.some(n => n < 0)) { rec.err = 'Отрицательные значения'; return rec; }
    rec.kcal = +nums[0]; rec.prot = +nums[1]; rec.fat = +nums[2]; rec.carb = +nums[3];
    rec.valid = !!rec.name; if (!rec.valid) rec.err = 'Пустое название';
    return rec;
  });
  const dlg = document.getElementById('dlgCsvPreview');
  const tb  = document.querySelector('#csvPreviewTable tbody');
  tb.innerHTML=''; rows.forEach(r=>{
    const tr = document.createElement('tr');
    if (!r.valid) tr.classList.add('error');
    tr.innerHTML = `<td>${r.idx}</td><td>${escapeHtml(r.name)}</td><td>${r.kcal}</td><td>${r.prot}</td><td>${r.fat}</td><td>${r.carb}</td><td>${r.valid?'OK':escapeHtml(r.err)}</td>`;
    tb.appendChild(tr);
  });
  return new Promise(resolve=>{
    dlg.showModal();
    const btn = document.getElementById('csvConfirmBtn');
    const handler = async (e)=>{
      e.preventDefault();
      for (const r of rows.filter(r=>r.valid)){
        await dbp.add('products', { name:r.name, kcalPer100:r.kcal, proteinPer100:r.prot, fatPer100:r.fat, carbPer100:r.carb, createdAt:Date.now() });
      }
      dlg.close(); btn.removeEventListener('click', handler); resolve(true);
    };
    btn.addEventListener('click', handler);
  });
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

async function exportHistoryCSV(){
  const all = await dbp.getAll('entries');
  let csv = "Дата;Название;Вес (г);Ккал;Белки;Жиры;Углеводы\n";
  for(const e of all.sort((a,b)=>a.timestamp-b.timestamp)){
    const d = new Date(e.timestamp);
    csv += `${formatDateISO(d)};${e.name};${Math.round(e.weight)};${Math.round(e.kcal)};${e.protein.toFixed(1)};${e.fat.toFixed(1)};${e.carb.toFixed(1)}\n`;
  }
  downloadText(csv, "История.csv");
}
function downloadText(text, filename){
  const blob = new Blob([text], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// --- Stats ---
async function renderStats(){
  view.innerHTML = document.getElementById('tpl-stats').innerHTML;
  const from = document.getElementById('statFrom');
  const to   = document.getElementById('statTo');
  const show = {
    kcal: document.getElementById('showKcal'),
    prot: document.getElementById('showProt'),
    fat:  document.getElementById('showFat'),
    carb: document.getElementById('showCarb'),
  };
  const now = new Date();
  const y = now.getFullYear(), m = ("0"+(now.getMonth()+1)).slice(-2), d = ("0"+now.getDate()).slice(-2);
  to.value = `${y}-${m}-${d}`;
  const weekAgo = new Date(now.getTime()-6*864e5);
  from.value = formatDateISO(weekAgo);

  const btns = Array.from(view.querySelectorAll('[data-preset]'));
  const showValuesInput = document.getElementById('showValuesToggle');
  showValuesInput.addEventListener('change', ()=>{ window.__showValues = showValuesInput.checked; redraw(); });

  const redraw = async ()=>{
    const data = await aggregateByDay(new Date(from.value), new Date(to.value));
    drawChart('chart', data, show);
    fillTable('statTable', data);
  };
  [from,to,show.kcal,show.prot,show.fat,show.carb].forEach(el => el.addEventListener('change', redraw));
  btns.forEach(b => b.onclick = ()=>{
    const code = b.dataset.preset; const n = new Date();
    if (code==='7'){ from.value = formatDateISO(new Date(n.getTime()-6*864e5)); to.value = formatDateISO(n); }
    else if (code==='30'){ from.value = formatDateISO(new Date(n.getTime()-29*864e5)); to.value = formatDateISO(n); }
    else if (code==='m0'){ const s = new Date(n.getFullYear(), n.getMonth(), 1); from.value = formatDateISO(s); to.value = formatDateISO(n); }
    else if (code==='m1'){ const s = new Date(n.getFullYear(), n.getMonth()-1, 1); const e = new Date(n.getFullYear(), n.getMonth(), 0); from.value = formatDateISO(s); to.value = formatDateISO(e); }
    redraw();
  });

  redraw();
}
async function aggregateByDay(from, to){
  const dayStartHour = parseInt(await Settings.get('dayStartHour', 3));
  const all = await dbp.getAll('entries');
  const map = new Map();
  for(const e of all){
    const d = logicalDay(new Date(e.timestamp), dayStartHour);
    if (d < new Date(from.getFullYear(), from.getMonth(), from.getDate())) continue;
    if (d > new Date(to.getFullYear(), to.getMonth(), to.getDate())) continue;
    const key = formatDateISO(d);
    const s = map.get(key) || { date: key, kcal:0, prot:0, fat:0, carb:0 };
    s.kcal += e.kcal; s.prot += e.protein; s.fat += e.fat; s.carb += e.carb;
    map.set(key, s);
  }
  return Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date));
}
function drawChart(canvasId, data, show){
  const c = document.getElementById(canvasId), ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  const padding = {l:40, r:10, t:10, b:24};
  const W = c.width - padding.l - padding.r;
  const H = c.height - padding.t - padding.b;
  const xs = data.map((_,i)=> padding.l + (i*(W/Math.max(1,data.length-1))));
  const maxVal = Math.max(1,
    (show.kcal.checked ? Math.max(...data.map(d=>d.kcal)) : 0),
    (show.prot.checked ? Math.max(...data.map(d=>d.prot)) : 0),
    (show.fat.checked  ? Math.max(...data.map(d=>d.fat))  : 0),
    (show.carb.checked ? Math.max(...data.map(d=>d.carb)) : 0)
  );
  const y = v => padding.t + H - (v/maxVal)*H;

  // grid
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border');
  ctx.lineWidth = 1; ctx.beginPath();
  for(let i=0;i<=4;i++){ const yy = padding.t + (i*(H/4)); ctx.moveTo(padding.l, yy); ctx.lineTo(padding.l+W, yy); }
  ctx.stroke();

  function line(color, arr){
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    arr.forEach((v,i)=>{ const X = xs[i], Y = y(v); if(i===0) ctx.moveTo(X,Y); else ctx.lineTo(X,Y); });
    ctx.stroke();
    // points + optional labels
    ctx.fillStyle = color;
    arr.forEach((v,i)=>{
      const X = xs[i], Y = y(v);
      ctx.beginPath(); ctx.arc(X, Y, 3, 0, Math.PI*2); ctx.fill();
      if (window.__showValues === true && data.length <= 30) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg');
        ctx.font = '11px -apple-system, Segoe UI, Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(v), X, Y-8);
        ctx.fillStyle = color;
      }
    });
  }
  const css = getComputedStyle(document.documentElement);
  if (show.kcal.checked) line(css.getPropertyValue('--kcal'), data.map(d=>d.kcal));
  if (show.prot.checked) line(css.getPropertyValue('--prot'), data.map(d=>d.prot));
  if (show.fat .checked) line(css.getPropertyValue('--fat' ), data.map(d=>d.fat ));
  if (show.carb.checked) line(css.getPropertyValue('--carb'), data.map(d=>d.carb));

  // x labels
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted');
  ctx.font = "12px -apple-system, Segoe UI, Roboto, sans-serif";
  data.forEach((d,i)=>{ const X = xs[i]; ctx.fillText(d.date.slice(5), X-14, padding.t+H+16); });
}
function fillTable(id, data){
  const tb = document.querySelector(`#${id} tbody`); tb.innerHTML = '';
  data.forEach(d=>{ const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.date}</td><td>${Math.round(d.kcal)}</td><td>${Math.round(d.prot)}</td><td>${Math.round(d.fat)}</td><td>${Math.round(d.carb)}</td>`;
    tb.appendChild(tr); });
}

// --- Settings ---
async function renderSettings(){
  view.innerHTML = document.getElementById('tpl-settings').innerHTML;
  const gK = document.getElementById('goalKcal');
  const gP = document.getElementById('goalProt');
  const gF = document.getElementById('goalFat');
  const gC = document.getElementById('goalCarb');
  const start = document.getElementById('dayStartHour');
  const dark = document.getElementById('darkTheme');
  const spec = document.getElementById('specRecs');
  const expH = document.getElementById('exportHistoryBtn');
  const expL = document.getElementById('exportLibraryBtn');

  gK.value = await Settings.get('goalKcal', 2000);
  gP.value = await Settings.get('goalProt', 120);
  gF.value = await Settings.get('goalFat', 70);
  gC.value = await Settings.get('goalCarb', 220);
  start.value = await Settings.get('dayStartHour', 3);
  dark.checked = await Settings.get('darkTheme', false);
  spec.checked = await Settings.get('specRecs', false);

  function saveGoals(){
    Settings.set('goalKcal', Math.max(0, parseInt(gK.value)||0));
    Settings.set('goalProt', Math.max(0, parseInt(gP.value)||0));
    Settings.set('goalFat',  Math.max(0, parseInt(gF.value)||0));
    Settings.set('goalCarb', Math.max(0, parseInt(gC.value)||0));
  }
  [gK,gP,gF,gC].forEach(el => el.addEventListener('change', saveGoals));
  [gP,gF,gC].forEach(el => el.addEventListener('change', ()=>{
    if (gK.value==="" || isNaN(parseInt(gK.value))) {
      const kcal = (+gP.value||0)*4 + (+gF.value||0)*9 + (+gC.value||0)*4;
      gK.value = Math.round(kcal);
      Settings.set('goalKcal', Math.round(kcal));
    }
  }));
  start.onchange = ()=> Settings.set('dayStartHour', Math.min(23, Math.max(0, parseInt(start.value)||0)));
  dark.onchange = ()=> { Settings.set('darkTheme', dark.checked); applyTheme(); };
  spec.onchange = ()=> Settings.set('specRecs', !!spec.checked);
  expH.onclick = exportHistoryCSV;
  expL.onclick = exportLibraryCSV;
}

// --- Routing ---
async function showTab(name){
  if (name==='today') await renderToday();
  else if (name==='library') await renderLibrary();
  else if (name==='stats') await renderStats();
  else if (name==='settings') await renderSettings();
}
async function openLibraryPicker(){ await showTab('library'); }

// --- Init ---
(async function init(){
  await Settings.initDefaults();
  await applyTheme();
  showTab('today');
})();
