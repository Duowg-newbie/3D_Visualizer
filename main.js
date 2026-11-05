import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const CDN = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/';
const SAMPLES = {
  helmet: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb',
  butterfly: 'https://sparkjs.dev/assets/splats/butterfly.spz',
};
const SPLAT_EXT = ['splat', 'ksplat', 'spz', 'sog'];
const MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'pcd', 'xyz', 'pts', 'txt', 'csv', ...SPLAT_EXT];
const TEX_SLOTS = {
  map: 'Màu (albedo)', normalMap: 'Normal', roughnessMap: 'Roughness', metalnessMap: 'Metalness',
  aoMap: 'AO', emissiveMap: 'Emissive', alphaMap: 'Alpha', bumpMap: 'Bump', displacementMap: 'Displacement',
  specularMap: 'Specular', lightMap: 'Lightmap', clearcoatMap: 'Clearcoat', sheenColorMap: 'Sheen',
  transmissionMap: 'Transmission', specularColorMap: 'Specular color', specularIntensityMap: 'Specular int.',
};
const UP_PRESETS = {
  '+Y': [0, 0, 0], '-Y': [180, 0, 0], '+Z': [-90, 0, 0], '-Z': [90, 0, 0], '+X': [0, 0, 90], '-X': [0, 0, -90],
};
const AXES = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');

const state = {
  mode: 'texture', wireframe: false, doubleSide: false, anim: true,
  pointScale: 1, pointBase: 0.01, splatOpacity: 1,
  roll: 0, showGizmo: true,
};

/* ---------------- Renderer / scene ---------------- */

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.autoClear = false;
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1b1d22');

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
camera.position.set(2, 1.5, 3);
scene.add(camera);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envMap;

const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.6);
scene.add(hemi);
const headLight = new THREE.DirectionalLight(0xffffff, 1.6);
headLight.position.set(0.5, 1, 0.8);
camera.add(headLight);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

let controls = makeControls();
const viewHelper = new ViewHelper(camera, renderer.domElement);
viewHelper.center = controls.target;

// pivot (re-centres the model) → orient (user orientation fix) → content
const pivot = new THREE.Group();
const orient = new THREE.Group();
pivot.add(orient);
scene.add(pivot);

let content = null;
let mixer = null;
let grid = null;
let blobURLs = [];
const axesHelper = new THREE.AxesHelper(1);
axesHelper.visible = false;
scene.add(axesHelper);
const bboxHelper = new THREE.Box3Helper(new THREE.Box3(), 0xffc94d);
bboxHelper.visible = false;
scene.add(bboxHelper);

const dracoLoader = new DRACOLoader().setDecoderPath(CDN + 'draco/gltf/');
const ktx2Loader = new KTX2Loader().setTranscoderPath(CDN + 'basis/').detectSupport(renderer);

function makeControls() {
  const c = new OrbitControls(camera, renderer.domElement);
  c.enableDamping = true;
  c.dampingFactor = 0.08;
  c.screenSpacePanning = true;
  return c;
}

/* ---------------- Render loop ---------------- */

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (mixer && state.anim) mixer.update(dt);
  if (viewHelper.animating) {
    viewHelper.update(dt);
  } else {
    controls.update(dt);
    if (state.roll) camera.rotateZ(state.roll);
  }
  renderer.clear();
  renderer.render(scene, camera);
  if (state.showGizmo) viewHelper.render(renderer);
});

new ResizeObserver(() => {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(viewport);

$('gizmoHit').addEventListener('pointerup', (e) => viewHelper.handleClick(e));

/* ---------------- Utilities ---------------- */

function toast(msg, isError = false, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function setLoading(on, text = 'Đang tải…') {
  if (on) $('empty').classList.add('hidden');
  $('loading').classList.toggle('hidden', !on);
  $('loadingText').textContent = text;
}

function baseName(url) {
  let s = url.split('?')[0].split('#')[0];
  try { s = decodeURIComponent(s); } catch { /* keep raw */ }
  return s.split(/[\\/]/).pop().toLowerCase();
}

const extOf = (name) => baseName(name).split('.').pop();
const fmt = (n) => n.toLocaleString('vi-VN');
const progressText = (e) => (e && e.total ? `Đang tải… ${Math.round((e.loaded / e.total) * 100)}%` : 'Đang tải…');

function makeManager(fileMap) {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  if (fileMap) {
    // Resolve relative resources (textures, .bin, .mtl) against the dropped files by name.
    manager.setURLModifier((url) => (url.startsWith('data:') ? url : fileMap.get(baseName(url)) ?? url));
  }
  return manager;
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${url}`);
  return res.arrayBuffer();
}

function isSplat(o) { return o instanceof SplatMesh; }

/* ---------------- Bounds ---------------- */

// Robust splat bounds: percentile box over the centres, so stray floaters do not blow up the frame.
function splatLocalBox(mesh) {
  if (mesh.userData.localBox) return mesh.userData.localBox;
  let box;
  try {
    let count = 0;
    mesh.forEachSplat(() => { count++; });
    const step = Math.max(1, Math.floor(count / 200000));
    const xs = [], ys = [], zs = [];
    mesh.forEachSplat((i, c) => {
      if (i % step === 0) { xs.push(c.x); ys.push(c.y); zs.push(c.z); }
    });
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    [xs, ys, zs].forEach((a) => a.sort((m, n) => m - n));
    box = new THREE.Box3(
      new THREE.Vector3(q(xs, 0.01), q(ys, 0.01), q(zs, 0.01)),
      new THREE.Vector3(q(xs, 0.99), q(ys, 0.99), q(zs, 0.99)),
    );
    mesh.userData.splatCount = count;
  } catch {
    box = mesh.getBoundingBox(true);
  }
  mesh.userData.localBox = box;
  return box;
}

function computeBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  (function walk(o) {
    if (!o.visible) return;
    if (isSplat(o)) {
      const b = splatLocalBox(o);
      if (!b.isEmpty()) box.union(tmp.copy(b).applyMatrix4(o.matrixWorld));
      return;
    }
    if ((o.isMesh || o.isPoints || o.isLine) && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    }
    o.children.forEach(walk);
  })(root);
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  return box;
}

/* ---------------- Loading ---------------- */

async function loadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const fileMap = new Map();
  const urls = [];
  for (const f of files) {
    const u = URL.createObjectURL(f);
    urls.push(u);
    fileMap.set(f.name.toLowerCase(), u);
  }
  // Pick the main model file by format priority.
  const main = files
    .filter((f) => MODEL_EXT.includes(extOf(f.name)))
    .sort((a, b) => MODEL_EXT.indexOf(extOf(a.name)) - MODEL_EXT.indexOf(extOf(b.name)))[0];
  if (!main) {
    urls.forEach(URL.revokeObjectURL);
    toast('Không tìm thấy file mô hình được hỗ trợ.', true);
    return;
  }
  await loadModel({ url: fileMap.get(main.name.toLowerCase()), name: main.name, fileMap, ownedURLs: urls });
}

async function loadModel({ url, name, fileMap = null, ownedURLs = [] }) {
  const ext = extOf(name);
  setLoading(true);
  try {
    const manager = makeManager(fileMap);
    const onProgress = (e) => setLoading(true, progressText(e));
    const { object, format, animations = [], defaultUp = '+Y' } =
      await loadByExt(ext, url, name, manager, fileMap, onProgress);
    setContent(object, { name, format, animations, defaultUp });
    disposeURLs();
    blobURLs = ownedURLs;
  } catch (err) {
    console.error(err);
    ownedURLs.forEach(URL.revokeObjectURL);
    toast(`Lỗi tải "${name}": ${err.message || err}`, true, 6000);
  } finally {
    setLoading(false);
    if (!content) $('empty').classList.remove('hidden');
  }
}

async function loadByExt(ext, url, name, manager, fileMap, onProgress) {
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const loader = new GLTFLoader(manager)
        .setDRACOLoader(dracoLoader).setKTX2Loader(ktx2Loader).setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(url, onProgress);
      return { object: gltf.scene, format: 'glTF', animations: gltf.animations };
    }
    case 'obj': {
      const text = await (await fetch(url)).text();
      const objLoader = new OBJLoader(manager);
      const mtlName = text.match(/^\s*mtllib\s+(.+?)\s*$/m)?.[1];
      let mtlURL = null;
      if (mtlName) {
        mtlURL = fileMap ? fileMap.get(baseName(mtlName)) : new URL(mtlName, url).href;
      }
      if (!mtlURL && fileMap) mtlURL = [...fileMap].find(([k]) => k.endsWith('.mtl'))?.[1];
      if (mtlURL) {
        try {
          const materials = await new MTLLoader(manager).loadAsync(mtlURL);
          materials.preload();
          objLoader.setMaterials(materials);
        } catch (e) {
          console.warn('MTL load failed', e);
          toast('Không tải được file .mtl — hiển thị không có vật liệu.', true);
        }
      }
      return { object: objLoader.parse(text), format: 'OBJ' + (mtlURL ? ' + MTL' : '') };
    }
    case 'fbx': {
      const obj = await new FBXLoader(manager).loadAsync(url, onProgress);
      return { object: obj, format: 'FBX', animations: obj.animations };
    }
    case 'stl': {
      const geo = new STLLoader(manager).parse(await fetchBuffer(url));
      const mat = new THREE.MeshStandardMaterial({
        color: geo.hasColors ? 0xffffff : 0xc8c8c8, vertexColors: !!geo.hasColors, roughness: 0.6,
      });
      return { object: new THREE.Mesh(geo, mat), format: 'STL', defaultUp: '+Z' };
    }
    case 'ply':
      return loadPLY(url, name, manager, fileMap);
    case 'pcd': {
      const pts = await new PCDLoader(manager).loadAsync(url, onProgress);
      return { object: pts, format: 'PCD (point cloud)', defaultUp: '+Z' };
    }
    case 'xyz': case 'pts': case 'txt': case 'csv': {
      const text = await (await fetch(url)).text();
      return { object: parseXYZ(text), format: ext.toUpperCase() + ' (point cloud)', defaultUp: '+Z' };
    }
    default:
      if (SPLAT_EXT.includes(ext)) {
        const fileBytes = await fetchBuffer(url);
        return { object: await makeSplat(fileBytes, name), format: `Gaussian Splat (.${ext})`, defaultUp: '-Y' };
      }
      throw new Error('Định dạng không được hỗ trợ: .' + ext);
  }
}

async function makeSplat(fileBytes, fileName) {
  setLoading(true, 'Đang giải mã splat…');
  const mesh = new SplatMesh({ fileBytes, fileName });
  await mesh.initialized;
  return mesh;
}

async function loadPLY(url, name, manager, fileMap) {
  const buffer = await fetchBuffer(url);
  const head = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536)));
  const header = head.slice(0, head.indexOf('end_header'));
  // 3DGS PLY files carry spherical-harmonics / scale properties; compressed PLY uses a "chunk" element.
  if (/property\s+\w+\s+(f_dc_0|scale_0|rot_0)\b/.test(header) || /element\s+chunk\b/.test(header)) {
    return { object: await makeSplat(buffer, name), format: 'Gaussian Splat (.ply)', defaultUp: '-Y' };
  }
  const geo = new PLYLoader(manager).parse(buffer);
  const faces = Number(header.match(/element\s+face\s+(\d+)/)?.[1] || 0);
  const hasColor = !!geo.attributes.color;
  if (faces > 0 && geo.index) {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: hasColor, roughness: 0.7 });
    if (!hasColor) mat.color.set(0xc8c8c8);
    const texName = header.match(/comment\s+TextureFile\s+(.+)/i)?.[1]?.trim();
    if (texName && geo.attributes.uv) {
      try {
        const texURL = fileMap ? (fileMap.get(baseName(texName)) ?? texName) : new URL(texName, url).href;
        const tex = await new THREE.TextureLoader(manager).loadAsync(texURL);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.vertexColors = false;
        mat.color.set(0xffffff);
      } catch { toast(`Không tìm thấy texture "${texName}" của file PLY.`, true); }
    }
    return { object: new THREE.Mesh(geo, mat), format: 'PLY (mesh)' };
  }
  const mat = new THREE.PointsMaterial({ size: 0.01, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xdddddd });
  return { object: new THREE.Points(geo, mat), format: 'PLY (point cloud)' };
}

function parseXYZ(text) {
  const pos = [], col = [];
  let maxC = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t[0] === '#' || t.startsWith('//')) continue;
    const p = t.split(/[\s,;]+/).map(Number);
    if (p.length < 3 || Number.isNaN(p[0] + p[1] + p[2])) continue;
    pos.push(p[0], p[1], p[2]);
    // x y z r g b  |  x y z intensity r g b (PTS)
    const c = p.length >= 7 ? p.slice(4, 7) : p.length >= 6 ? p.slice(3, 6) : null;
    if (c && !Number.isNaN(c[0] + c[1] + c[2])) {
      col.push(c[0], c[1], c[2]);
      maxC = Math.max(maxC, c[0], c[1], c[2]);
    }
  }
  if (!pos.length) throw new Error('Không đọc được điểm nào từ file.');
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const hasColor = col.length === pos.length;
  if (hasColor) {
    const s = maxC > 1 ? 1 / 255 : 1;
    const c = new THREE.Color();
    for (let i = 0; i < col.length; i += 3) {
      c.setRGB(col[i] * s, col[i + 1] * s, col[i + 2] * s, THREE.SRGBColorSpace);
      col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.01, vertexColors: hasColor }));
}

/* ---------------- Built-in samples ---------------- */

function makeUVTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const n = 8, s = c.width / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = `hsl(${(x / n) * 360}, 65%, ${(x + y) % 2 ? 42 : 58}%)`;
      g.fillRect(x * s, y * s, s, s);
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.font = 'bold 34px system-ui';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${String.fromCharCode(65 + x)}${n - y}`, x * s + s / 2, y * s + s / 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.name = 'uv_grid.png';
  return tex;
}

function sampleKnot() {
  const geo = new THREE.TorusKnotGeometry(1, 0.35, 256, 48);
  const mat = new THREE.MeshStandardMaterial({ map: makeUVTexture(), roughness: 0.45, metalness: 0.1 });
  return new THREE.Mesh(geo, mat);
}

function samplePoints() {
  const N = 300000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // points scattered over a twisted, wavy torus
    const u = Math.random() * Math.PI * 2, v = Math.random() * Math.PI * 2;
    const r = 0.45 + 0.08 * Math.sin(5 * u) + (Math.random() - 0.5) * 0.02;
    const R = 1.4;
    pos[i * 3] = (R + r * Math.cos(v)) * Math.cos(u);
    pos[i * 3 + 1] = r * Math.sin(v) + 0.25 * Math.sin(3 * u);
    pos[i * 3 + 2] = (R + r * Math.cos(v)) * Math.sin(u);
    c.setHSL(u / (Math.PI * 2), 0.75, 0.45 + 0.2 * Math.sin(v));
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.01, vertexColors: true }));
}

async function loadSample(key) {
  if (key === 'knot') return setContent(sampleKnot(), { name: 'Torus knot (mẫu)', format: 'Mesh có texture UV' });
  if (key === 'points') return setContent(samplePoints(), { name: 'Point cloud (mẫu)', format: 'Point cloud' });
  const url = SAMPLES[key];
  await loadModel({ url, name: baseName(url) });
}

/* ---------------- Scene content ---------------- */

function disposeURLs() {
  blobURLs.forEach(URL.revokeObjectURL);
  blobURLs = [];
}

function disposeContent() {
  if (!content) return;
  orient.remove(content);
  const mats = new Set();
  content.traverse((o) => {
    if (isSplat(o)) { o.dispose(); return; }
    o.geometry?.dispose();
    const om = o.userData.origMat ?? o.material;
    if (om) [].concat(om).forEach((m) => mats.add(m));
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
    m.dispose();
  }
  unlitCache.forEach((m) => m.dispose());
  unlitCache.clear();
  mixer?.stopAllAction();
  mixer = null;
  content = null;
}

function setContent(object, { name, format, animations = [], defaultUp = '+Y' }) {
  disposeContent();
  content = object;
  content.traverse((o) => {
    if (o.isMesh && !isSplat(o)) {
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.userData.origMat = o.material;
    }
  });
  orient.add(content);

  if (animations.length) {
    mixer = new THREE.AnimationMixer(content);
    animations.forEach((clip) => mixer.clipAction(clip).play());
  }

  // Point size is relative to the model size so clouds of any scale look reasonable.
  const rawBox = computeBounds(content);
  state.pointBase = Math.max(rawBox.getSize(new THREE.Vector3()).length() * 0.0015, 1e-5);
  state.splatOpacity = 1;
  $('splatOp').value = 1;
  $('opVal').textContent = '100%';

  setUp(defaultUp, false);
  applyDisplay();
  recenter();
  fitView('iso');
  updateInfo(name, format, animations.length);
  buildTextureList();
  $('empty').classList.add('hidden');

  if (isSplat(content) && defaultUp === '-Y') {
    toast('Gaussian splat thường bị ngược trục Y nên đã tự lật 180°. Nếu sai, chọn lại "Trục lên" = +Y.', false, 6000);
  }
}

function updateInfo(name, format, animCount) {
  let verts = 0, tris = 0, points = 0, splats = 0;
  const mats = new Set();
  content.traverse((o) => {
    if (isSplat(o)) { splats += o.userData.splatCount ?? 0; return; }
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    if (o.isMesh) {
      verts += pos.count;
      tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
      [].concat(o.userData.origMat).forEach((m) => mats.add(m));
    } else if (o.isPoints) {
      points += pos.count;
    }
  });
  const size = computeBounds(orient).getSize(new THREE.Vector3());
  const rows = [['Định dạng', format]];
  if (verts) rows.push(['Đỉnh', fmt(verts)], ['Tam giác', fmt(Math.round(tris))], ['Vật liệu', fmt(mats.size)]);
  if (points) rows.push(['Điểm', fmt(points)]);
  if (splats) rows.push(['Splat', fmt(splats)]);
  if (animCount) rows.push(['Animation', fmt(animCount)]);
  rows.push(['Kích thước', [size.x, size.y, size.z].map((v) => +v.toPrecision(3)).join(' × ')]);
  const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  $('info').innerHTML = `<div class="name">${esc(name)}</div><table>${rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  $('info').classList.remove('hidden');
}

/* ---------------- Display modes ---------------- */

function makeChecker() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    g.fillStyle = (x + y) % 2 ? '#2b2f36' : '#e8e8e8';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  g.fillStyle = '#ef5b5b'; g.fillRect(0, 0, 512, 6);
  g.fillStyle = '#5bcf72'; g.fillRect(0, 0, 6, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const sharedMats = {
  clay: new THREE.MeshStandardMaterial({ color: 0xbdbdbd, roughness: 0.65, metalness: 0 }),
  normal: new THREE.MeshNormalMaterial(),
  uv: new THREE.MeshBasicMaterial({ map: makeChecker() }),
};
const unlitCache = new Map();

function displayMaterial(orig) {
  if (state.mode === 'texture') return orig;
  if (state.mode !== 'unlit') return sharedMats[state.mode];
  let m = unlitCache.get(orig);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: orig.map ?? null,
      alphaMap: orig.alphaMap ?? null,
      color: orig.map ? 0xffffff : (orig.color ?? new THREE.Color(0xffffff)),
      vertexColors: !!orig.vertexColors,
      transparent: !!orig.transparent,
      opacity: orig.opacity ?? 1,
      alphaTest: orig.alphaTest ?? 0,
    });
    unlitCache.set(orig, m);
  }
  return m;
}

function applyDisplay() {
  if (!content) return;
  const active = new Set();
  content.traverse((o) => {
    if (isSplat(o)) { o.opacity = state.splatOpacity; return; }
    if (o.isMesh && o.userData.origMat) {
      const om = o.userData.origMat;
      o.material = Array.isArray(om) ? om.map(displayMaterial) : displayMaterial(om);
      [].concat(o.material).forEach((m) => active.add(m));
    } else if (o.isPoints) {
      o.material.size = state.pointBase * state.pointScale;
    }
  });
  for (const m of active) {
    if (m.userData.origSide === undefined) m.userData.origSide = m.side;
    const side = state.doubleSide ? THREE.DoubleSide : m.userData.origSide;
    if (m.side !== side) { m.side = side; m.needsUpdate = true; }
    m.wireframe = state.wireframe;
  }
}

/* ---------------- Orientation ---------------- */

const DEG = Math.PI / 180;

function setUp(key, refresh = true) {
  const [x, y, z] = UP_PRESETS[key];
  orient.quaternion.setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG));
  $('upSelect').value = key;
  if (refresh) recenter();
  updateEuler();
}

function rotateModel(axis, angle) {
  const v = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  // premultiply → rotation about the world axis, independent of the current orientation
  orient.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(v, angle));
  const match = Object.keys(UP_PRESETS).find((k) => {
    const [a, b, c] = UP_PRESETS[k];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a * DEG, b * DEG, c * DEG));
    return Math.abs(q.dot(orient.quaternion)) > 0.9999;
  });
  $('upSelect').value = match ?? 'custom';
  recenter();
  updateEuler();
}

function updateEuler() {
  const e = new THREE.Euler().setFromQuaternion(orient.quaternion);
  const d = (r) => `${Math.round(r / DEG) + 0}°`;
  $('eulerOut').textContent = `X ${d(e.x)}, Y ${d(e.y)}, Z ${d(e.z)}`;
}

// Centre the model on the origin and put the grid under it.
function recenter() {
  pivot.position.set(0, 0, 0);
  const box = computeBounds(pivot);
  const center = box.getCenter(new THREE.Vector3());
  pivot.position.copy(center).negate();
  box.translate(pivot.position);

  const size = box.getSize(new THREE.Vector3());
  const diag = Math.max(size.length(), 1e-6);
  const step = Math.pow(10, Math.round(Math.log10(diag / 4)));
  const gridSize = Math.ceil((diag * 1.5) / step) * step;
  if (grid) { scene.remove(grid); grid.dispose(); }
  grid = new THREE.GridHelper(gridSize, Math.round(gridSize / step), 0x5a606b, 0x33373e);
  grid.position.y = box.min.y;
  grid.visible = $('gridChk').checked;
  scene.add(grid);

  axesHelper.scale.setScalar(diag * 0.4);
  bboxHelper.box.copy(box);
  controls.target.set(0, 0, 0);
}

/* ---------------- Camera ---------------- */

const VIEWS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0],
  top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], iso: [0.75, 0.55, 1],
};

function fitView(view) {
  const box = computeBounds(pivot);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-4);
  const fov = camera.fov * DEG;
  const fitH = radius / Math.sin(fov / 2);
  const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * camera.aspect));
  const dist = Math.max(fitH, fitW) * 1.05;

  let dir;
  if (view) {
    // Views are defined for a +Y-up world; rotate them to the current camera "up".
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), camera.up);
    dir = new THREE.Vector3(...VIEWS[view]).normalize().applyQuaternion(q);
  } else {
    dir = camera.position.clone().sub(controls.target).normalize();
  }
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = dist / 1000;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

function setCameraUp(key) {
  camera.up.set(...AXES[key]);
  // OrbitControls caches the up axis at construction, so rebuild it.
  const target = controls.target.clone();
  const { autoRotate } = controls;
  controls.dispose();
  controls = makeControls();
  controls.target.copy(target);
  controls.autoRotate = autoRotate;
  viewHelper.center = controls.target;
  fitView('iso');
}

function setRoll(deg) {
  deg = ((deg + 540) % 360) - 180;
  state.roll = deg * DEG;
  $('roll').value = deg;
  $('rollVal').textContent = `${deg}°`;
}

/* ---------------- Texture panel ---------------- */

function collectTextures() {
  const found = new Map();
  content?.traverse((o) => {
    if (!o.userData.origMat) return;
    for (const m of [].concat(o.userData.origMat)) {
      for (const [slot, label] of Object.entries(TEX_SLOTS)) {
        const t = m[slot];
        if (!t?.isTexture) continue;
        const entry = found.get(t) ?? { tex: t, slots: new Set(), mats: new Set() };
        entry.slots.add(label);
        entry.mats.add(m.name || '(không tên)');
        found.set(t, entry);
      }
    }
  });
  return [...found.values()];
}

function drawable(img) {
  return img && (img instanceof HTMLImageElement || img instanceof HTMLCanvasElement ||
    img instanceof ImageBitmap || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas));
}

function buildTextureList() {
  const list = $('texList');
  const entries = collectTextures();
  $('texCount').textContent = entries.length;
  list.innerHTML = '';
  if (!entries.length) {
    list.innerHTML = '<p class="hint">Mô hình này không có texture.</p>';
    return;
  }
  for (const e of entries) {
    const item = document.createElement('div');
    item.className = 'tex';
    const img = e.tex.image;
    if (drawable(img)) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const s = Math.min(128 / img.width, 128 / img.height);
      g.drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
      item.append(c);
    } else {
      const ph = document.createElement('div');
      ph.className = 'ph';
      ph.textContent = 'nén GPU';
      item.append(ph);
    }
    const label = document.createElement('small');
    label.textContent = [...e.slots].join(', ');
    item.title = `${e.tex.name || ''}\n${[...e.slots].join(', ')}`;
    item.append(label);
    item.addEventListener('click', () => openTexture(e));
    list.append(item);
  }
}

function openTexture(e) {
  const img = e.tex.image;
  if (!drawable(img)) { toast('Texture nén (KTX2/Basis) không xem trước được.', true); return; }
  const c = $('texCanvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  $('texTitle').textContent = e.tex.name || [...e.slots].join(', ');
  $('texMeta').textContent =
    `${img.width} × ${img.height} px · Kênh: ${[...e.slots].join(', ')} · Vật liệu: ${[...e.mats].join(', ')}` +
    ` · Không gian màu: ${e.tex.colorSpace || 'linear'}`;
  $('texModal').classList.remove('hidden');
  $('texDownload').onclick = () => {
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = (e.tex.name || 'texture').replace(/\.\w+$/, '') + '.png';
    a.click();
  };
}

async function applyTextureFile(file) {
  if (!content) { toast('Hãy tải mô hình trước.', true); return; }
  const url = URL.createObjectURL(file);
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.name = file.name;
    let applied = 0, noUV = 0;
    content.traverse((o) => {
      if (!o.userData.origMat) return;
      if (!o.geometry.attributes.uv) { noUV++; return; }
      for (const m of [].concat(o.userData.origMat)) {
        if (!('map' in m)) continue;
        m.map = tex;
        m.color?.set(0xffffff);
        m.vertexColors = false;
        m.needsUpdate = true;
        applied++;
      }
    });
    unlitCache.forEach((m) => m.dispose());
    unlitCache.clear();
    if (state.mode !== 'texture' && state.mode !== 'unlit') setMode('texture');
    applyDisplay();
    buildTextureList();
    if (!applied) toast('Mô hình không có toạ độ UV nên không gán được texture.', true);
    else toast(`Đã gán texture cho ${applied} vật liệu${noUV ? ` (${noUV} mesh không có UV)` : ''}.`);
  } catch {
    toast('Không đọc được ảnh.', true);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------- UI wiring ---------------- */

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  applyDisplay();
}

$('fileInput').addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
$('dirInput').addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
$('urlBtn').addEventListener('click', () => {
  const url = $('urlInput').value.trim();
  if (url) loadModel({ url, name: baseName(url) });
});
$('urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('urlBtn').click(); });
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => loadSample(b.dataset.sample)));

// Drag & drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; viewport.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; viewport.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  viewport.classList.remove('dragging');
  if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
});

// Display
document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('wireChk').addEventListener('change', (e) => { state.wireframe = e.target.checked; applyDisplay(); });
$('sideChk').addEventListener('change', (e) => { state.doubleSide = e.target.checked; applyDisplay(); });
$('animChk').addEventListener('change', (e) => { state.anim = e.target.checked; });
$('ptSize').addEventListener('input', (e) => {
  state.pointScale = +e.target.value;
  $('ptVal').textContent = `${state.pointScale.toFixed(1)}×`;
  applyDisplay();
});
$('splatOp').addEventListener('input', (e) => {
  state.splatOpacity = +e.target.value;
  $('opVal').textContent = `${Math.round(state.splatOpacity * 100)}%`;
  applyDisplay();
});

// Orientation
$('upSelect').addEventListener('change', (e) => setUp(e.target.value));
document.querySelectorAll('[data-rot]').forEach((b) => b.addEventListener('click', () => {
  const [axis, sign] = b.dataset.rot.split(',');
  rotateModel(axis, +sign * 90 * DEG);
}));
$('flipBtn').addEventListener('click', () => rotateModel('x', Math.PI));
$('resetOrient').addEventListener('click', () => setUp('+Y'));

// Camera
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => fitView(b.dataset.view)));
$('fitBtn').addEventListener('click', () => fitView());
$('camUp').addEventListener('change', (e) => setCameraUp(e.target.value));
$('roll').addEventListener('input', (e) => setRoll(+e.target.value));
$('roll180').addEventListener('click', () => setRoll(Math.round(state.roll / DEG) + 180));
$('rollReset').addEventListener('click', () => setRoll(0));
$('fov').addEventListener('input', (e) => {
  camera.fov = +e.target.value;
  camera.updateProjectionMatrix();
  $('fovVal').textContent = `${camera.fov}°`;
});
$('autoRot').addEventListener('change', (e) => { controls.autoRotate = e.target.checked; });

// Scene
$('gridChk').addEventListener('change', (e) => { if (grid) grid.visible = e.target.checked; });
$('axesChk').addEventListener('change', (e) => { axesHelper.visible = e.target.checked; });
$('bboxChk').addEventListener('change', (e) => { bboxHelper.visible = e.target.checked; });
$('envChk').addEventListener('change', (e) => { scene.environment = e.target.checked ? envMap : null; });
$('gizmoChk').addEventListener('change', (e) => {
  state.showGizmo = e.target.checked;
  $('gizmoHit').classList.toggle('off', !state.showGizmo);
});
function setBg(hex) { scene.background.set(hex); $('bgColor').value = hex; }
$('bgColor').addEventListener('input', (e) => setBg(e.target.value));
document.querySelectorAll('[data-bg]').forEach((b) => b.addEventListener('click', () => setBg(b.dataset.bg)));
$('light').addEventListener('input', (e) => {
  const v = +e.target.value;
  headLight.intensity = 1.6 * v;
  hemi.intensity = 0.6 * v;
  scene.environmentIntensity = v;
  $('lightVal').textContent = v.toFixed(2);
});
$('toneSel').addEventListener('change', (e) => {
  renderer.toneMapping = {
    neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, none: THREE.NoToneMapping,
  }[e.target.value];
});
$('exposure').addEventListener('input', (e) => {
  renderer.toneMappingExposure = +e.target.value;
  $('expVal').textContent = (+e.target.value).toFixed(2);
});

// Textures
$('texInput').addEventListener('change', (e) => { if (e.target.files[0]) applyTextureFile(e.target.files[0]); e.target.value = ''; });
$('texClose').addEventListener('click', () => $('texModal').classList.add('hidden'));
$('texModal').addEventListener('click', (e) => { if (e.target.id === 'texModal') $('texModal').classList.add('hidden'); });

// Toolbar
$('panelToggle').addEventListener('click', () => $('app').classList.toggle('collapsed'));
$('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else viewport.requestFullscreen?.();
});
$('shotBtn').addEventListener('click', () => {
  renderer.clear();
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = 'screenshot.png';
  a.click();
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') $('texModal').classList.add('hidden');
  if (!content) return;
  if (k === 'f') fitView();
  else if (k === 'w') { $('wireChk').checked = !state.wireframe; $('wireChk').dispatchEvent(new Event('change')); }
  else if (k === 'g') { $('gridChk').checked = !$('gridChk').checked; $('gridChk').dispatchEvent(new Event('change')); }
  else if (k === 'r') setUp('+Y');
});

if (window.innerWidth < 720) $('app').classList.add('collapsed');
// #sample=helmet|butterfly|points|knot  or  #url=<model url>
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('url')) loadModel({ url: hash.get('url'), name: baseName(hash.get('url')) });
else loadSample(hash.get('sample') in SAMPLES || ['points', 'knot'].includes(hash.get('sample')) ? hash.get('sample') : 'helmet');
