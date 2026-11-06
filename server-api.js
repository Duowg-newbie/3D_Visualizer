/**
 * server-api.js — Tự động nạp dữ liệu tĩnh cho GitHub Pages và Web tĩnh.
 */

import { MODEL_EXT, IMAGE_EXT, VIDEO_EXT, extOf } from './dataset.js';

/**
 * Tải manifest tĩnh từ data/manifest.json.
 * @returns {Promise<Array|null>} danh sách Entry[] hoặc null
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

/**
 * Chuyển đổi đường dẫn file tương đối thành Entry tương thích dataset.js & viewer.js.
 */
export function makeServerEntry(serverPath) {
  serverPath = serverPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = serverPath.split('/');
  const name = parts[parts.length - 1];
  const ext = extOf(name);
  const kind = MODEL_EXT.has(ext) ? 'model'
    : VIDEO_EXT.has(ext) ? 'video'
    : IMAGE_EXT.has(ext) ? 'image'
    : 'other';

  const url = './' + serverPath;

  return {
    file: null,
    serverUrl: url,
    path: serverPath,
    parts,
    name,
    ext,
    kind,
    isServer: true,
  };
}
