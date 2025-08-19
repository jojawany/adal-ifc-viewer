import * as THREE from 'three';
import { IfcViewerAPI } from 'web-ifc-viewer';
import Chart from 'chart.js/auto';

/* ===== DOM ===== */
const container   = document.getElementById('viewer');
const statusEl    = document.getElementById('status');
const fileInput   = document.getElementById('file');
const clearBtn    = document.getElementById('clear');
const fitBtn      = document.getElementById('fit');
const gridBtn     = document.getElementById('grid');
const axesBtn     = document.getElementById('axes');
const themeBtn    = document.getElementById('theme');
const openUrl     = document.getElementById('openUrl');
const openUrlBtn  = document.getElementById('openUrlBtn');

const propsWrap   = document.getElementById('props');
const copyGidBtn  = document.getElementById('copyGid');
const downloadBtn = document.getElementById('downloadProps');

const treeWrap    = document.getElementById('tree');
const treeCount   = document.getElementById('treeCount');
const tabProps    = document.getElementById('tab-props');
const tabTree     = document.getElementById('tab-tree');
const tabStats    = document.getElementById('tab-stats');
const panelProps  = document.getElementById('panel-props');
const panelTree   = document.getElementById('panel-tree');
const panelStats  = document.getElementById('panel-stats');

const statsList   = document.getElementById('statsList');
const statsChartCanvas = document.getElementById('statsChart');

/* Quickbar */
const qbMeasure       = document.getElementById('qb-measure');
const qbClearMeasures = document.getElementById('qb-clearMeasures');
const qbSection       = document.getElementById('qb-section');
const qbSectionReset  = document.getElementById('qb-sectionReset');
const qbExplode       = document.getElementById('qb-explode');
const qbView          = document.getElementById('qb-view');
const qbLight         = document.getElementById('qb-light');
const popExplode      = document.getElementById('pop-explode');
const explodeRange    = document.getElementById('explodeRange');
const popLight        = document.getElementById('pop-light');
const lightRange      = document.getElementById('lightRange');

/* Models dock */
const modelsDock  = document.getElementById('modelsDock');
const modelsList  = document.getElementById('modelsList');

/* ===== Viewer ===== */
statusEl.textContent = 'جاهز - اسحبي الملف أو اختاريه';
const viewer = new IfcViewerAPI({ container, backgroundColor: new THREE.Color(0xffffff) });
viewer.grid.setGrid(); viewer.axes.setAxes();
viewer.context.renderer.postProduction.active = true;
const canvas = viewer.context.getDomElement ? viewer.context.getDomElement() : container;
const dims = viewer.dimensions;
const clip = viewer.clipper;

/* WASM */
const ifcReady = (async()=>{
  try{ viewer.IFC.loader.ifcManager.useWebWorkers(false); await viewer.IFC.loader.ifcManager.setWasmPath('/wasm/'); }catch{}
  await viewer.IFC.setWasmPath('/wasm/');
})();

/* ===== State ===== */
let dark=false;
let currentModel=null, lastSpatialTree=null;
let lastPicked={modelID:null,expressID:null,props:null};
let statsChart=null, statsBaseColors=[], idsByType={};
let isolation={active:false,type:null,subset:null};
let measureOn=false, explodeOn=false;
let explodeData={prepared:false,meshes:[],base:[],dir:[]};

// قائمة كل الموديلات المرفوعة
const models=[]; // {id,name,model,visible,row}

/* Lights */
const scene=viewer.context.getScene();
const ambient=new THREE.AmbientLight(0xffffff,1);
const dLight =new THREE.DirectionalLight(0xffffff,.6); dLight.position.set(5,8,10);
scene.add(ambient,dLight);

/* ===== Utilities ===== */
const setStatus=(m)=>statusEl.textContent=m;
const getCss=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||'#000';
const palette=(n,isDark)=>Array.from({length:n},(_,i)=>`hsl(${Math.round(i*360/n)},70%,${isDark?45:55}%)`);
const toHSLA=(hsl,a)=>hsl.startsWith('hsl(')?hsl.replace(/^hsl\((.+)\)$/,`hsla($1,${a})`):hsl;
function fitToObject(obj){ if(!obj)return;
  const cam=viewer.context.getCamera?viewer.context.getCamera():viewer.context.renderer.camera;
  const ctr=viewer.context.ifcCamera?.controls||viewer.context.renderer.controls;
  const box=new THREE.Box3().setFromObject(obj); const size=box.getSize(new THREE.Vector3()); const center=box.getCenter(new THREE.Vector3());
  const max=Math.max(size.x,size.y,size.z); const distH=max/(2*Math.tan(THREE.MathUtils.degToRad(cam.fov*0.5))); const distW=distH/cam.aspect;
  const distance=Math.max(distH,distW)*1.2; const dir=new THREE.Vector3().subVectors(cam.position, ctr?.target||new THREE.Vector3()).normalize();
  cam.near=Math.max(distance/100,0.1); cam.far=distance*100; cam.updateProjectionMatrix(); cam.position.copy(dir.multiplyScalar(distance).add(center));
  if(ctr){ ctr.target.copy(center); ctr.update(); }
}
function forceRender(){ try{ viewer.context.getRenderer().render(); return; }catch{} try{ viewer.context.renderer.postProduction.update(); return; }catch{} }

/* ===== Models dock logic ===== */
function filenameFromUrl(u){
  try{
    const url=new URL(u); const last=url.pathname.split('/').filter(Boolean).pop()||'model.ifc';
    return decodeURIComponent(last);
  }catch{ return u.split('/').pop()||'model.ifc'; }
}
function addModelToDock(model, name){
  modelsDock.style.display='block';
  const row=document.createElement('div'); row.className='mdl-row active'; row.dataset.id=model.modelID;
  const eye=document.createElement('button'); eye.className='mdl-eye'; eye.title='إظهار/إخفاء (Alt=Solo)'; eye.textContent='👁';
  const title=document.createElement('div'); title.className='mdl-name'; title.textContent=name||`IFC #${model.modelID}`;
  const fit=document.createElement('button'); fit.className='mdl-eye'; fit.title='تمركز'; fit.textContent='🎯';
  row.appendChild(eye); row.appendChild(title); row.appendChild(fit);
  modelsList.appendChild(row);

  const entry={id:model.modelID,name,model,visible:true,row}; models.push(entry);

  eye.addEventListener('click', (e)=>{
    const solo=e.altKey;
    if(solo){
      // Solo: أظهر هذا فقط وأخفِ البقية
      models.forEach(m=>{
        const show=(m.id===entry.id);
        m.model.visible=show; m.visible=show;
        m.row.classList.toggle('active', show);
        m.row.querySelector('.mdl-eye').textContent= show?'👁':'🙈';
      });
    }else{
      entry.visible=!entry.visible;
      entry.model.visible=entry.visible;
      row.classList.toggle('active', entry.visible);
      eye.textContent = entry.visible ? '👁' : '🙈';
    }
    forceRender();
  });
  fit.addEventListener('click', ()=> fitToObject(model));
}

/* ===== Selection / Isolation ===== */
function clearSelection(){
  try{ viewer.IFC.selector.unpickIfcItems(); }catch{}; try{ viewer.IFC.selector.unHighlightIfcItems(); }catch{};
  lastPicked={modelID:null,expressID:null,props:null}; propsWrap.innerHTML=''; copyGidBtn.disabled=true; downloadBtn.disabled=true;
  highlightStatsByType(undefined);
}
function clearIsolation(){
  if(!isolation.active) return;
  try{ isolation.subset?.removeFromParent(); }catch{}
  models.forEach(m=> m.model.visible = m.visible); // رجّع الرؤية حسب اللوحة
  isolation={active:false,type:null,subset:null};
}
async function setIsolationByType(type){
  if(!currentModel || !type) return;
  if(isolation.active && isolation.type===type) return;
  clearIsolation();
  const ids = (idsByType[type]||[]);
  if(!ids.length){ setStatus('لا توجد عناصر من هذا النوع'); return; }
  const subset = await viewer.IFC.loader.ifcManager.createSubset({
    modelID: currentModel.modelID, scene, ids, removePrevious: true, customID: 'iso-type'
  });
  // اخفِ جميع الموديلات ثم أظهر السبسِت فقط
  models.forEach(m=> m.model.visible=false);
  isolation={active:true,type,subset};
  fitToObject(subset);
}
// =========[ أدوات مساعدة للتنزيل ]=========
function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// قراءة الملخص الحالي من واجهة المستخدم (#statsList) كصفوف [النوع, العدد]
function readStatsFromDOM() {
  const list = document.getElementById('statsList');
  const rows = [];
  // نتوقع تركيب kv: div.k + div.v بالتتابع داخل grid
  const kids = Array.from(list.children);
  for (let i = 0; i < kids.length; i += 2) {
    const k = kids[i]?.textContent?.trim();
    const v = kids[i + 1]?.textContent?.trim();
    if (k && v) rows.push({ Type: k, Count: Number(v.replace(/[^\d.-]/g, '')) || 0 });
  }
  return rows;
}

// ========[ تصدير الملخص CSV/XLSX/PDF ]========
document.getElementById('exportCSV')?.addEventListener('click', () => {
  const rows = readStatsFromDOM();
  if (!rows.length) return alert('لا يوجد بيانات ملخص للتصدير.');
  const header = ['Type', 'Count'];
  const csv = [header.join(',')]
    .concat(rows.map(r => [r.Type, r.Count].map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')))
    .join('\r\n');
  downloadBlob('IFC-Stats.csv', 'text/csv;charset=utf-8', csv);
});

document.getElementById('exportXLSX')?.addEventListener('click', () => {
  const rows = readStatsFromDOM();
  if (!rows.length) return alert('لا يوجد بيانات ملخص للتصدير.');
  /* global XLSX */
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Summary');
  XLSX.writeFile(wb, 'IFC-Stats.xlsx');
});

document.getElementById('exportPDF')?.addEventListener('click', () => {
  const rows = readStatsFromDOM();
  if (!rows.length) return alert('لا يوجد بيانات ملخص للتصدير.');
  /* global jspdf */
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  doc.setFontSize(13);
  doc.text('ملخص عناصر IFC', 40, 40);
  const body = rows.map(r => [r.Type, String(r.Count)]);
  doc.autoTable({
    head: [['النوع', 'العدد']],
    body,
    startY: 60,
    styles: { font: 'helvetica', fontSize: 10 }
  });
  doc.save('IFC-Stats.pdf');
});

// =======[ رفع Excel ودمجه مع IFC ]=======

// نجمع فهرس عناصر IFC حسب GlobalId/Name مرة واحدة عند أول دمج
let __ifcIndex = null;

async function buildIfcIndex() {
  if (__ifcIndex) return __ifcIndex;
  const index = { byGlobalId: new Map(), byName: new Map() };

  // جلب كل الموديلات المحمّلة
  const models = viewer?.context?.items?.models || [];
  if (!models.length) throw new Error('لا يوجد موديلات IFC محمّلة.');

  // استيراد تعريفات الأنواع (للحصول على أرقام الأنواع)
  let WEBIFC;
  try {
    WEBIFC = await import('https://cdn.jsdelivr.net/npm/web-ifc@0.0.152/web-ifc-api.js');
  } catch (e) {
    console.warn('فشل استيراد web-ifc من CDN، سيتم مسح أنواع شائعة فقط.');
    WEBIFC = { };
  }

  const typeNums = [];
  // لو عندنا WEBIFC حقيقي: التقط كل القيم الرقمية كأنواع
  for (const [k, v] of Object.entries(WEBIFC)) {
    if (k.startsWith('IFC') && typeof v === 'number') typeNums.push(v);
  }
  // نوع احتياطي إن كانت القائمة فاضية (أنواع شائعة)
  if (!typeNums.length) {
    typeNums.push(21, 23, 24, 25, 31, 32, 33, 34); // جدران/أبواب/نوافذ... (تقريبية)
  }

  const seen = new Set();
  for (const m of models) {
    const modelID = m.modelID ?? m.id ?? m;
    for (const t of typeNums) {
      let ids = [];
      try {
        ids = await viewer.IFC.getAllItemsOfType(modelID, t, false);
      } catch (e) { /* تجاهل الأنواع غير الموجودة */ }
      for (const eid of ids) {
        if (seen.has(modelID + ':' + eid)) continue;
        seen.add(modelID + ':' + eid);
        let props;
        try {
          props = await viewer.IFC.getProperties(modelID, eid, false);
        } catch (e) { continue; }
        const gid  = props?.GlobalId?.value || props?.GlobalId || null;
        const name = (props?.Name?.value ?? props?.Name ?? '').toString();
        const rec  = { modelID, expressID: eid, GlobalId: gid, Name: name, IfcType: props?.type || '' };
        if (gid) index.byGlobalId.set(gid, rec);
        if (name) {
          if (!index.byName.has(name)) index.byName.set(name, []);
          index.byName.get(name).push(rec);
        }
      }
    }
  }
  __ifcIndex = index;
  return index;
}

// تحميل ملف Excel إلى JSON
let __excelRows = [];
let __excelHeaders = [];
document.getElementById('excelFile')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  __excelRows = []; __excelHeaders = [];
  document.getElementById('mergeStatus').textContent = '';
  if (!file) {
    document.getElementById('mergeExcel').disabled = true;
    return;
  }
  const buf = await file.arrayBuffer();
  /* global XLSX */
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }); // [{...}]
  __excelRows = rows;
  __excelHeaders = rows.length ? Object.keys(rows[0]) : [];
  document.getElementById('mergeExcel').disabled = !rows.length;
  document.getElementById('mergeStatus').textContent = rows.length ? `تم التحميل (${rows.length} صف)` : 'الملف خالٍ';
});

// تنفيذ الدمج
let __merged = [];
document.getElementById('mergeExcel')?.addEventListener('click', async () => {
  if (!__excelRows.length) return alert('حمّلي ملف Excel أولاً.');
  document.getElementById('mergeStatus').textContent = 'جاري الفهرسة…';
  const idx = await buildIfcIndex();

  // اختيار مفتاح الربط تلقائياً
  const colsLower = new Set(__excelHeaders.map(h => h.toLowerCase()));
  let key = null;
  if (colsLower.has('globalid')) key = 'GlobalId';
  else if (colsLower.has('name') || colsLower.has('الاسم')) key = __excelHeaders.find(h => h.toLowerCase() === 'name' || h === 'الاسم');
  else key = __excelHeaders[0]; // أسوأ الأحوال

  // الدمج: لو GlobalId -> سجل واحد؛ لو Name -> احتمال تعدد مطابقات
  const merged = [];
  for (const row of __excelRows) {
    const val = row[key] ?? '';
    let matches = [];
    if (!val) {
      merged.push({ ...row, _match: 'NoKey', _GlobalId: '', _Name: '', _IfcType: '' });
      continue;
    }
    if (key.toLowerCase() === 'globalid') {
      const rec = idx.byGlobalId.get(String(val)) || null;
      if (rec) matches.push(rec);
    } else {
      matches = idx.byName.get(String(val)) || [];
    }

    if (!matches.length) {
      merged.push({ ...row, _match: 'NotFound', _GlobalId: '', _Name: '', _IfcType: '' });
    } else {
      for (const rec of matches) {
        merged.push({
          ...row,
          _match: 'OK',
          _GlobalId: rec.GlobalId || '',
          _Name: rec.Name || '',
          _IfcType: rec.IfcType || '',
          _modelID: rec.modelID,
          _expressID: rec.expressID
        });
      }
    }
  }

  __merged = merged;
  renderMergedTable(merged);
  document.getElementById('mergeStatus').textContent = `تم الدمج: ${merged.length} صف`;
  document.getElementById('mergedWrap').style.display = 'block';
});

// عرض جدول الدمج
function renderMergedTable(rows) {
  const table = document.getElementById('mergedTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  thead.innerHTML = '';

  if (!rows.length) {
    document.getElementById('mergedCount').textContent = '0';
    return;
  }

  // أعمدة: أعمدة الاكسل + أعمدة IFC المضافة
  const excelCols = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
  const extraCols = ['_match','_GlobalId','_Name','_IfcType'];
  const cols = [...excelCols, ...extraCols];

  // رأس الجدول
  const trh = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    th.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--panelLine);text-align:start';
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  // جسم الجدول (نعاين أول 500 صف لتسريع العرض)
  const MAX = 500;
  const slice = rows.slice(0, MAX);
  for (const r of slice) {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const td = document.createElement('td');
      td.textContent = r[c] ?? '';
      td.style.cssText = 'padding:5px 8px;border-bottom:1px solid var(--panelLine)';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  document.getElementById('mergedCount').textContent = `${slice.length} / ${rows.length}`;
}

// تنزيلات الدمج
document.getElementById('downloadMergedCSV')?.addEventListener('click', () => {
  if (!__merged.length) return;
  const cols = Object.keys(__merged[0]);
  const csv = [cols.join(',')].concat(
    __merged.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g,'""')}"`).join(','))
  ).join('\r\n');
  downloadBlob('IFC-Merged.csv','text/csv;charset=utf-8',csv);
});

document.getElementById('downloadMergedXLSX')?.addEventListener('click', () => {
  if (!__merged.length) return;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(__merged);
  XLSX.utils.book_append_sheet(wb, ws, 'Merged');
  XLSX.writeFile(wb, 'IFC-Merged.xlsx');
});

document.getElementById('downloadMergedPDF')?.addEventListener('click', () => {
  if (!__merged.length) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'l', unit: 'pt', format: 'a4' });
  doc.setFontSize(12);
  doc.text('IFC + Excel (Merged)', 40, 40);
  const cols = Object.keys(__merged[0]);
  const body = __merged.slice(0, 1000).map(r => cols.map(c => String(r[c] ?? '')));
  doc.autoTable({ head: [cols], body, startY: 60, styles: { fontSize: 7 } });
  doc.save('IFC-Merged.pdf');
});

/* ===== Measure / Clip / Explode / View / Light ===== */
function setMeasure(on){
  measureOn=!!on;
  if(dims){ dims.active=measureOn; dims.previewActive=measureOn; }
  qbMeasure.classList.toggle('active', measureOn);
  setStatus(measureOn?'القياس مفعّل: حرّكي الفأرة، دبل-كلك للتثبيت':'تم إيقاف القياس');
}
function prepareExplode(){
  explodeData={prepared:true,meshes:[],base:[],dir:[]};
  const root=isolation.active?isolation.subset:currentModel; if(!root) return;
  const center=new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  root.traverse(o=>{
    if(o.isMesh){
      explodeData.meshes.push(o);
      explodeData.base.push(o.position.clone());
      const c=new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      explodeData.dir.push(c.sub(center).normalize());
    }
  });
}
function applyExplodeFactor(f){
  const root=isolation.active?isolation.subset:currentModel; if(!root) return;
  if(!explodeData.prepared) prepareExplode();
  const diag=new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length();
  const scale=diag*0.35*f;
  explodeData.meshes.forEach((m,i)=>{
    m.position.copy(explodeData.base[i].clone().add(explodeData.dir[i].clone().multiplyScalar(scale)));
  });
  forceRender();
}
const viewModes=['shaded','xray','wire','mono']; let viewIdx=0;
function applyViewMode(mode,target=scene){
  target.traverse(o=>{
    if(!o.isMesh) return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const m of mats){
      if(!m) continue; m.userData=m.userData||{};
      if(!m.userData._baseColor && m.color) m.userData._baseColor=m.color.clone();
      if(mode==='shaded'){ m.wireframe=false; m.transparent=false; m.opacity=1; if(m.color&&m.userData._baseColor) m.color.copy(m.userData._baseColor); }
      if(mode==='xray'){   m.wireframe=false; m.transparent=true;  m.opacity=0.25; }
      if(mode==='wire'){   m.wireframe=true;  m.transparent=false; m.opacity=1; }
      if(mode==='mono'){   m.wireframe=false; m.transparent=false; m.opacity=1; if(m.color) m.color.set('#c9c9c9'); }
      m.needsUpdate=true;
    }
  });
  setStatus(`نمط العرض: ${mode}`); forceRender();
}
function cycleViewMode(){ viewIdx=(viewIdx+1)%viewModes.length; applyViewMode(viewModes[viewIdx]); }
function setLightIntensity(v){ ambient.intensity=v; dLight.intensity=Math.max(0,v-0.3); forceRender(); }

/* ===== Chart / Stats ===== */
function renderStatsChart(labels,values){
  const colors=palette(labels.length,dark); statsBaseColors=colors.slice();
  const ctx=statsChartCanvas.getContext('2d');
  if(statsChart){ statsChart.data.labels=labels; statsChart.data.datasets[0].data=values; statsChart.data.datasets[0].backgroundColor=colors; statsChart.update(); return; }
  statsChart=new Chart(ctx,{type:'pie',data:{labels,datasets:[{data:values,backgroundColor:colors,hoverOffset:10}]},
    options:{plugins:{legend:{position:'right',labels:{color:getCss('--fg')}}}}});
  statsChartCanvas.addEventListener('click', async (e)=>{
    const els=statsChart.getElementsAtEventForMode(e,'nearest',{intersect:true},true);
    if(!els.length) return; const idx=els[0].index; const type=statsChart.data.labels[idx];
    await setIsolationByType(type); highlightStatsByType(type);
  });
}
function highlightStatsByType(type){
  if(!statsChart) return;
  const idx=statsChart.data.labels.indexOf(type);
  const ds=statsChart.data.datasets[0];
  ds.backgroundColor=statsBaseColors.map((c,i)=>i===idx?c:toHSLA(c,0.25));
  statsChart.setActiveElements(idx>=0?[{datasetIndex:0,index:idx}]:[]);
  statsChart.update();
}
function putStat(k,v){ const a=document.createElement('div');a.className='k';a.textContent=k; const b=document.createElement('div');b.className='v';b.textContent=(v??0)+''; statsList.appendChild(a);statsList.appendChild(b); }
function buildStatsFromTree(tree){
  statsList.innerHTML=''; idsByType={}; const counts={};
  (function walk(n){ if(!n) return; counts[n.type]=(counts[n.type]||0)+1; if(typeof n.expressID==='number'){ (idsByType[n.type] ||= []).push(n.expressID); } (n.children||[]).forEach(walk); })(tree);
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,12); top.forEach(([t,c])=>putStat(t,c));
  renderStatsChart(top.map(([t])=>t), top.map(([,c])=>c));
}

/* ===== Props / Tree ===== */
function switchTab(w){ const set=(el,on)=>el.classList[on?'add':'remove']('active');
  set(tabProps,w==='props'); set(tabTree,w==='tree'); set(tabStats,w==='stats');
  panelProps.style.display=w==='props'?'block':'none';
  panelTree .style.display=w==='tree'?'block':'none';
  panelStats.style.display=w==='stats'?'block':'none';
}
function makeNode(label,id){
  const li=document.createElement('li'); li.textContent=`${label} #${id}`;
  li.addEventListener('click', async (e)=>{ e.stopPropagation(); if(!currentModel)return; await viewer.IFC.selector.pickIfcItemsByID(currentModel.modelID,[id],true); await showProps(currentModel.modelID,id); switchTab('props'); });
  return li;
}
function buildTree(node,parent){ if(!node) return; parent.appendChild(makeNode(node.type,node.expressID)); if(node.children?.length){ const ul=document.createElement('ul'); parent.lastChild.appendChild(ul); node.children.forEach(ch=>buildTree(ch,ul)); } }
function filterTree(q){ q=(q||'').trim().toLowerCase(); const items=treeWrap.querySelectorAll('li'); let v=0; items.forEach(li=>{ const t=(li.textContent||'').toLowerCase(); const hit=!q||t.includes(q); li.style.display=hit?'':'none'; if(hit)v++; }); treeCount.textContent=v+''; }
const fmt=(n,u)=> (n==null?'—':Number(n).toLocaleString(undefined,{maximumFractionDigits:3}))+(u?` ${u}`:'');
async function getDimensionsFromIFC(modelID,expressID){
  const out={length:null,area:null,volume:null};
  try{
    const sets=await viewer.IFC.getPropertySets(modelID,expressID,true)||[];
    for(const s of sets){
      const arr=s.Quantities||s.HasProperties||[];
      for(let q of arr){
        if(q && typeof q==='object' && 'value' in q) q=await viewer.IFC.getProperties(modelID,q.value,true);
        const t=q?.type||'';
        if(t.includes('IfcQuantityLength'))  out.length=q?.LengthValue?.value ?? q?.NominalValue?.value ?? out.length;
        if(t.includes('IfcQuantityArea'))    out.area  =q?.AreaValue?.value   ?? q?.NominalValue?.value ?? out.area;
        if(t.includes('IfcQuantityVolume'))  out.volume=q?.VolumeValue?.value ?? q?.NominalValue?.value ?? out.volume;
      }
    }
  }catch{}
  return out;
}
async function showProps(modelID,expressID){
  propsWrap.innerHTML='';
  try{
    const p=await viewer.IFC.getProperties(modelID,expressID,true,false);
    lastPicked={modelID,expressID,props:p};
    renderKV('ExpressID',expressID); renderKV('GlobalId',p?.GlobalId?.value); renderKV('Name',p?.Name?.value); renderKV('Type',p?.type);
    const d=await getDimensionsFromIFC(modelID,expressID);
    if(d.length!=null||d.area!=null||d.volume!=null){ renderKV('الطول',fmt(d.length,'m')); renderKV('المساحة',fmt(d.area,'m²')); renderKV('الحجم',fmt(d.volume,'m³')); }
    copyGidBtn.disabled = !(p?.GlobalId?.value); downloadBtn.disabled=false;
    if(p?.type){ await setIsolationByType(p.type); highlightStatsByType(p.type); switchTab('stats'); }
  }catch{ renderKV('Error','تعذر قراءة الخصائص'); }
}

/* ===== Load ===== */
async function afterLoad(model, displayName){
  currentModel=model; setStatus('تم التحميل ✅'); fitBtn.disabled=false; clearBtn.disabled=false;

  // أضف للوحة النماذج
  addModelToDock(model, displayName);

  // ابنِ الشجرة/الملخّص لهذا المودل (آخر مودل هو "النشط" للشجرة/الملخص)
  treeWrap.innerHTML=''; const tree=await viewer.IFC.getSpatialStructure(model.modelID,true); lastSpatialTree=tree;
  const ul=document.createElement('ul'); treeWrap.appendChild(ul); buildTree(tree,ul); treeCount.textContent=(ul.querySelectorAll('li').length||0)+'';
  buildStatsFromTree(tree);
  fitToObject(model);
}
async function loadIfcFromUrl(url){
  await ifcReady; setStatus('جاري التحميل…');
  try{ const m=await viewer.IFC.loadIfcUrl(url); await afterLoad(m, filenameFromUrl(url)); }catch(e){ console.error(e); setStatus('فشل التحميل ❌'); }
}
async function loadIfcFromFile(file){
  await ifcReady; setStatus('جاري التحميل…');
  try{
    let m=null; try{ m=await viewer.IFC.loadIfc(file,true); }
    catch{ const u=URL.createObjectURL(file); try{ m=await viewer.IFC.loadIfcUrl(u);} finally{ URL.revokeObjectURL(u);} }
    if(!m) throw new Error('Model null');
    await afterLoad(m, file.name||`IFC #${m.modelID}`);
  }catch(e){ console.error(e); setStatus('فشل التحميل ❌'); }
}

/* ===== Events ===== */
fileInput.addEventListener('change', async e=>{ const f=e.target.files?.[0]; if(!f) return; await loadIfcFromFile(f); e.target.value=''; });
container.addEventListener('dragover', e=>{ e.preventDefault(); container.classList.add('drop'); });
container.addEventListener('dragleave', ()=> container.classList.remove('drop'));
container.addEventListener('drop', async e=>{ e.preventDefault(); container.classList.remove('drop'); const f=e.dataTransfer.files?.[0]; if(!f) return; await loadIfcFromFile(f); });

ifcReady.then(()=>{
  canvas.addEventListener('mousemove', ()=>{ if(measureOn && dims?.update) dims.update(); else viewer.IFC.selector.prePickIfcItem(); });
  canvas.addEventListener('click', async ()=>{ const r=await viewer.IFC.selector.pickIfcItem(); if(r) await showProps(r.modelID,r.id); else { clearSelection(); clearIsolation(); highlightStatsByType(undefined);} });
  canvas.addEventListener('dblclick', ()=>{ if(measureOn && dims?.create) dims.create(); });
});

/* Top buttons */
fitBtn.addEventListener('click', ()=>{
  const anyVisible = models.find(m=>m.visible);
  fitToObject(anyVisible ? anyVisible.model : currentModel);
});
clearBtn.addEventListener('click', ()=>{
  // امسح كل الموديلات
  models.forEach(m=>{ try{ viewer.IFC.removeModel(m.id); }catch{} });
  models.length=0; modelsList.innerHTML=''; modelsDock.style.display='none';
  currentModel=null; lastSpatialTree=null; clearIsolation(); clearSelection();
  explodeOn=false; explodeRange.value='0'; explodeData.prepared=false;
  treeWrap.innerHTML=''; treeCount.textContent=''; fitBtn.disabled=true; clearBtn.disabled=true;
  if(statsChart){ statsChart.destroy(); statsChart=null; } idsByType={}; statsBaseColors=[];
  setStatus('تم مسح المشهد');
});
gridBtn.addEventListener('click', ()=> viewer.grid.visible=!viewer.grid.visible);
axesBtn.addEventListener('click', ()=> viewer.axes.visible=!viewer.axes.visible);
themeBtn.addEventListener('click', ()=>{
  dark=!dark; document.documentElement.setAttribute('data-theme',dark?'dark':'light');
  scene.background=new THREE.Color(dark?0x0f1115:0xffffff);
  themeBtn.textContent=dark?'ثيم فاتح':'ثيم داكن';
  if(statsChart){ const cs=palette(statsChart.data.labels.length,dark); statsBaseColors=cs.slice(); statsChart.data.datasets[0].backgroundColor=cs; statsChart.update(); }
});

/* Quickbar */
qbMeasure.addEventListener('click', ()=> setMeasure(!measureOn));
qbClearMeasures.addEventListener('click', ()=> dims?.deleteAll && dims.deleteAll());
qbSection.addEventListener('click', ()=>{ clip.active=!clip.active; qbSection.classList.toggle('active',clip.active); setStatus(clip.active?'القص مفعّل — Shift+Click لإضافة مستوى':'تم إيقاف القص'); });
qbSectionReset.addEventListener('click', ()=> clip.deleteAllPlanes && clip.deleteAllPlanes());
qbExplode.addEventListener('click', ()=>{ popExplode.classList.toggle('show'); popLight.classList.remove('show'); explodeOn=!explodeOn;
  if(explodeOn){ prepareExplode(); applyExplodeFactor(parseFloat(explodeRange.value||'0')); setStatus('التفجير مفعل'); }
  else{ if(explodeData.prepared){ explodeData.meshes.forEach((m,i)=> m.position.copy(explodeData.base[i])); } explodeRange.value='0'; setStatus('تم إيقاف التفجير'); forceRender(); }});
explodeRange.addEventListener('input', e=>{ if(explodeOn) applyExplodeFactor(parseFloat(e.target.value)); });
qbView.addEventListener('click', ()=> cycleViewMode());
qbLight.addEventListener('click', ()=>{ popLight.classList.toggle('show'); popExplode.classList.remove('show'); });
lightRange.addEventListener('input', e=> setLightIntensity(parseFloat(e.target.value)));

/* Tabs & search */
tabProps.addEventListener('click', ()=> switchTab('props'));
tabTree .addEventListener('click', ()=> switchTab('tree'));
tabStats.addEventListener('click', ()=> switchTab('stats'));

/* URL open */
openUrlBtn.addEventListener('click', ()=>{ const u=(openUrl.value||'').trim(); if(u) loadIfcFromUrl(u); });

/* ?file= */
(function(){ const u=new URL(location.href).searchParams.get('file'); if(u) loadIfcFromUrl(u); })();

/* Keys */
window.addEventListener('keydown', (e)=>{
  if(e.key==='Escape'){
    clearSelection(); clearIsolation();
    setMeasure(false); clip.active=false; clip.deleteAllPlanes && clip.deleteAllPlanes();
    popExplode.classList.remove('show'); popLight.classList.remove('show');
    if(explodeOn){ qbExplode.click(); }
  }
});
