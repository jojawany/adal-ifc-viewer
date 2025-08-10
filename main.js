// main.js
import * as THREE from 'three';
import { IfcViewerAPI } from 'web-ifc-viewer';

const container = document.getElementById('viewer');
const statusEl  = document.getElementById('status');
const fileInput = document.getElementById('file');
const clearBtn  = document.getElementById('clear');
const fitBtn    = document.getElementById('fit');
const gridBtn   = document.getElementById('grid');
const axesBtn   = document.getElementById('axes');
const themeBtn  = document.getElementById('theme');
const clipBtn   = document.getElementById('clip');
const clipClear = document.getElementById('clipClear');

const propsWrap = document.getElementById('props');
const treeWrap  = document.getElementById('tree');
const treeCount = document.getElementById('treeCount');
const tabProps  = document.getElementById('tab-props');
const tabTree   = document.getElementById('tab-tree');
const panelProps= document.getElementById('panel-props');
const panelTree = document.getElementById('panel-tree');

statusEl.textContent = 'جاهز - اسحبي الملف أو اختاريه';

const viewer = new IfcViewerAPI({
  container,
  backgroundColor: new THREE.Color(0xffffff)
});

viewer.grid.setGrid();
viewer.axes.setAxes();
viewer.context.renderer.postProduction.active = true;

// --- تهيئة WASM بدون top-level await ---
const BASE = (import.meta && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : '/';
const ifcReady = (async () => {
  try {
    viewer.IFC.loader.ifcManager.useWebWorkers(false);
    await viewer.IFC.loader.ifcManager.setWasmPath(`${BASE}wasm/`);
  } catch (_) {}
  await viewer.IFC.setWasmPath(`${BASE}wasm/`);
})();

let currentModel = null;
let dark = false;

// ---------- Helpers ----------
function setStatus(msg){ statusEl.textContent = msg; }

function fitToObject(obj) {
  if (!obj) return;
  const cam = viewer.context.getCamera ? viewer.context.getCamera() : viewer.context.renderer.camera;
  const ctr = viewer.context.ifcCamera?.controls || viewer.context.renderer.controls;
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const distH = maxSize / (2*Math.tan(THREE.MathUtils.degToRad(cam.fov*0.5)));
  const distW = distH / cam.aspect;
  const distance = Math.max(distH, distW) * 1.2;
  const dir = new THREE.Vector3().subVectors(cam.position, ctr?.target || new THREE.Vector3()).normalize();
  cam.near = Math.max(distance/100, 0.1); cam.far = distance*100; cam.updateProjectionMatrix();
  cam.position.copy(dir.multiplyScalar(distance).add(center));
  if (ctr){ ctr.target.copy(center); ctr.update(); }
}

function renderKeyValue(k, v){
  const kEl = document.createElement('div'); kEl.className='k'; kEl.textContent = k;
  const vEl = document.createElement('div'); vEl.className='v'; vEl.textContent = (v ?? '') + '';
  propsWrap.appendChild(kEl); propsWrap.appendChild(vEl);
}

function clearProps(){ propsWrap.innerHTML = ''; }
const fmt = (n, unit) => (n==null ? '—' : Number(n).toLocaleString(undefined,{maximumFractionDigits:3})) + (unit?` ${unit}`:'');

// ---- Quantities (Length/Area/Volume) ----
async function getDimensionsFromIFC(modelID, expressID){
  const out = { length: null, area: null, volume: null };
  try{
    const sets = await viewer.IFC.getPropertySets(modelID, expressID, true) || [];
    for(const s of sets){
      const rawList = s.Quantities || s.HasProperties || [];
      for(let q of rawList){
        if(q && typeof q === 'object' && 'value' in q){
          q = await viewer.IFC.getProperties(modelID, q.value, true);
        }
        const name = q?.Name?.value || q?.Name || '';
        const t = q?.type || '';
        if(t.includes('IfcQuantityLength')){
          const v = q?.LengthValue?.value ?? q?.LengthValue ?? q?.NominalValue?.value;
          if(/length/i.test(name) || out.length==null) out.length = v;
        }
        if(t.includes('IfcQuantityArea')){
          const v = q?.AreaValue?.value ?? q?.AreaValue ?? q?.NominalValue?.value;
          if(/area/i.test(name) || out.area==null) out.area = v;
        }
        if(t.includes('IfcQuantityVolume')){
          const v = q?.VolumeValue?.value ?? q?.VolumeValue ?? q?.NominalValue?.value;
          if(/volume/i.test(name) || out.volume==null) out.volume = v;
        }
      }
    }
  }catch(err){ console.warn('Quantities read error', err); }
  return out;
}

async function showProps(modelID, expressID){
  clearProps();
  try{
    const p = await viewer.IFC.getProperties(modelID, expressID, true, false);
    renderKeyValue('ExpressID', expressID);
    renderKeyValue('GlobalId', p?.GlobalId?.value);
    renderKeyValue('Name', p?.Name?.value);
    renderKeyValue('Type', p?.type);
    if(p?.ObjectType?.value) renderKeyValue('ObjectType', p.ObjectType.value);

    const dims = await getDimensionsFromIFC(modelID, expressID);
    if(dims.length!=null || dims.area!=null || dims.volume!=null){
      renderKeyValue('الطول',   fmt(dims.length, 'm'));
      renderKeyValue('المساحة', fmt(dims.area,   'm²'));
      renderKeyValue('الحجم',   fmt(dims.volume, 'm³'));
    }else{
      renderKeyValue('الأبعاد', '— (فعّلي Export base quantities عند التصدير)');
    }
  }catch(err){
    renderKeyValue('Error','تعذر قراءة الخصائص');
    console.warn(err);
  }
}

function makeNode(label, id){
  const li = document.createElement('li');
  const sp = document.createElement('span');
  sp.textContent = `${label} #${id}`;
  li.appendChild(sp);
  li.addEventListener('click', async (e)=>{
    e.stopPropagation();
    if(!currentModel) return;
    try{
      await viewer.IFC.selector.pickIfcItemsByID(currentModel.modelID, [id], true);
      await showProps(currentModel.modelID, id);
    }catch{}
  });
  return li;
}

function buildTree(node, parent){
  if(!node) return;
  const li = makeNode(node.type, node.expressID);
  parent.appendChild(li);
  if(node.children && node.children.length){
    const ul = document.createElement('ul');
    li.appendChild(ul);
    node.children.forEach(ch => buildTree(ch, ul));
  }
}

function switchTab(which){
  if(which==='props'){
    tabProps.classList.add('active'); tabTree.classList.remove('active');
    panelProps.style.display='block'; panelTree.style.display='none';
  }else{
    tabTree.classList.add('active'); tabProps.classList.remove('active');
    panelTree.style.display='block'; panelProps.style.display='none';
  }
}

// ---------- Loaders ----------
async function loadIfcFromUrl(url){
  await ifcReady; // نضمن تهيئة WASM قبل التحميل
  setStatus('جاري التحميل...');
  try{
    const model = await viewer.IFC.loadIfcUrl(url);
    currentModel = model;
    setStatus('تم التحميل ✅');
    clearBtn.disabled = false; fitBtn.disabled = false;

    treeWrap.innerHTML = '';
    const tree = await viewer.IFC.getSpatialStructure(model.modelID, true);
    buildTree(tree, treeWrap);
    treeCount.textContent = (tree?.children?.length ?? 0);

    fitToObject(model);
  }catch(err){
    console.error('Load error:', err);
    setStatus('فشل التحميل ❌ تحققي من Console');
  }
}

// ---------- Events ----------
fileInput.addEventListener('change', async (e)=>{
  const file = e.target.files?.[0]; if(!file) return;
  const url = URL.createObjectURL(file);
  await loadIfcFromUrl(url);
  URL.revokeObjectURL(url);
});

container.addEventListener('dragover', (e)=>{ e.preventDefault(); container.classList.add('drop'); });
container.addEventListener('dragleave', ()=> container.classList.remove('drop'));
container.addEventListener('drop', async (e)=>{
  e.preventDefault(); container.classList.remove('drop');
  const f = e.dataTransfer.files?.[0]; if(!f) return;
  const url = URL.createObjectURL(f);
  await loadIfcFromUrl(url);
  URL.revokeObjectURL(url);
});

// نضيف أحداث التحديد بعد تهيئة WASM
ifcReady.then(()=>{
  window.addEventListener('mousemove', ()=> viewer.IFC.selector.prePickIfcItem());
  window.addEventListener('click', async ()=>{
    const result = await viewer.IFC.selector.pickIfcItem();
    if(result){ await showProps(result.modelID, result.id); }
  });
});

fitBtn.addEventListener('click', ()=> fitToObject(currentModel));

clearBtn.addEventListener('click', ()=>{
  if(!currentModel) return;
  try{ viewer.IFC.removeModel(currentModel.modelID); }catch{}
  currentModel = null;
  treeWrap.innerHTML=''; treeCount.textContent='';
  clearProps();
  clearBtn.disabled = true; fitBtn.disabled = true;
  setStatus('تم مسح المشهد');
});

// Toggles
gridBtn.addEventListener('click', ()=>{ viewer.grid.visible = !viewer.grid.visible; });
axesBtn.addEventListener('click', ()=>{ viewer.axes.visible = !viewer.axes.visible; });
themeBtn.addEventListener('click', ()=>{
  dark = !dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const bg = new THREE.Color(dark ? 0x0f1115 : 0xffffff);
  viewer.context.getScene().background = bg;
  themeBtn.textContent = dark ? 'ثيم فاتح' : 'ثيم داكن';
});

// Clipping
clipBtn.addEventListener('click', ()=>{
  viewer.clipper.active = !viewer.clipper.active;
  clipBtn.textContent = viewer.clipper.active ? 'إيقاف القص' : 'تفعيل القص';
});
clipClear.addEventListener('click', ()=> viewer.clipper.deleteAllPlanes());

// Tabs
tabProps.addEventListener('click', ()=> switchTab('props'));
tabTree .addEventListener('click', ()=> switchTab('tree'));
