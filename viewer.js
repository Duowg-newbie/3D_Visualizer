import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { XYZLoader } from 'three/addons/loaders/XYZLoader.js';

const SPLAT_EXT = new Set(['splat', 'ksplat', 'spz']);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const TEXTURE_HINT = /tex|albedo|diffuse|color|colour|base|uv/i;

/**
 * Lấy dữ liệu thực của một entry:
 * - Entry local → trả về entry.file (File object gốc)
 * - Entry server → fetch về, trả về Blob đóng gói thành đối tượng File-like
 */
async function resolveFile(entry) {
  if (!entry.isServer) return entry.file;
  const res = await fetch(entry.serverUrl);
  if (!res.ok) throw new Error(`Không tải được ${entry.serverUrl} (${res.status})`);
  const blob = await res.blob();
  // Gắn thêm thuộc tính .text() và .arrayBuffer() như File
  blob.name = entry.name;
  return blob;
}

/**
 * Trả về URL để three.js loader có thể load trực tiếp:
 * - Entry local → blob URL
 * - Entry server → HTTP URL trực tiếp
 */
function directUrl(entry, blobUrls) {
  if (entry.isServer) return entry.serverUrl;
  if (!blobUrls.has(entry.file)) blobUrls.set(entry.file, URL.createObjectURL(entry.file));
  return blobUrls.get(entry.file);
}

const VIEW_DIRS = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
};

export const ORIENT_PRESETS = {
  identity: new THREE.Quaternion(),
  zup: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
  '-zup': new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  xup: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  opencv: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
  upsideDown: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI),
  backward: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI),
};

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1b1d22');
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    this.camera.position.set(0, 0, 3);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    // Tự xoay 360° theo thời gian thực (không phụ thuộc FPS), dừng khi người dùng đang kéo.
    this.spin = { on: false, rpm: 12, dir: 1, dragging: false };
    this.controls.addEventListener('start', () => { this.spin.dragging = true; });
    this.controls.addEventListener('end', () => { this.spin.dragging = false; });
    this.clock = new THREE.Clock();

    // Đèn bán cầu + đèn gắn theo camera để mặt luôn được chiếu sáng.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x50505a, 1.1);
    this.scene.add(this.hemi);
    this.headlight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.headlight.position.set(0.4, 0.5, 1);
    this.headlight.target.position.set(0, 0, -1);
    this.camera.add(this.headlight, this.headlight.target);

    // pivot: xoay hướng vật thể; content: dịch để tâm bbox về gốc toạ độ.
    this.pivot = new THREE.Group();
    this.content = new THREE.Group();
    this.pivot.add(this.content);
    this.scene.add(this.pivot);

    this.grid = new THREE.GridHelper(1, 20, 0x555a66, 0x30333b);
    this.axes = new THREE.AxesHelper(1);
    this.axes.visible = false;
    this.scene.add(this.grid, this.axes);

    this.localBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    this.radius = 1;
    this.settings = { shading: 'original', wireframe: false, doubleSide: true, pointSize: 1, light: 1 };
    this.overrideTexture = null;
    this.splatViewer = null;
    this.blobUrls = new Map();
    this.loadToken = 0;

    this.sharedMats = {
      shaded: new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.65, metalness: 0 }),
      normal: new THREE.MeshNormalMaterial(),
    };

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      if (this.spin.on && !this.spin.dragging && this.object) this.orbitBy((this.spin.dir || 1) * (this.spin.rpm / 60) * Math.PI * 2 * dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- tải file

  /**
   * @param entry  file 3D cần xem ({file, name, ext})
   * @param related các file cùng ID (để tìm .mtl, texture, .bin)
   * @returns thông tin mô hình
   */
  async load(entry, related) {
    const token = ++this.loadToken;
    await this.clear();
    // Map: tên file thường → entry (hỗ trợ cả local lẫn server)
    this.resourceEntries = new Map(related.map((r) => [r.name.toLowerCase(), r]));
    this.resources = new Map(related.map((r) => [r.name.toLowerCase(), r.file])); // legacy (local only)
    this.missing = new Set();

    const ext = entry.ext;
    let object;
    const info = { file: entry.path, type: ext.toUpperCase() };

    try {
      if (SPLAT_EXT.has(ext)) {
        const f = await resolveFile(entry);
        object = await this.loadSplat(f, ext, info);
      } else if (ext === 'ply') {
        const f = await resolveFile(entry);
        const buf = await f.arrayBuffer();
        const header = readPlyHeader(buf);
        if (/property\s+\w+\s+(f_dc_0|scale_0|rot_0)/.test(header)) {
          object = await this.loadSplat(f, 'ply', info);
        } else {
          object = this.loadPly(buf, header, info);
        }
      } else {
        object = await this.loadMesh(entry, related, info);
      }
    } catch (e) {
      if (token !== this.loadToken) return null; // đã chuyển sang file khác
      throw e;
    }
    if (token !== this.loadToken) {
      if (object?.userData?.isSplat) object.dispose?.();
      else disposeObject(object);
      return null;
    }

    if (!object.userData.isSplat) {
      object.updateMatrixWorld(true);
      this.localBox = new THREE.Box3().setFromObject(object);
      this.prepareMaterials(object);
    }
    if (this.localBox.isEmpty()) this.localBox.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    const center = this.localBox.getCenter(new THREE.Vector3());
    this.content.position.copy(center).negate();
    this.content.add(object);
    this.object = object;
    this.radius = Math.max(this.localBox.getSize(new THREE.Vector3()).length() / 2, 1e-6);

    this.applySettings();
    this.updateHelpers();
    this.frame('front');

    const size = this.localBox.getSize(new THREE.Vector3());
    info.size = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)}`;
    if (!info.splats) Object.assign(info, countGeometry(object));
    info.uv = hasUv(object);
    if (this.missing.size) info.missing = [...this.missing];
    return info;
  }

  urlFor(entryOrFile) {
    // Nhận cả entry server (có .isServer/.serverUrl) lẫn File thuần
    if (entryOrFile?.isServer) return entryOrFile.serverUrl;
    const file = entryOrFile;
    if (!this.blobUrls.has(file)) this.blobUrls.set(file, URL.createObjectURL(file));
    return this.blobUrls.get(file);
  }

  makeManager() {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (/^(blob:|data:|https?:)/.test(url)) return url;
      let base = url.split(/[?#]/)[0].split(/[\\\/]/).pop();
      try { base = decodeURIComponent(base); } catch { /* giữ nguyên */ }
      // Ưu tiên resourceEntries (hỗ trợ cả server entry)
      const re = this.resourceEntries?.get(base.toLowerCase());
      if (re) return this.urlFor(re);
      const f = this.resources.get(base.toLowerCase());
      if (!f) { this.missing.add(base); return url; }
      return this.urlFor(f);
    });
    return manager;
  }

  async loadMesh(entry, related, info) {
    const manager = this.makeManager();
    const ext = entry.ext;

    if (ext === 'obj') {
      const f = await resolveFile(entry);
      const text = await f.text();
      const loader = new OBJLoader(manager);
      const mtlName = (text.match(/^mtllib\s+(.+)$/m) || [])[1]?.trim();
      const mtlEntry =
        (mtlName && related.find((r) => r.name.toLowerCase() === mtlName.split(/[\\\/]/).pop().toLowerCase())) ||
        related.find((r) => r.ext === 'mtl' && stem(r.name) === stem(entry.name));
      if (mtlEntry) {
        const mf = await resolveFile(mtlEntry);
        const materials = new MTLLoader(manager).parse(await mf.text(), '');
        materials.preload();
        loader.setMaterials(materials);
        info.mtl = mtlEntry.name;
      }
      const obj = loader.parse(text);
      // Không có MTL: thử tự gán texture cùng tên / có tên gợi ý.
      if (!mtlEntry && hasUv(obj)) {
        const tex = guessTexture(entry, related);
        if (tex) {
          const tf = await resolveFile(tex);
          this.applyTextureTo(obj, await this.loadTexture(tf));
          info.autoTexture = tex.name;
        }
      }
      return obj;
    }

    const f = await resolveFile(entry);
    const buf = await f.arrayBuffer();
    if (ext === 'glb' || ext === 'gltf') {
      const gltf = await new Promise((res, rej) => new GLTFLoader(manager).parse(buf, '', res, rej));
      return gltf.scene;
    }
    if (ext === 'fbx') return new FBXLoader(manager).parse(buf, '');
    if (ext === 'stl') {
      const geo = new STLLoader().parse(buf);
      return makeMesh(geo);
    }
    if (ext === 'pcd') {
      const pts = new PCDLoader().parse(buf);
      pts.userData.isPoints = true;
      return pts;
    }
    if (ext === 'xyz') {
      const geo = await new Promise((res, rej) => {
        new XYZLoader(manager).load(this.urlFor(entry), res, undefined, rej);
      });
      return makePoints(geo);
    }
    throw new Error(`Định dạng .${ext} chưa được hỗ trợ`);
  }

  loadPly(buf, header, info) {
    const geo = new PLYLoader().parse(buf);
    const faces = /element\s+face\s+(\d+)/.exec(header);
    if (!geo.index && !(faces && +faces[1] > 0)) {
      info.type = 'PLY (point cloud)';
      return makePoints(geo);
    }
    info.type = 'PLY (mesh)';
    const mesh = makeMesh(geo);
    const texName = (/comment\s+TextureFile\s+(.+)/i.exec(header) || [])[1]?.trim();
    if (texName && geo.attributes.uv) {
      const key = texName.split(/[\\\/]/).pop().toLowerCase();
      const re = this.resourceEntries?.get(key);
      const f = re ? null : this.resources.get(key);
      if (re || f) {
        (re ? resolveFile(re) : Promise.resolve(f))
          .then((tf) => this.loadTexture(tf))
          .then((t) => this.applyTextureTo(mesh, t));
        info.autoTexture = texName;
      } else {
        this.missing.add(texName);
      }
    }
    return mesh;
  }

  async loadSplat(file, ext, info) {
    let GS;
    try {
      GS = await import('@mkkellogg/gaussian-splats-3d');
    } catch (e) {
      throw new Error('Không tải được thư viện Gaussian Splat (kiểm tra kết nối mạng).\n' + e.message);
    }
    const formats = { ply: GS.SceneFormat.Ply, splat: GS.SceneFormat.Splat, ksplat: GS.SceneFormat.KSplat, spz: GS.SceneFormat.Spz };
    const viewer = new GS.DropInViewer({
      sharedMemoryForWorkers: false, // không cần header COOP/COEP
      dynamicScene: true, // để splat theo transform của pivot
      gpuAcceleratedSort: false,
    });
    this.splatViewer = viewer;
    await viewer.addSplatScene(this.urlFor(file), {
      format: formats[ext],
      showLoadingUI: false,
      progressiveLoad: false,
      splatAlphaRemovalThreshold: 5,
    });
    viewer.userData.isSplat = true;

    const mesh = viewer.viewer?.splatMesh || viewer.splatMesh;
    const count = mesh?.getSplatCount?.() ?? 0;
    info.type = `Gaussian Splat (${ext.toUpperCase()})`;
    info.splats = count;
    this.localBox = robustSplatBox(mesh, count);
    return viewer;
  }

  async loadTexture(file) {
    const tex = await new THREE.TextureLoader().loadAsync(this.urlFor(file));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  applyTextureTo(object, texture) {
    object.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes.uv) return;
      const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, metalness: 0 });
      o.material = mat;
      if (o.userData.orig) o.userData.orig = mat;
    });
    this.applySettings();
  }

  /** Chọn texture thủ công từ danh sách ảnh; null = theo file. */
  async setOverrideTexture(file) {
    this.overrideTexture?.dispose();
    this.overrideTexture = file ? await this.loadTexture(file) : null;
    if (this.overrideTexture) {
      const mat = new THREE.MeshStandardMaterial({ map: this.overrideTexture, roughness: 0.8, metalness: 0 });
      this.eachMesh((o) => { o.userData.override = o.geometry.attributes.uv ? mat : null; });
    } else {
      this.eachMesh((o) => { o.userData.override = null; });
    }
    this.applySettings();
  }

  async clear() {
    if (this.splatViewer) {
      const v = this.splatViewer;
      this.splatViewer = null;
      v.parent?.remove(v);
      try { await v.dispose(); } catch { /* bỏ qua */ }
    }
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      disposeObject(child);
    }
    this.overrideTexture?.dispose();
    this.overrideTexture = null;
    for (const url of this.blobUrls.values()) URL.revokeObjectURL(url);
    this.blobUrls.clear();
    this.object = null;
  }

  // ---------------------------------------------------------------- hiển thị

  prepareMaterials(object) {
    object.traverse((o) => {
      if (o.isMesh) {
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        o.userData.orig = o.material;
      }
    });
  }

  eachMesh(fn) {
    this.object?.traverse((o) => { if (o.isMesh && o.userData.orig) fn(o); });
  }

  applySettings() {
    const s = this.settings;
    const side = s.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
    for (const m of Object.values(this.sharedMats)) {
      m.wireframe = s.wireframe;
      m.side = side;
      m.needsUpdate = true;
    }
    this.eachMesh((o) => {
      if (s.shading === 'shaded') o.material = this.sharedMats.shaded;
      else if (s.shading === 'normal') o.material = this.sharedMats.normal;
      else o.material = o.userData.override || o.userData.orig;
      for (const m of [o.material].flat()) {
        m.wireframe = s.wireframe;
        m.side = side;
        m.needsUpdate = true;
      }
    });
    this.object?.traverse((o) => {
      if (!o.isPoints) return;
      o.material.size = this.radius * 0.004 * s.pointSize;
      o.material.sizeAttenuation = true;
    });
    this.hemi.intensity = 1.1 * s.light;
    this.headlight.intensity = 1.6 * s.light;
  }

  set(key, value) {
    this.settings[key] = value;
    this.applySettings();
  }

  setBackground(color) { this.scene.background = new THREE.Color(color); }
  setGrid(v) { this.grid.visible = v; }
  setAxes(v) { this.axes.visible = v; }
  setAutoRotate(v) { this.spin.on = v; }
  /** Tốc độ tự xoay, đơn vị vòng/phút. */
  setRotateSpeed(rpm) { this.spin.rpm = rpm; }

  /** Quay camera quanh trục dọc qua tâm => vật thể như đang xoay trên bàn xoay. */
  orbitBy(angle) {
    const t = this.controls.target;
    this.camera.position.sub(t).applyAxisAngle(Y_AXIS, angle).add(t);
    this.camera.lookAt(t);
  }
  setFov(v) {
    this.camera.fov = v;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- hướng & camera

  getOrientation() { return this.pivot.quaternion.toArray(); }

  setOrientation(q) {
    if (Array.isArray(q)) this.pivot.quaternion.fromArray(q);
    else this.pivot.quaternion.copy(q);
    this.updateHelpers();
  }

  /** Xoay quanh trục thế giới (x|y|z) một góc (độ). */
  rotate(axis, deg) {
    const v = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const q = new THREE.Quaternion().setFromAxisAngle(v, THREE.MathUtils.degToRad(deg));
    this.pivot.quaternion.premultiply(q).normalize();
    this.updateHelpers();
  }

  worldBox() {
    const half = this.localBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const box = new THREE.Box3(half.clone().negate(), half);
    this.pivot.updateMatrixWorld(true);
    return box.applyMatrix4(this.pivot.matrixWorld);
  }

  updateHelpers() {
    const box = this.worldBox();
    const s = this.radius * 4;
    this.grid.scale.setScalar(s);
    this.grid.position.set(0, box.min.y, 0);
    this.axes.scale.setScalar(this.radius * 1.2);
  }

  frame(view = 'front') {
    const dir = new THREE.Vector3(...(VIEW_DIRS[view] || VIEW_DIRS.front)).normalize();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const dist = (this.radius / Math.sin(fit / 2)) * 1.05;
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.camera.near = Math.max(dist / 1000, 1e-5);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

// ------------------------------------------------------------------ helpers

function stem(name) {
  const i = name.lastIndexOf('.');
  return (i < 0 ? name : name.slice(0, i)).toLowerCase();
}

function guessTexture(entry, related) {
  const images = related.filter((r) => r.kind === 'image');
  const dir = entry.parts.slice(0, -1).join('/');
  return (
    images.find((im) => stem(im.name) === stem(entry.name)) ||
    images.find((im) => TEXTURE_HINT.test(im.name) && im.parts.slice(0, -1).join('/') === dir) ||
    images.find((im) => TEXTURE_HINT.test(im.name)) ||
    null
  );
}

function readPlyHeader(buf) {
  const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 65536));
  const text = new TextDecoder('latin1').decode(bytes);
  const end = text.indexOf('end_header');
  return end < 0 ? text : text.slice(0, end);
}

function makeMesh(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: geo.attributes.color ? 0xffffff : 0xc8c8c8,
    vertexColors: !!geo.attributes.color,
    roughness: 0.7,
    metalness: 0,
  });
  return new THREE.Mesh(geo, mat);
}

function makePoints(geo) {
  const mat = new THREE.PointsMaterial({
    size: 0.005,
    vertexColors: !!geo.attributes.color,
    color: geo.attributes.color ? 0xffffff : 0xdddddd,
  });
  const pts = new THREE.Points(geo, mat);
  pts.userData.isPoints = true;
  return pts;
}

/** Bbox theo phân vị 2–98% để bỏ các splat bay lơ lửng. */
function robustSplatBox(mesh, count) {
  const box = new THREE.Box3();
  if (!mesh || !count || !mesh.getSplatCenter) return box;
  const n = Math.min(count, 50000);
  const step = count / n;
  const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n);
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    mesh.getSplatCenter(Math.floor(i * step), c, false);
    xs[i] = c.x; ys[i] = c.y; zs[i] = c.z;
  }
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  for (const a of [xs, ys, zs]) a.sort();
  box.min.set(q(xs, 0.02), q(ys, 0.02), q(zs, 0.02));
  box.max.set(q(xs, 0.98), q(ys, 0.98), q(zs, 0.98));
  return box;
}

function hasUv(object) {
  let uv = false;
  object.traverse?.((o) => { if (o.isMesh && o.geometry.attributes.uv) uv = true; });
  return uv;
}

function countGeometry(object) {
  let vertices = 0, faces = 0, points = 0;
  object.traverse((o) => {
    const g = o.geometry;
    if (!g?.attributes?.position) return;
    const n = g.attributes.position.count;
    if (o.isPoints) points += n;
    else if (o.isMesh) {
      vertices += n;
      faces += (g.index ? g.index.count : n) / 3;
    }
  });
  const out = {};
  if (vertices) { out.vertices = vertices; out.faces = Math.round(faces); }
  if (points) out.points = points;
  return out;
}

function disposeObject(obj) {
  obj?.traverse?.((o) => {
    o.geometry?.dispose();
    for (const m of [o.userData?.orig, o.material].flat()) {
      if (!m?.dispose) continue;
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

function fmt(n) {
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toPrecision(3);
}
