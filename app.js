import { buildDataset, entriesFromDrop, entriesFromFileList, saveCoverOverride } from './dataset.js';
import { Viewer } from './viewer.js';
import { fetchStaticManifest } from './server-api.js';

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
  currentTask: '3d', // '3d' hoặc 'video'
};
let viewer = null;
let viewerB = null;

function ensureViewerB() {
  if (viewerB) return viewerB;
  viewerB = new Viewer($('canvasWrapB'));
  viewerB.onAngleChange = (deg) => {
    if (state.currentTask === 'video') {
      updateTimelineAngle(deg);
      if (viewer && (viewer.object || viewer.isVideo)) {
        viewer.setYawDeg(deg);
      }
    }
  };
  return viewerB;
}
const imageUrls = new Map();

/** Trả về URL để hiển thị/tải một entry (hỗ trợ cả file local lẫn server). */
const urlOf = (entry) => {
  if (!entry) return '';
  if (entry.isServer) return entry.serverUrl;
  const file = entry.file ?? entry;
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
  const ds = state.dataset;
  const only = ds.ids.length === 1 ? itemsOf(ds.ids[0]) : [];
  if (only.length === 1) openModel(ds.ids[0], only[0]);
}

/** Các mục xem được của một ID: file 3D và video 360°. */
const itemsOf = (g) => [...(g.models || []), ...(g.videos || [])];

function rebuild() {
  state.dataset = buildDataset(state.entries, 'auto');
  renderGallery();
}

// Hỗ trợ kéo thả file/thư mục an toàn
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
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


// ================================================================== 2 Task Navigation

function setTask(task) {
  state.currentTask = task;
  store.set('currentTask', task);
  const is3D = task === '3d';

  $('taskTab3D').classList.toggle('active', is3D);
  $('taskTab3D').setAttribute('aria-selected', String(is3D));
  $('taskTabVideo').classList.toggle('active', !is3D);
  $('taskTabVideo').setAttribute('aria-selected', String(!is3D));

  // Cập nhật giao diện thư viện hoặc trình xem
  if (!$('viewerView').classList.contains('hidden') && state.current) {
    updateViewerForTask();
  } else {
    renderGallery();
  }
}

$('taskTab3D').addEventListener('click', () => setTask('3d'));
$('taskTabVideo').addEventListener('click', () => setTask('video'));
state.currentTask = store.get('currentTask', '3d');
$('taskTab3D').classList.toggle('active', state.currentTask === '3d');
$('taskTabVideo').classList.toggle('active', state.currentTask === 'video');

function formatAngleBadge(deg) {
  let note = '';
  if (deg >= 350 || deg <= 10) note = ' · Chính diện';
  else if (deg >= 35 && deg <= 55) note = ' · Bán diện 45°';
  else if (deg >= 80 && deg <= 100) note = ' · Nghiêng 90°';
  else if (deg >= 170 && deg <= 190) note = ' · Sau gáy 180°';
  else if (deg >= 260 && deg <= 280) note = ' · Nghiêng 270°';
  else if (deg >= 305 && deg <= 325) note = ' · Bán diện 315°';
  return `${deg}°${note}`;
}

function updateTimelineAngle(deg) {
  const slider = $('tlScrubSlider');
  if (slider) {
    slider.value = deg;
    slider.title = `Góc quay: ${formatAngleBadge(deg)}`;
  }
  const label = $('tlAngleLabel');
  if (label) label.textContent = formatAngleBadge(deg);
}

function updateViewerForTask() {
  if (!viewer || !state.current) return;
  const isVideoTask = state.currentTask === 'video';
  const viewerBody = document.querySelector('.viewer-body');
  const group = state.current.group;

  viewerBody.classList.toggle('task2-mode', isVideoTask);
  $('task2ComparePane').classList.toggle('hidden', !isVideoTask);
  $('task2ModelTag').classList.toggle('hidden', !isVideoTask);
  $('timelineBar').classList.toggle('hidden', !isVideoTask);
  $('task2CompareSelects').classList.toggle('hidden', !isVideoTask);

  if (isVideoTask) {
    resetTask2Zoom();
    // Nạp ảnh gốc đối chiếu vào cột bên trái
    const coverEntry = group.cover;
    $('task2CompareImg').src = coverEntry ? urlOf(coverEntry) : '';

    // Cập nhật tên nhãn Model A
    const mNameA = state.current.model.modelName || (state.current.model.kind === 'video' ? 'Video 360°' : 'Model A');
    $('modelTagAName').textContent = mNameA;

    // Thiết lập danh sách chọn Model A và Model B
    setupTask2Selects(group);

    // Hệ quy chiếu chuẩn hóa 360°:
    viewer.setGrid(false);
    viewer.setAxes(false);
    if (viewer.setRotateDirection) viewer.setRotateDirection(1);
    const speed = $('tlSpeedSelect') ? +$('tlSpeedSelect').value : 6;
    viewer.setRotateSpeed(speed);
    viewer.setAutoRotate(true);
    $('tlPlayBtn').textContent = '⏸';
    if (!viewer.isVideo && viewer.object) {
      viewer.frame('front');
    }
    const curYaw = viewer.getCurrentYawDeg ? viewer.getCurrentYawDeg() : 0;
    updateTimelineAngle(curYaw);
  } else {
    // Trở về Task 1: Khảo sát 3D tự do
    viewerBody.classList.remove('has-model-b');
    $('canvasWrapB').classList.add('hidden');
    viewerB?.clear();
    if (!viewer.isVideo) {
      syncControls();
    }
  }
  viewer.resize();
  viewerB?.resize();
}

let isSyncingSelects = false;
function setupTask2Selects(group) {
  if (isSyncingSelects) return;
  isSyncingSelects = true;

  const selA = $('task2SelectA');
  const selB = $('task2SelectB');
  const currentModelA = state.current.model;
  const allOutputs = itemsOf(group);
  
  selA.replaceChildren();
  for (const m of allOutputs) {
    const icon = m.kind === 'video' ? '🎬' : '🧊';
    const opt = new Option(`${icon} ${m.modelName || m.name}`, m.path);
    if (m === currentModelA) opt.selected = true;
    selA.appendChild(opt);
  }

  // Model B: có tuỳ chọn (Không so sánh)
  selB.replaceChildren(new Option('-- Không so sánh --', ''));
  for (const m of allOutputs) {
    if (m !== currentModelA) {
      const icon = m.kind === 'video' ? '🎬' : '🧊';
      selB.appendChild(new Option(`${icon} ${m.modelName || m.name}`, m.path));
    }
  }

  // Nếu có từ 2 model trở lên và Model B chưa chọn, tự chọn model thứ 2
  if (allOutputs.length >= 2 && !state.currentModelBPath) {
    const secondModel = allOutputs.find(m => m !== currentModelA);
    if (secondModel) {
      state.currentModelBPath = secondModel.path;
      selB.value = secondModel.path;
    }
  }

  if (state.currentModelBPath && allOutputs.some(m => m.path === state.currentModelBPath)) {
    selB.value = state.currentModelBPath;
  } else {
    selB.value = '';
    state.currentModelBPath = '';
  }

  loadModelB(group, selB.value);
  isSyncingSelects = false;
}

$('task2SelectA').addEventListener('change', () => {
  const path = $('task2SelectA').value;
  const m = itemsOf(state.current.group).find(x => x.path === path);
  if (m) openModel(state.current.group, m);
});

$('task2SelectB').addEventListener('change', () => {
  state.currentModelBPath = $('task2SelectB').value;
  loadModelB(state.current.group, state.currentModelBPath);
});

// ==================== Zoom & Pan cho Ảnh 2D đối chiếu trong Task 2 ====================
let task2Zoom = 1;
let task2Pan = { x: 0, y: 0 };

function applyTask2Transform() {
  const img = $('task2CompareImg');
  if (img) {
    img.style.transform = `translate(${task2Pan.x}px, ${task2Pan.y}px) scale(${task2Zoom})`;
  }
  const resetBtn = $('task2ZoomReset');
  if (resetBtn) {
    resetBtn.textContent = task2Zoom === 1 ? '100%' : `${Math.round(task2Zoom * 100)}%`;
  }
}

function setTask2Zoom(zoom, pivotX, pivotY) {
  const oldZoom = task2Zoom;
  task2Zoom = Math.min(6, Math.max(0.4, zoom));
  if (pivotX !== undefined && oldZoom !== task2Zoom) {
    const scale = task2Zoom / oldZoom;
    task2Pan.x = pivotX + (task2Pan.x - pivotX) * scale;
    task2Pan.y = pivotY + (task2Pan.y - pivotY) * scale;
  }
  if (task2Zoom === 1) {
    task2Pan.x = 0;
    task2Pan.y = 0;
  }
  applyTask2Transform();
}

function resetTask2Zoom() {
  task2Zoom = 1;
  task2Pan = { x: 0, y: 0 };
  applyTask2Transform();
}

$('task2ZoomIn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  setTask2Zoom(task2Zoom + 0.25);
});
$('task2ZoomOut')?.addEventListener('click', (e) => {
  e.stopPropagation();
  setTask2Zoom(task2Zoom - 0.25);
});
$('task2ZoomReset')?.addEventListener('click', (e) => {
  e.stopPropagation();
  resetTask2Zoom();
});

const pane2D = $('task2ComparePane');
if (pane2D) {
  // Zoom bằng con lăn chuột (wheel) với pivot tại vị trí chuột
  pane2D.addEventListener('wheel', (e) => {
    if (pane2D.classList.contains('hidden')) return;
    e.preventDefault();
    const rect = pane2D.getBoundingClientRect();
    const pivotX = e.clientX - rect.left - rect.width / 2;
    const pivotY = e.clientY - rect.top - rect.height / 2;
    setTask2Zoom(task2Zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), pivotX, pivotY);
  }, { passive: false });

  // Double-click để đặt lại 100%
  pane2D.addEventListener('dblclick', (e) => {
    if (e.target.closest('.task2-zoom-controls')) return;
    resetTask2Zoom();
  });

  // Kéo thả (Pan) bằng chuột
  let dragging = false, startX = 0, startY = 0, startPanX = 0, startPanY = 0;
  pane2D.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.task2-zoom-controls')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startPanX = task2Pan.x;
    startPanY = task2Pan.y;
    pane2D.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    task2Pan.x = startPanX + (e.clientX - startX);
    task2Pan.y = startPanY + (e.clientY - startY);
    applyTask2Transform();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    pane2D.classList.remove('dragging');
  });

  // Hỗ trợ cảm ứng (touch)
  let touch0 = null;
  pane2D.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('.task2-zoom-controls')) return;
    touch0 = e.touches[0];
    startPanX = task2Pan.x;
    startPanY = task2Pan.y;
  }, { passive: false });
  pane2D.addEventListener('touchmove', (e) => {
    if (!touch0 || e.touches.length !== 1) return;
    task2Pan.x = startPanX + (e.touches[0].clientX - touch0.clientX);
    task2Pan.y = startPanY + (e.touches[0].clientY - touch0.clientY);
    applyTask2Transform();
    e.preventDefault();
  }, { passive: false });
  pane2D.addEventListener('touchend', () => { touch0 = null; });
}

async function loadModelB(group, modelPath) {
  const wrapB = $('canvasWrapB');
  const viewerBody = document.querySelector('.viewer-body');
  if (!modelPath) {
    wrapB.classList.add('hidden');
    viewerBody?.classList.remove('has-model-b');
    viewerB?.clear();
    viewer.resize();
    return;
  }

  const modelB = itemsOf(group).find(m => m.path === modelPath);
  if (!modelB) {
    wrapB.classList.add('hidden');
    viewerBody?.classList.remove('has-model-b');
    viewerB?.clear();
    viewer.resize();
    return;
  }

  wrapB.classList.remove('hidden');
  viewerBody?.classList.add('has-model-b');
  $('modelTagBName').textContent = modelB.modelName || (modelB.kind === 'video' ? 'Video 360°' : 'Model B');
  const vb = ensureViewerB();
  vb.resize();
  viewer.resize();

  $('loadingB').classList.remove('hidden');
  $('errorB').classList.add('hidden');
  try {
    await vb.load(modelB, group.files);
    vb.setGrid(false);
    vb.setAxes(false);
    vb.setRotateDirection(viewer.spin.dir || 1);
    vb.setRotateSpeed(viewer.spin.rpm || 6);
    vb.setAutoRotate(viewer.spin.on);
    if (!vb.isVideo && vb.object) vb.frame('front');
    vb.setYawDeg(viewer.getCurrentYawDeg());
  } catch (err) {
    console.error(err);
    $('errorB').textContent = `Lỗi nạp Model B: ${err.message || err}`;
    $('errorB').classList.remove('hidden');
  } finally {
    $('loadingB').classList.add('hidden');
  }
}

// Điều khiển Timeline 360° (Scrub Bar) cho Task 2 (Đồng bộ cả Model A & Model B)
function toggleTurntablePlay() {
  if (!viewer) return;
  const isSpinning = viewer.spin.on;
  viewer.setAutoRotate(!isSpinning);
  viewerB?.setAutoRotate(!isSpinning);
  $('tlPlayBtn').textContent = isSpinning ? '▶' : '⏸';
}

$('tlPlayBtn').addEventListener('click', toggleTurntablePlay);

// Kéo thanh trượt tua góc quay
$('tlScrubSlider').addEventListener('input', (e) => {
  if (!viewer) return;
  viewer.setAutoRotate(false);
  viewerB?.setAutoRotate(false);
  $('tlPlayBtn').textContent = '▶';
  const deg = +e.target.value;
  viewer.setYawDeg(deg);
  viewerB?.setYawDeg(deg);
  updateTimelineAngle(deg);
});

$('tlRevBtn').addEventListener('click', () => {
  if (!viewer) return;
  const newDir = (viewer.spin.dir || 1) * -1;
  viewer.setRotateDirection(newDir);
  viewerB?.setRotateDirection(newDir);
});

$('tlSpeedSelect').addEventListener('change', () => {
  if (!viewer) return;
  const sp = +$('tlSpeedSelect').value;
  viewer.setRotateSpeed(sp);
  viewerB?.setRotateSpeed(sp);
});

$('tlExportBtn').addEventListener('click', async () => {
  if (!viewer) return;
  const btn = $('tlExportBtn');
  const status = $('tlRecordStatus');
  btn.disabled = true;
  status.classList.remove('hidden');
  status.textContent = 'Đang quay 360° và ghi hình… 0%';

  try {
    const duration = 60 / (+$('tlSpeedSelect').value);
    const { blob, ext } = await viewer.recordTurntable(duration, (p) => {
      status.textContent = `Đang quay 360° và ghi hình… ${Math.round(p * 100)}%`;
    });
    status.textContent = '✓ Ghi hình hoàn tất! Đang tải file video…';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.current?.group?.id || 'turntable'}_360.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    console.error(err);
    status.textContent = '✗ Lỗi: Trình duyệt không hỗ trợ MediaRecorder';
  } finally {
    btn.disabled = false;
    setTimeout(() => status.classList.add('hidden'), 5000);
  }
});

function updateModelFilterOptions() {
  const sel = $('modelFilterSelect');
  if (!sel || !state.dataset) return;
  const cur = sel.value;
  const models = state.dataset.models || [];
  sel.replaceChildren(new Option('Tất cả Model', ''));
  for (const m of models) {
    sel.appendChild(new Option(`Model: ${m}`, m));
  }
  if (models.includes(cur)) sel.value = cur;
}

function renderGallery() {
  const ds = state.dataset;
  updateModelFilterOptions();
  const q = $('search').value.trim().toLowerCase();
  const filterModel = $('modelFilterSelect')?.value || '';
  state.filtered = ds.ids.filter((g) => {
    if (q && !g.id.toLowerCase().includes(q)) return false;
    if (filterModel && !itemsOf(g).some((m) => m.modelName === filterModel)) return false;
    return true;
  });
  const nModels = ds.ids.reduce((n, g) => n + g.models.length, 0);
  const nVideos = ds.ids.reduce((n, g) => n + g.videos.length, 0);
  const taskLabel = state.currentTask === '3d'
    ? 'Task 1: Mô hình 3D tương tác'
    : 'Task 2: Video 360° (Hệ quy chiếu chuẩn)';
  const modelInfo = ds.models?.length ? ` · ${ds.models.length} model: [${ds.models.join(', ')}]` : '';
  $('stats').textContent = ds.ids.length
    ? `${ds.rootName} · ${ds.ids.length} đối tượng${modelInfo} · ${taskLabel}` +
      (q || filterModel ? ` · đang lọc: ${state.filtered.length}` : '')
    : '';
  $('empty').classList.toggle('hidden', ds.ids.length > 0);

  const grid = $('grid');
  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const g of state.filtered) frag.appendChild(renderCard(g));
  grid.appendChild(frag);
}

$('modelFilterSelect')?.addEventListener('change', () => {
  renderGallery();
});

function renderCard(g) {
  const card = document.createElement('div');
  card.className = 'card';
  const isVideoTask = state.currentTask === 'video';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (g.cover) {
    const img = document.createElement('img');
    img.alt = g.id;
    img.dataset.src = urlOf(g.cover);
    io.observe(img);
    thumb.appendChild(img);
    // Trong Task 3D: bấm thumb mở phóng to/kéo ảnh lightbox
    // Trong Task Video: bấm thumb mở thẳng chế độ Video 360° chuẩn hóa
    if (isVideoTask) {
      thumb.addEventListener('click', () => itemsOf(g)[0] && openModel(g, itemsOf(g)[0]));
    } else {
      thumb.addEventListener('click', () => openLightbox(g));
    }
  } else if (g.videos[0]) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.dataset.src = urlOf(g.videos[0]) + '#t=0.1';
    io.observe(v);
    thumb.appendChild(v);
    thumb.addEventListener('click', () => openModel(g, g.videos[0]));
  } else {
    thumb.innerHTML = '<span class="noimg">Không có ảnh</span>';
    if (itemsOf(g)[0]) thumb.addEventListener('click', () => openModel(g, itemsOf(g)[0]));
  }

  // Huy hiệu góc ảnh (chỉ hiển thị ở Task 1 nếu có nhiều ảnh đại diện)
  if (!isVideoTask && g.coverImages.length > 1) {
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = `${g.coverImages.length} ảnh`;
    thumb.appendChild(c);
  }

  if (g.videos[0]) {
    attachPreview(thumb, g.videos[0]);
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
    const tag = m.modelName || m.ext;
    chip.innerHTML = m.kind === 'video' ? `<b>▶ ${m.ext}</b>` : `<b>${tag}</b>`;
    chip.append(` ${m.name}`);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      openModel(g, m);
    });
    chips.appendChild(chip);
  }

  if (!itemsOf(g).length) chips.innerHTML = '<span class="muted" style="font-size:12px">Chưa có dữ liệu</span>';
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
    v.defaultPlaybackRate = v.playbackRate = 1;
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
  viewer?.clear();
  viewerB?.clear();
  $('canvasWrapB').classList.add('hidden');
  document.querySelector('.viewer-body')?.classList.remove('has-model-b');
  state.current = null;
}

function ensureViewer() {
  if (viewer) return viewer;
  viewer = new Viewer($('canvasWrap'));
  viewer.onAngleChange = (deg) => {
    if (state.currentTask === 'video') {
      updateTimelineAngle(deg);
      if (viewerB && (viewerB.object || viewerB.isVideo)) {
        viewerB.setYawDeg(deg);
      }
    }
  };
  // Khôi phục cài đặt đã lưu.
  const s = store.get('settings', {});
  const keys = [
    ['shading', 'shading'], ['wireframe', 'wireframe'], ['doubleSide', 'doubleSide'],
    ['pointSize', 'pointSize'], ['light', 'light'], ['bgColor', 'bg'],
    ['showGrid', 'grid'], ['showAxes', 'axes'], ['fov', 'fov'],
    ['autoRotate', 'autoRotate'], ['rotateSpeed', 'rotateSpeed']
  ];
  for (const [id, key] of keys) {
    if (s[key] === undefined) continue;
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = s[key];
    else el.value = s[key];
  }
  syncControls();
  return viewer;
}

function syncControls() {
  if (!viewer) return;
  if ($('shading')) viewer.settings.shading = $('shading').value;
  if ($('wireframe')) viewer.settings.wireframe = $('wireframe').checked;
  if ($('doubleSide')) viewer.settings.doubleSide = $('doubleSide').checked;
  if ($('pointSize')) viewer.settings.pointSize = +$('pointSize').value;
  if ($('light')) viewer.settings.light = +$('light').value;
  viewer.applySettings();
  if ($('bgColor')) viewer.setBackground($('bgColor').value);
  if ($('showGrid')) viewer.setGrid($('showGrid').checked);
  if ($('showAxes')) viewer.setAxes($('showAxes').checked);
  if ($('fov')) viewer.setFov(+$('fov').value);
  if ($('autoRotate')) viewer.setAutoRotate($('autoRotate').checked);
  if ($('rotateSpeed')) {
    const rpm = +$('rotateSpeed').value;
    viewer.setRotateSpeed(rpm);
    if ($('rotateSpeedLabel')) $('rotateSpeedLabel').textContent = `${(60 / rpm).toFixed(1)} s/vòng`;
  }
}

function saveSettings() {
  store.set('settings', {
    shading: $('shading')?.value || 'original',
    wireframe: $('wireframe')?.checked ?? false,
    doubleSide: $('doubleSide')?.checked ?? true,
    pointSize: +($('pointSize')?.value || 1),
    light: +($('light')?.value || 1),
    bg: $('bgColor')?.value || '#1b1d22',
    grid: $('showGrid')?.checked ?? true,
    axes: $('showAxes')?.checked ?? false,
    fov: +($('fov')?.value || 35),
    autoRotate: $('autoRotate')?.checked ?? false,
    rotateSpeed: +($('rotateSpeed')?.value || 12),
  });
}

for (const id of ['shading', 'wireframe', 'doubleSide', 'pointSize', 'light', 'bgColor', 'showGrid', 'showAxes', 'fov', 'autoRotate', 'rotateSpeed']) {
  const el = $(id);
  if (el) {
    el.addEventListener('input', () => {
      if (!viewer) return;
      syncControls();
      saveSettings();
    });
  }
}

async function openModel(group, model) {
  ensureViewer();
  $('galleryView').classList.add('hidden');
  $('viewerView').classList.remove('hidden');
  state.current = { group, model };

  $('viewerTitle').textContent = group.id;
  renderFileTabs();
  updateViewerForTask();

  $('error').classList.add('hidden');
  $('info').replaceChildren();

  $('loading').classList.remove('hidden');
  try {
    const info = await viewer.load(model, group.files);
    if (!info || state.current?.model !== model) return;
    renderInfo(info);
    updateViewerForTask();
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
    const label = m.modelName ? `${m.modelName} (${m.name})` : m.name;
    b.textContent = m.kind === 'video' ? '▶ ' + label : label;
    b.title = m.path;
    b.addEventListener('click', () => openModel(group, m));
    tabs.appendChild(b);
  }
}


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

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => viewer?.frame(b.dataset.view)),
);

$('screenshot')?.addEventListener('click', () => {
  if (!viewer) return;
  const a = document.createElement('a');
  a.href = viewer.screenshot();
  const { group, model } = state.current || {};
  a.download = `${group?.id || 'model'}_${model?.name || ''}.png`.replace(/[\\/:*?"<>|]/g, '_');
  a.click();
});
const VIEW_KEYS = { '1': 'front', '3': 'right', '7': 'top', '9': 'bottom' };

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
  if (state.currentTask === 'video') {
    if (e.target.matches('select, input')) return;
    if (e.key === ' ') {
      e.preventDefault();
      toggleTurntablePlay();
      return;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      viewer?.setAutoRotate(false);
      viewerB?.setAutoRotate(false);
      $('tlPlayBtn').textContent = '▶';
      const step = e.key === 'ArrowLeft' ? -5 : 5;
      let newDeg = ((viewer?.getCurrentYawDeg() ?? 0) + step + 360) % 360;
      viewer?.setYawDeg(newDeg);
      viewerB?.setYawDeg(newDeg);
      updateTimelineAngle(newDeg);
      return;
    }
  }
  if (e.key === 'r' || e.key === 'R') {
    $('autoRotate').checked = !$('autoRotate').checked;
    $('autoRotate').dispatchEvent(new Event('input'));
  } else if (e.key === 'f' || e.key === 'F') viewer?.frame('front');
  else if (VIEW_KEYS[e.key]) viewer?.frame(VIEW_KEYS[e.key]);
});


// Tự động kiểm tra và tải dữ liệu tĩnh (GitHub Pages)
async function initAutoLoad() {
  try {
    const staticEntries = await fetchStaticManifest();
    if (staticEntries && staticEntries.length > 0) {
      loadEntries(staticEntries);
    }
  } catch (e) {
    console.debug('No static manifest found:', e);
  }
}
initAutoLoad();
