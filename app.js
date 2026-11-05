import { buildDataset, entriesFromDrop, entriesFromFileList, saveCoverOverride } from './dataset.js';
import { Viewer, ORIENT_PRESETS } from './viewer.js';
import { fetchStaticManifest, fetchDatasets, fetchEntries, uploadFiles, deleteDataset } from './server-api.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('face3d:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('face3d:' + key, JSON.stringify(value)); } catch { /* bỏ qua */ }
  },
};

const state = {
  entries: [],
  dataset: null,
  filtered: [],
  current: null, // { group, model }
};
let viewer = null;
const imageUrls = new Map();

/** Trả về URL để hiển thị/tải một entry (hỗ trợ cả file local lẫn server). */
const urlOf = (entry) => {
  if (!entry) return '';
  // Entry từ server: dùng URL HTTP trực tiếp.
  if (entry.isServer) return entry.serverUrl;
  // Entry local: tạo object URL từ File.
  const file = entry.file ?? entry; // tương thích cách gọi cũ urlOf(file)
  if (!imageUrls.has(file)) imageUrls.set(file, URL.createObjectURL(file));
  return imageUrls.get(file);
};

// ================================================================== nạp dữ liệu

function loadEntries(entries) {
  for (const u of imageUrls.values()) URL.revokeObjectURL(u);
  imageUrls.clear();
  state.entries = entries;
  rebuild();
  showGallery();
  // Chỉ có đúng một model/video => mở luôn.
  const ds = state.dataset;
  const only = ds.ids.length === 1 ? itemsOf(ds.ids[0]) : [];
  if (only.length === 1) openModel(ds.ids[0], only[0]);
}

/** Các mục xem được của một ID: file 3D trước, rồi video 360°. */
const itemsOf = (g) => [...g.models, ...g.videos];

function rebuild() {
  state.dataset = buildDataset(state.entries, $('groupMode').value);
  renderGallery();
}

$('folderInput').addEventListener('change', (e) => {
  if (e.target.files.length) loadEntries(entriesFromFileList(e.target.files));
  e.target.value = '';
});
$('fileInput').addEventListener('change', (e) => {
  if (e.target.files.length) loadEntries(entriesFromFileList(e.target.files));
  e.target.value = '';
});
$('groupMode').addEventListener('change', () => {
  store.set('groupMode', $('groupMode').value);
  if (state.entries.length) rebuild();
});
$('groupMode').value = store.get('groupMode', 'auto');

// ================================================================== upload lên server

$('uploadFolderInput').addEventListener('change', async (e) => {
  const files = e.target.files;
  e.target.value = '';
  if (!files.length) return;
  const status = $('serverUploadStatus');
  status.className = 'server-upload-status';
  status.textContent = `Đang upload 0 / ${files.length} file…`;
  status.classList.remove('hidden');
  openServerModal();
  try {
    await uploadFiles(files, (done, total) => {
      status.textContent = `Đang upload ${done} / ${total} file…`;
    });
    status.className = 'server-upload-status ok';
    status.textContent = `✓ Upload thành công ${files.length} file!`;
    await refreshServerDatasets();
  } catch (err) {
    status.className = 'server-upload-status err';
    status.textContent = `✗ Lỗi: ${err.message}`;
  }
});

// ================================================================== server modal

async function openServerModal() {
  $('serverModal').classList.remove('hidden');
  await refreshServerDatasets();
}

async function refreshServerDatasets() {
  const list = $('serverDatasetList');
  list.innerHTML = '<p class="muted" style="padding:12px">Đang tải…</p>';
  try {
    const datasets = await fetchDatasets();
    if (!datasets.length) {
      list.innerHTML = '<p class="muted" style="padding:12px">Chưa có dataset nào. Hãy upload thư mục lên server.</p>';
      return;
    }
    list.replaceChildren();
    for (const ds of datasets) {
      const item = document.createElement('div');
      item.className = 'server-dataset-item';
      item.innerHTML = `
        <span class="ds-name">📁 ${ds}</span>
        <span class="ds-info">Bấm để xem</span>
        <button class="btn sm del-btn" title="Xoá dataset này">🗑</button>
      `;
      item.querySelector('.del-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Xoá dataset "${ds}" khỏi server?`)) return;
        try {
          await deleteDataset(ds);
          await refreshServerDatasets();
        } catch (err) {
          alert('Lỗi xoá: ' + err.message);
        }
      });
      item.addEventListener('click', async () => {
        $('serverModal').classList.add('hidden');
        await loadServerDataset(ds);
      });
      list.appendChild(item);
    }
  } catch (err) {
    list.innerHTML = `<p style="color:var(--danger);padding:12px">Lỗi: ${err.message}</p>`;
  }
}

async function loadServerDataset(dataset) {
  const status = $('serverUploadStatus');
  status.className = 'server-upload-status';
  status.textContent = `Đang tải dataset "${dataset}"…`;
  status.classList.remove('hidden');
  openServerModal();
  try {
    const entries = await fetchEntries(dataset);
    status.classList.add('hidden');
    $('serverModal').classList.add('hidden');
    loadEntries(entries);
  } catch (err) {
    status.className = 'server-upload-status err';
    status.textContent = `✗ Lỗi: ${err.message}`;
  }
}

$('serverBtn').addEventListener('click', openServerModal);
$('serverModalClose').addEventListener('click', () => $('serverModal').classList.add('hidden'));
$('serverModal').addEventListener('click', (e) => {
  if (e.target === $('serverModal')) $('serverModal').classList.add('hidden');
});

// Kéo thả
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) $('dropOverlay').classList.remove('hidden');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; $('dropOverlay').classList.add('hidden'); }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropOverlay').classList.add('hidden');
  const entries = await entriesFromDrop(e.dataTransfer);
  if (entries.length) loadEntries(entries);
});

// ================================================================== thư viện

const io = new IntersectionObserver((items) => {
  for (const it of items) {
    if (!it.isIntersecting) continue;
    const img = it.target;
    img.src = img.dataset.src;
    io.unobserve(img);
  }
}, { rootMargin: '400px' });

function renderGallery() {
  const ds = state.dataset;
  const q = $('search').value.trim().toLowerCase();
  state.filtered = ds.ids.filter((g) => !q || g.id.toLowerCase().includes(q));
  const nModels = ds.ids.reduce((n, g) => n + g.models.length, 0);
  const nVideos = ds.ids.reduce((n, g) => n + g.videos.length, 0);
  const modeLabel = { folder1: 'thư mục cấp 1', folder2: 'thư mục cấp 2', name: 'tên file' }[ds.mode];
  $('stats').textContent = ds.ids.length
    ? `${ds.rootName} · ${ds.ids.length} ID · ${nModels} file 3D` + (nVideos ? ` · ${nVideos} video` : '') +
      ` · nhóm theo ${modeLabel}` +
      (q ? ` · đang lọc: ${state.filtered.length}` : '')
    : '';
  $('empty').classList.toggle('hidden', ds.ids.length > 0);

  const grid = $('grid');
  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const g of state.filtered) frag.appendChild(renderCard(g));
  grid.appendChild(frag);
}

function renderCard(g) {
  const card = document.createElement('div');
  card.className = 'card';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (g.cover) {
    const img = document.createElement('img');
    img.alt = g.id;
    img.dataset.src = urlOf(g.cover);
    io.observe(img);
    thumb.appendChild(img);
    thumb.addEventListener('click', () => openLightbox(g));
  } else if (g.videos[0]) {
    // Không có ảnh: lấy khung hình đầu của video làm ảnh bìa.
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.dataset.src = urlOf(g.videos[0]) + '#t=0.1';
    io.observe(v);
    thumb.appendChild(v);
  } else {
    thumb.innerHTML = '<span class="noimg">Không có ảnh</span>';
  }
  if (!g.cover && itemsOf(g)[0]) thumb.addEventListener('click', () => openModel(g, itemsOf(g)[0]));
  if (g.videos[0]) {
    const b = document.createElement('span');
    b.className = 'badge360';
    b.textContent = '▶ 360°';
    thumb.appendChild(b);
    attachPreview(thumb, g.videos[0]);
  }
  if (g.coverImages.length > 1) {
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = `${g.coverImages.length} ảnh`;
    thumb.appendChild(c);
  }

  const body = document.createElement('div');
  body.className = 'card-body';
  const title = document.createElement('div');
  title.className = 'card-id';
  title.textContent = g.id;
  title.title = g.id;
  const chips = document.createElement('div');
  chips.className = 'chips';
  for (const m of itemsOf(g)) {
    const chip = document.createElement('button');
    chip.className = m.kind === 'video' ? 'chip video' : 'chip';
    chip.title = m.path;
    chip.innerHTML = m.kind === 'video' ? `<b>▶ ${m.ext}</b>` : `<b>${m.ext}</b>`;
    chip.append(m.name);
    chip.addEventListener('click', () => openModel(g, m));
    chips.appendChild(chip);
  }
  if (!itemsOf(g).length) chips.innerHTML = '<span class="muted" style="font-size:12px">Không có file 3D / video</span>';
  body.append(title, chips);
  card.append(thumb, body);
  return card;
}

/** Rê chuột lên thẻ => phát video xoay 360° ngay trong thư viện. */
function attachPreview(thumb, entry) {
  let v = null;
  thumb.addEventListener('mouseenter', () => {
    v = document.createElement('video');
    v.className = 'preview';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.defaultPlaybackRate = v.playbackRate = +$('videoRate').value;
    v.src = urlOf(entry);
    thumb.appendChild(v);
    v.play().catch(() => { /* bị chặn hoặc không giải mã được */ });
  });
  thumb.addEventListener('mouseleave', () => {
    if (!v) return;
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
    v = null;
  });
}

$('search').addEventListener('input', () => state.dataset && renderGallery());
const applyCardSize = () => $('grid').style.setProperty('--card', $('cardSize').value + 'px');
$('cardSize').value = store.get('cardSize', 190);
applyCardSize();
$('cardSize').addEventListener('input', () => {
  applyCardSize();
  store.set('cardSize', +$('cardSize').value);
});

// Lightbox: xem tất cả ảnh của một ID, chọn ảnh chính diện.
let lbGroup = null;
let lbZoom = 1;
let lbPan = { x: 0, y: 0 };

function applyLbTransform() {
  $('lbMain').style.transform = `translate(${lbPan.x}px, ${lbPan.y}px) scale(${lbZoom})`;
  $('lbZoomLabel').textContent = `${Math.round(lbZoom * 100)}%`;
}

function setLightboxZoom(zoom, pivotX, pivotY) {
  const oldZoom = lbZoom;
  lbZoom = Math.min(5, Math.max(0.25, zoom));
  // Nếu có điểm pivot (zoom theo chuột): điều chỉnh pan để giữ điểm đó cố định.
  if (pivotX !== undefined && oldZoom !== lbZoom) {
    const scale = lbZoom / oldZoom;
    lbPan.x = pivotX + (lbPan.x - pivotX) * scale;
    lbPan.y = pivotY + (lbPan.y - pivotY) * scale;
  }
  // Khi zoom = 1 → reset pan về gốc.
  if (lbZoom === 1) { lbPan.x = 0; lbPan.y = 0; }
  applyLbTransform();
}

function openLightbox(g) {
  lbGroup = g;
  $('lbTitle').textContent = g.id;
  $('lbMain').src = g.cover ? urlOf(g.cover) : '';
  lbPan = { x: 0, y: 0 };
  setLightboxZoom(1);
  const thumbs = $('lbThumbs');
  thumbs.replaceChildren();
  for (const im of g.coverImages) {
    const fig = document.createElement('figure');
    fig.className = im === g.cover ? 'cover' : '';
    fig.innerHTML = `<img loading="lazy" alt=""><figcaption></figcaption>`;
    fig.querySelector('img').src = urlOf(im);
    fig.querySelector('figcaption').textContent = im.name;
    fig.title = im.path;
    fig.addEventListener('mouseenter', () => {
      $('lbMain').src = urlOf(im);
      lbPan = { x: 0, y: 0 };
      setLightboxZoom(1);
    });
    fig.addEventListener('click', () => {
      g.cover = im;
      saveCoverOverride(state.dataset.rootName, g.id, im.path);
      thumbs.querySelectorAll('figure').forEach((f) => f.classList.remove('cover'));
      fig.classList.add('cover');
      $('lbMain').src = urlOf(im);
      lbPan = { x: 0, y: 0 };
      setLightboxZoom(1);
    });
    thumbs.appendChild(fig);
  }
  $('lightbox').classList.remove('hidden');
}
function closeLightbox() {
  $('lightbox').classList.add('hidden');
  if (lbGroup) renderGallery(); // cập nhật ảnh bìa nếu vừa đổi
  lbGroup = null;
}
$('lbClose').addEventListener('click', closeLightbox);
$('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
$('lbZoomIn').addEventListener('click', () => setLightboxZoom(lbZoom + 0.25));
$('lbZoomOut').addEventListener('click', () => setLightboxZoom(lbZoom - 0.25));
$('lbZoomReset').addEventListener('click', () => { lbPan = { x: 0, y: 0 }; setLightboxZoom(1); });
$('lbImageViewport').addEventListener('wheel', (e) => {
  if ($('lightbox').classList.contains('hidden')) return;
  e.preventDefault();
  // Zoom theo vị trí con trỏ chuột (pivot).
  const vp = $('lbImageViewport');
  const rect = vp.getBoundingClientRect();
  const pivotX = e.clientX - rect.left - rect.width / 2;
  const pivotY = e.clientY - rect.top - rect.height / 2;
  setLightboxZoom(lbZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), pivotX, pivotY);
}, { passive: false });

// Pan (kéo ảnh) bằng chuột.
{
  const vp = $('lbImageViewport');
  let dragging = false, startX = 0, startY = 0, startPanX = 0, startPanY = 0;

  vp.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    startPanX = lbPan.x; startPanY = lbPan.y;
    vp.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    lbPan.x = startPanX + (e.clientX - startX);
    lbPan.y = startPanY + (e.clientY - startY);
    applyLbTransform();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    vp.classList.remove('dragging');
  });

  // Pan bằng cảm ứng (touch).
  let touch0 = null;
  vp.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touch0 = e.touches[0];
    startPanX = lbPan.x; startPanY = lbPan.y;
    e.preventDefault();
  }, { passive: false });
  vp.addEventListener('touchmove', (e) => {
    if (!touch0 || e.touches.length !== 1) return;
    lbPan.x = startPanX + (e.touches[0].clientX - touch0.clientX);
    lbPan.y = startPanY + (e.touches[0].clientY - touch0.clientY);
    applyLbTransform();
    e.preventDefault();
  }, { passive: false });
  vp.addEventListener('touchend', () => { touch0 = null; });
}

// ================================================================== trình xem

function showGallery() {
  $('viewerView').classList.add('hidden');
  $('galleryView').classList.remove('hidden');
  stopVideo();
  viewer?.clear();
  state.current = null;
}

function ensureViewer() {
  if (viewer) return viewer;
  viewer = new Viewer($('canvasWrap'));
  // Khôi phục cài đặt đã lưu.
  const s = store.get('settings', {});
  for (const [id, key] of [['shading', 'shading'], ['wireframe', 'wireframe'], ['doubleSide', 'doubleSide'], ['pointSize', 'pointSize'], ['light', 'light']]) {
    if (s[key] === undefined) continue;
    const el = $(id);
    if (el.type === 'checkbox') el.checked = s[key];
    else el.value = s[key];
  }
  for (const [id, key] of [['bgColor', 'bg'], ['showGrid', 'grid'], ['showAxes', 'axes'], ['showInset', 'inset'], ['fov', 'fov'], ['keepOrient', 'keepOrient'], ['autoRotate', 'autoRotate'], ['rotateSpeed', 'rotateSpeed']]) {
    if (s[key] === undefined) continue;
    const el = $(id);
    if (el.type === 'checkbox') el.checked = s[key];
    else el.value = s[key];
  }
  syncControls();
  return viewer;
}

function syncControls() {
  viewer.settings.shading = $('shading').value;
  viewer.settings.wireframe = $('wireframe').checked;
  viewer.settings.doubleSide = $('doubleSide').checked;
  viewer.settings.pointSize = +$('pointSize').value;
  viewer.settings.light = +$('light').value;
  viewer.applySettings();
  viewer.setBackground($('bgColor').value);
  viewer.setGrid($('showGrid').checked);
  viewer.setAxes($('showAxes').checked);
  viewer.setFov(+$('fov').value);
  viewer.setAutoRotate($('autoRotate').checked);
  const rpm = +$('rotateSpeed').value;
  viewer.setRotateSpeed(rpm);
  $('rotateSpeedLabel').textContent = `${(60 / rpm).toFixed(1)} s/vòng`;
  $('canvasWrap').style.setProperty('--video-bg', $('bgColor').value);
  $('inset').classList.toggle('hidden', !$('showInset').checked);
}

function saveSettings() {
  store.set('settings', {
    shading: $('shading').value,
    wireframe: $('wireframe').checked,
    doubleSide: $('doubleSide').checked,
    pointSize: +$('pointSize').value,
    light: +$('light').value,
    bg: $('bgColor').value,
    grid: $('showGrid').checked,
    axes: $('showAxes').checked,
    inset: $('showInset').checked,
    fov: +$('fov').value,
    keepOrient: $('keepOrient').checked,
    autoRotate: $('autoRotate').checked,
    rotateSpeed: +$('rotateSpeed').value,
  });
}

for (const id of ['shading', 'wireframe', 'doubleSide', 'pointSize', 'light', 'bgColor', 'showGrid', 'showAxes', 'showInset', 'fov', 'autoRotate', 'rotateSpeed', 'keepOrient']) {
  $(id).addEventListener('input', () => {
    if (!viewer) return;
    syncControls();
    saveSettings();
  });
}

async function openModel(group, model) {
  ensureViewer();
  $('galleryView').classList.add('hidden');
  $('viewerView').classList.remove('hidden');
  viewer.resize();
  state.current = { group, model };

  $('viewerTitle').textContent = group.id;
  $('inset').src = group.cover ? urlOf(group.cover) : '';
  renderFileTabs();
  renderTextureOptions(group);

  const isVideo = model.kind === 'video';
  document.querySelector('.viewer-body').classList.toggle('video-mode', isVideo);
  $('error').classList.add('hidden');
  $('info').replaceChildren();
  if (isVideo) {
    // Huỷ mô hình đang tải/đang hiển thị để giải phóng bộ nhớ.
    viewer.loadToken++;
    viewer.clear();
    openVideo(model);
    return;
  }
  stopVideo();

  // Hướng: dùng hướng đã lưu nếu bật "giữ hướng".
  viewer.setOrientation($('keepOrient').checked ? store.get('orientation', [0, 0, 0, 1]) : [0, 0, 0, 1]);

  $('loading').classList.remove('hidden');
  try {
    const info = await viewer.load(model, group.files);
    if (!info || state.current?.model !== model) return;
    renderInfo(info);
  } catch (err) {
    if (state.current?.model !== model) return;
    console.error(err);
    $('error').textContent = `Không mở được ${model.name}\n${err.message || err}`;
    $('error').classList.remove('hidden');
  } finally {
    if (state.current?.model === model) $('loading').classList.add('hidden');
  }
}

function renderFileTabs() {
  const { group, model } = state.current;
  const tabs = $('fileTabs');
  tabs.replaceChildren();
  for (const m of itemsOf(group)) {
    const b = document.createElement('button');
    b.className = 'btn sm' + (m === model ? ' active' : '');
    b.textContent = m.kind === 'video' ? '▶ ' + m.name : m.name;
    b.title = m.path;
    b.addEventListener('click', () => openModel(group, m));
    tabs.appendChild(b);
  }
}

function renderTextureOptions(group) {
  const sel = $('textureSelect');
  sel.replaceChildren(new Option('(theo file)', ''));
  group.images.forEach((im, i) => sel.appendChild(new Option(im.name, String(i))));
}
$('textureSelect').addEventListener('change', () => {
  if (!viewer || !state.current) return;
  const i = $('textureSelect').value;
  viewer.setOverrideTexture(i === '' ? null : state.current.group.images[+i].file);
});

function renderInfo(info) {
  const rows = [
    ['File', info.file],
    ['Loại', info.type],
    info.size && ['Kích thước', info.size],
    info.resolution && ['Độ phân giải', info.resolution],
    info.duration && ['Thời lượng', info.duration],
    info.vertices && ['Đỉnh', info.vertices.toLocaleString()],
    info.faces && ['Mặt', info.faces.toLocaleString()],
    info.points && ['Điểm', info.points.toLocaleString()],
    info.splats && ['Splat', info.splats.toLocaleString()],
    info.mtl && ['MTL', info.mtl],
    info.autoTexture && ['Texture', info.autoTexture],
    info.uv !== undefined && !info.splats && ['UV', info.uv ? 'có' : 'không'],
    info.missing && ['Thiếu', info.missing.join(', ')],
  ].filter(Boolean);
  $('info').replaceChildren(
    ...rows.map(([k, v]) => {
      const d = document.createElement('div');
      d.innerHTML = `${k}: <b></b>`;
      d.querySelector('b').textContent = v;
      return d;
    }),
  );
}

function stepId(delta) {
  if (!state.current) return;
  const list = state.filtered.filter((g) => itemsOf(g).length);
  const i = list.indexOf(state.current.group);
  const next = list[(i + delta + list.length) % list.length];
  if (!next) return;
  // Giữ cùng loại file (và cùng 3D/video) nếu ID kế tiếp có.
  const { ext, kind } = state.current.model;
  const items = itemsOf(next);
  openModel(next, items.find((m) => m.ext === ext) || items.find((m) => m.kind === kind) || items[0]);
}

$('backBtn').addEventListener('click', showGallery);
$('prevId').addEventListener('click', () => stepId(-1));
$('nextId').addEventListener('click', () => stepId(1));

// Hướng vật thể
function persistOrientation() {
  if ($('keepOrient').checked) store.set('orientation', viewer.getOrientation());
}
document.querySelectorAll('[data-rot]').forEach((b) =>
  b.addEventListener('click', () => {
    const [axis, sign] = b.dataset.rot.split(',');
    viewer.rotate(axis, +sign * +$('rotStep').value);
    persistOrientation();
  }),
);
$('orientPreset').addEventListener('change', () => {
  const q = ORIENT_PRESETS[$('orientPreset').value];
  if (q) {
    viewer.setOrientation(q);
    viewer.frame('front');
    persistOrientation();
  }
  $('orientPreset').value = '';
});
$('resetOrient').addEventListener('click', () => {
  viewer.setOrientation(ORIENT_PRESETS.identity);
  viewer.frame('front');
  persistOrientation();
});
$('keepOrient').addEventListener('change', persistOrientation);

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => viewer.frame(b.dataset.view)),
);

$('screenshot').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = state.current?.model.kind === 'video' ? videoFrame() : viewer.screenshot();
  const { group, model } = state.current || {};
  a.download = `${group?.id || 'view'}_${model?.name || ''}.png`.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
});

// ================================================================== video 360°

const video = $('video');
let seeking = false;

function openVideo(entry) {
  $('loading').classList.remove('hidden');
  video.classList.remove('hidden');
  video.loop = $('videoLoop').checked;
  video.onloadedmetadata = () => {
    if (state.current?.model !== entry) return;
    $('loading').classList.add('hidden');
    video.playbackRate = +$('videoRate').value;
    renderInfo({
      file: entry.path,
      type: `Video 360° (${entry.ext.toUpperCase()})`,
      resolution: `${video.videoWidth} × ${video.videoHeight}`,
      duration: fmtTime(video.duration),
    });
    video.play().catch(() => { /* autoplay bị chặn: người dùng bấm phát */ });
  };
  video.onerror = () => {
    if (state.current?.model !== entry) return;
    $('loading').classList.add('hidden');
    $('error').textContent = `Không phát được ${entry.name}\nTrình duyệt không hỗ trợ codec của video này (thử MP4 H.264 hoặc WEBM).`;
    $('error').classList.remove('hidden');
  };
  video.src = urlOf(entry);
}

function stopVideo() {
  if (!video.getAttribute('src')) return;
  video.pause();
  video.onloadedmetadata = video.onerror = null;
  video.removeAttribute('src');
  video.load();
  video.classList.add('hidden');
}

function videoFrame() {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  return c.toDataURL('image/png');
}

const fmtTime = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}` : '?');

function setVideoRate(rate) {
  $('videoRate').value = String(rate);
  video.playbackRate = rate;
  store.set('videoRate', rate);
}
$('videoRate').value = String(store.get('videoRate', 1));
$('videoRate').addEventListener('change', () => setVideoRate(+$('videoRate').value));
$('videoLoop').addEventListener('change', () => { video.loop = $('videoLoop').checked; });
$('videoPlay').addEventListener('click', () => (video.paused ? video.play() : video.pause()));
video.addEventListener('timeupdate', () => {
  if (!seeking && video.duration) $('videoSeek').value = video.currentTime / video.duration;
});
$('videoSeek').addEventListener('input', () => {
  seeking = true;
  if (video.duration) video.currentTime = +$('videoSeek').value * video.duration;
});
$('videoSeek').addEventListener('change', () => { seeking = false; });

function stepFrame(dir) {
  video.pause();
  video.currentTime = Math.min(Math.max(video.currentTime + dir / 30, 0), video.duration || 0);
}
function stepRate(dir) {
  const rates = [...$('videoRate').options].map((o) => +o.value);
  const i = rates.indexOf(+$('videoRate').value);
  setVideoRate(rates[Math.min(Math.max(i + dir, 0), rates.length - 1)]);
}

// Phím tắt
const VIEW_KEYS = { 1: 'front', 2: 'back', 3: 'left', 4: 'right', 5: 'top', 6: 'bottom' };
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type=search], input[type=text]')) return;
  if (e.key === 'Escape') {
    if (!$('lightbox').classList.contains('hidden')) closeLightbox();
    else if (state.current) showGallery();
    return;
  }
  if (!state.current) return;
  if (e.key === 'PageDown') return stepId(1);
  if (e.key === 'PageUp') return stepId(-1);
  if (state.current.model.kind === 'video') {
    // Video đang được focus tự xử lý Space/mũi tên.
    if (e.target === video || e.target.matches('select, input')) return;
    if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    else if (e.key === 'ArrowLeft') stepFrame(-1);
    else if (e.key === 'ArrowRight') stepFrame(1);
    else if (e.key === '[') stepRate(-1);
    else if (e.key === ']') stepRate(1);
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    $('autoRotate').checked = !$('autoRotate').checked;
    $('autoRotate').dispatchEvent(new Event('input'));
  } else if (e.key === 'f' || e.key === 'F') viewer.frame('front');
  else if (VIEW_KEYS[e.key]) viewer.frame(VIEW_KEYS[e.key]);
});


// Tự động kiểm tra và tải dữ liệu tĩnh (GitHub Pages) hoặc backend server
async function initAutoLoad() {
  try {
    const staticEntries = await fetchStaticManifest();
    if (staticEntries && staticEntries.length > 0) {
      loadEntries(staticEntries);
      return;
    }
  } catch (e) {
    console.debug('No static manifest found:', e);
  }

  try {
    const datasets = await fetchDatasets();
    if (datasets && datasets.length > 0) {
      loadServerDataset(datasets[0]);
    }
  } catch {
    serverBtn?.classList.add('hidden');
    uploadFolderInput?.parentElement?.classList.add('hidden');
  }
}
initAutoLoad();
