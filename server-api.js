/**
 * server-api.js — Hỗ trợ tải dữ liệu tĩnh (GitHub Pages) và backend server.
 * Chuyển danh sách đường dẫn file thành Entry[] tương thích với dataset.js & viewer.js.
 */

import { MODEL_EXT, IMAGE_EXT, VIDEO_EXT, extOf } from './dataset.js';

/**
 * Tải manifest tĩnh từ data/manifest.json (dùng cho GitHub Pages hoặc Static Web).
 * @returns {Promise<Array|null>} danh sách Entry[] hoặc null nếu không có manifest
 */
export async function fetchStaticManifest() {
  try {
    const res = await fetch('./data/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const paths = await res.json();
    if (!Array.isArray(paths) || !paths.length) return null;
    return paths.map((p) => makeServerEntry(p));
  } catch {
    return null;
  }
}

/** Lấy danh sách dataset từ server Flask (nếu có chạy backend). */
export async function fetchDatasets() {
  const res = await fetch('/api/datasets');
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

/** Lấy danh sách file của một dataset từ server Flask. */
export async function fetchEntries(dataset) {
  const res = await fetch(`/api/files/${encodeURIComponent(dataset)}`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const paths = await res.json();
  return paths.map((p) => makeServerEntry(p));
}

/** Upload nhiều file lên server Flask (nếu có backend). */
export async function uploadFiles(files, onProgress) {
  const arr = Array.from(files);
  const CHUNK = 50;
  let done = 0;
  for (let i = 0; i < arr.length; i += CHUNK) {
    const batch = arr.slice(i, i + CHUNK);
    const fd = new FormData();
    for (const f of batch) {
      fd.append('files[]', f, f.webkitRelativePath || f.name);
    }
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Upload thất bại (${res.status}): ${txt}`);
    }
    done += batch.length;
    onProgress?.(done, arr.length);
  }
}

/** Xoá một dataset khỏi server Flask. */
export async function deleteDataset(dataset) {
  const res = await fetch(`/api/delete/${encodeURIComponent(dataset)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Xoá thất bại (${res.status})`);
}

// ─── Chuyển đường dẫn thành Entry dùng chung cho Static Web & GitHub Pages ────

export function makeServerEntry(serverPath) {
  // Chuẩn hoá đường dẫn, loại bỏ gạch chéo đầu
  serverPath = serverPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = serverPath.split('/');
  const name = parts[parts.length - 1];
  const ext = extOf(name);
  const kind = MODEL_EXT.has(ext) ? 'model'
    : VIDEO_EXT.has(ext) ? 'video'
    : IMAGE_EXT.has(ext) ? 'image'
    : 'other';

  // URL tương đối để hoạt động cả trên GitHub Pages subfolder (https://user.github.io/repo/...)
  const url = './' + serverPath;

  return {
    file: null,          // null = dùng serverUrl
    serverUrl: url,      // URL tải file
    path: serverPath,    // dùng làm key trong dataset.js
    parts,
    name,
    ext,
    kind,
    isServer: true,
  };
}
