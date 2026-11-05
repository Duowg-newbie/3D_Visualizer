// Quét file từ thư mục, nhóm theo ID và chọn ảnh chính diện.

export const MODEL_EXT = new Set(['obj', 'ply', 'glb', 'gltf', 'fbx', 'stl', 'pcd', 'xyz', 'splat', 'ksplat', 'spz']);
export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif']);
export const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'avi']);

// Tên thư mục thường dùng để phân loại theo kiểu file chứ không phải theo ID.
const TYPE_FOLDERS = /^(mesh|meshes|model|models|obj|objs|ply|plys|glb|images?|imgs?|photos?|rgb|high[_-]?stage|low[_-]?stage|textures?|tex|gaussians?|splats?|3dgs|gs|point_?clouds?|pcd|pc|clouds?|renders?|views?|videos?|vids?|turntables?|mp4|360)$/i;
const IMAGE_FOLDERS = /^images?$/i;

// Các token mô tả trong tên file, bỏ đi khi so khớp tên theo ID.
const DESCRIPTOR_TOKENS = new Set([
  'mesh', 'model', 'obj', 'ply', 'gs', 'gaussian', 'gaussians', 'splat', 'point', 'points', 'pc', 'pcd',
  'cloud', 'pointcloud', 'tex', 'texture', 'textured', 'front', 'frontal', 'img', 'image', 'rgb', 'albedo',
  'diffuse', 'recon', 'reconstruction', 'final', 'face', 'head', 'scan', 'photo', 'color', 'colour',
  'video', 'vid', 'turntable', '360', 'rotate', 'rotation', 'orbit', 'spin', 'render',
]);

export const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};
const stemOf = (name) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? name : name.slice(0, i);
};
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Chuẩn hoá danh sách File từ <input webkitdirectory> hoặc <input multiple>. */
export function entriesFromFileList(fileList) {
  return Array.from(fileList).map((file) => makeEntry(file, file.webkitRelativePath || file.name));
}

/** Đọc đệ quy các file từ thao tác kéo thả (hỗ trợ cả thư mục). */
export async function entriesFromDrop(dataTransfer) {
  const roots = Array.from(dataTransfer.items || [])
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!roots.length) return entriesFromFileList(dataTransfer.files);

  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push(makeEntry(file, prefix + file.name));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries trả về theo từng đợt, phải gọi đến khi rỗng.
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, prefix + entry.name + '/');
      }
    }
  };
  for (const r of roots) await walk(r, '');
  return out;
}

function makeEntry(file, path) {
  path = path.replace(/\\/g, '/');
  const ext = extOf(file.name);
  return {
    file,
    path,
    parts: path.split('/'),
    name: file.name,
    ext,
    kind: MODEL_EXT.has(ext) ? 'model' : VIDEO_EXT.has(ext) ? 'video' : IMAGE_EXT.has(ext) ? 'image' : 'other',
  };
}

/** Chọn chế độ nhóm phù hợp nhất khi để "tự động". */
function detectMode(entries) {
  // Video 360° cũng xác định ID như file 3D.
  const models = entries.filter((e) => e.kind === 'model' || e.kind === 'video');
  if (!models.length) return 'folder1';
  // Ảnh/model nằm ngay trong thư mục gốc => nhóm theo tên.
  if (models.some((e) => e.parts.length < 3)) return 'name';
  const lvl1 = new Set(models.map((e) => e.parts[1]));
  if ([...lvl1].every((n) => TYPE_FOLDERS.test(n))) {
    // root/meshes/001.obj + root/images/001.jpg, hoặc root/split/ID/...
    const deep = models.every((e) => e.parts.length >= 4);
    const lvl2 = new Set(models.map((e) => e.parts[2]));
    if (deep && ![...lvl2].every((n) => TYPE_FOLDERS.test(n))) return 'folder2';
    return 'name';
  }
  return 'folder1';
}

/** Khoá ID từ tên file: bỏ các token mô tả như _mesh, _front, _tex… */
function nameKey(name) {
  const stem = stemOf(name).toLowerCase();
  const tokens = stem.split(/[_\-.\s]+/).filter(Boolean);
  const kept = tokens.filter((t) => !DESCRIPTOR_TOKENS.has(t));
  return (kept.length ? kept : tokens).join('_') || stem;
}

/**
 * Nhóm các entry thành danh sách ID.
 * @returns {{ rootName: string, mode: string, ids: Array }}
 */
export function buildDataset(entries, mode = 'auto') {
  entries = entries.filter((e) => e.kind !== 'other' || ['mtl', 'bin'].includes(e.ext));
  const rootName = entries[0]?.parts.length > 1 ? entries[0].parts[0] : 'files';
  const resolved = mode === 'auto' ? detectMode(entries) : mode;
  const groups = new Map();
  const get = (id) => {
    if (!groups.has(id)) groups.set(id, { id, files: [] });
    return groups.get(id);
  };

  if (resolved === 'folder1' || resolved === 'folder2') {
    const depth = resolved === 'folder1' ? 1 : 2;
    const modelIds = entries
      .filter((e) => e.kind === 'model')
      .map((e) => folderEntryId(e, depth))
      .sort((a, b) => b.length - a.length);
    for (const e of entries) {
      // File nằm cao hơn cấp ID: gom chung vào một nhóm gốc.
      let id = folderEntryId(e, depth);
      if (e.kind === 'image' && e.parts.some((part) => IMAGE_FOLDERS.test(part))) {
        id = matchImageId(e, modelIds);
        if (!id) continue;
      }
      get(id).files.push(e);
    }
  } else {
    // Theo tên: mỗi model xác định một ID, video/ảnh/mtl ghép theo khoá tên.
    const models = entries.filter((e) => e.kind === 'model');
    for (const m of models) get(nameKey(m.name)).files.push(m);
    const byKey = (k, keys) => (groups.has(k) ? k : keys.find((key) => k.startsWith(key) || key.startsWith(k)));
    // Video không khớp model nào thì tự thành một ID (bộ dữ liệu chỉ có video).
    const modelKeys = [...groups.keys()].sort((a, b) => b.length - a.length);
    for (const v of entries) {
      if (v.kind !== 'video') continue;
      const k = nameKey(v.name);
      get(byKey(k, modelKeys) || k).files.push(v);
    }
    const keys = [...groups.keys()].sort((a, b) => b.length - a.length);
    for (const e of entries) {
      if (e.kind === 'model' || e.kind === 'video') continue;
      let id;
      if (e.kind === 'image' && e.parts.some((part) => IMAGE_FOLDERS.test(part))) {
        id = matchImageId(e, keys);
        if (!id) continue;
      } else {
        const k = nameKey(e.name);
        id = byKey(k, keys);
      }
      // Cùng thư mục với đúng một model => thuộc model đó (vd. texture, mtl).
      if (!id) {
        const dir = e.parts.slice(0, -1).join('/');
        const sameDir = entries.filter((m) => (m.kind === 'model' || m.kind === 'video') && m.parts.slice(0, -1).join('/') === dir);
        if (sameDir.length === 1) id = [...groups.values()].find((g) => g.files.includes(sameDir[0])).id;
      }
      if (id) groups.get(id).files.push(e);
    }
  }

  const ids = [...groups.values()]
    .map((g) => {
      g.models = g.files.filter((f) => f.kind === 'model').sort((a, b) => natural.compare(a.path, b.path));
      g.videos = g.files.filter((f) => f.kind === 'video').sort((a, b) => natural.compare(a.path, b.path));
      g.images = g.files.filter((f) => f.kind === 'image').sort((a, b) => natural.compare(a.path, b.path));
      g.coverImages = g.images.filter((im) => im.parts.some((part) => IMAGE_FOLDERS.test(part)));
      // Chỉ dùng ảnh trong thư mục images làm ảnh đại diện.
      g.cover = pickCover(g.coverImages, rootName, g.id);
      return g;
    })
    .filter((g) => g.models.length || g.videos.length || g.images.length)
    .sort((a, b) => natural.compare(a.id, b.id));

  return { rootName, mode: resolved, ids };
}

/** Điểm "giống ảnh chính diện" của một ảnh, càng cao càng tốt. */
export function frontalScore(entry) {
  const n = entry.name.toLowerCase();
  const p = entry.path.toLowerCase();
  let s = 0;
  if (/front|frontal|chinh[_-]?dien|center|centre|neutral|straight/.test(n)) s += 100;
  if (/(^|[^a-z0-9])(cam|view|img|image|frame)?[_-]?0+([^0-9]|$)/.test(n)) s += 40;
  if (/(^|[^a-z])(face|rgb|photo|portrait|input|source|gt)([^a-z]|$)/.test(n)) s += 15;
  if (/tex|albedo|diffuse|(^|[^a-z])uv([^a-z]|$)|normal|mask|depth|seg|parsing|spec|rough|metal|(^|[^a-z])ao([^a-z]|$)|disp|bump|_n\./.test(n)) s -= 80;
  if (/textures?\//.test(p)) s -= 60;
  if (/left|right|side|back|profile|top|bottom/.test(n)) s -= 30;
  s -= entry.parts.length; // ưu tiên ảnh nằm nông hơn
  return s;
}

function pickCover(images, rootName, id) {
  if (!images.length) return null;
  const saved = loadCoverOverride(rootName, id);
  if (saved) {
    const hit = images.find((im) => im.path === saved);
    if (hit) return hit;
  }
  let best = images[0];
  let bestScore = -Infinity;
  for (const im of images) {
    const sc = frontalScore(im);
    if (sc > bestScore) { best = im; bestScore = sc; }
  }
  return best;
}

function folderEntryId(entry, depth) {
  if (entry.parts.length >= 4 && TYPE_FOLDERS.test(entry.parts[1])) return entry.parts[2];
  return entry.parts.length > depth + 1 ? entry.parts.slice(1, depth + 1).join('/') : '(gốc)';
}

function matchImageId(entry, ids) {
  const imageFolder = entry.parts.findIndex((part) => IMAGE_FOLDERS.test(part));
  const folderId = imageFolder >= 0 && imageFolder < entry.parts.length - 2
    ? entry.parts[imageFolder + 1]
    : null;
  const candidates = [folderId, stemOf(entry.name), nameKey(entry.name)].filter(Boolean);
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exactMatches = new Set(
    candidates.flatMap((candidate) => ids.filter((id) => normalize(id) === normalize(candidate))),
  );
  if (exactMatches.size === 1) return [...exactMatches][0];

  const prefixMatches = new Set();
  for (const candidate of candidates) {
    for (const id of ids) {
      const normalizedId = normalize(id);
      const normalizedCandidate = normalize(candidate);
      if (normalizedId.startsWith(normalizedCandidate) || normalizedCandidate.startsWith(normalizedId)) {
        prefixMatches.add(id);
      }
    }
  }
  return prefixMatches.size === 1 ? [...prefixMatches][0] : null;
}

const coverKey = (root, id) => `face3d:cover:${root}/${id}`;
function loadCoverOverride(root, id) {
  try { return localStorage.getItem(coverKey(root, id)); } catch { return null; }
}
export function saveCoverOverride(root, id, path) {
  try { localStorage.setItem(coverKey(root, id), path); } catch { /* không có storage */ }
}
