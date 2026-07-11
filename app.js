/* =========================================================================
   마비노기 가방 배치 시뮬레이터
   -------------------------------------------------------------------------
   이 파일에서 직접 수정하면 되는 부분은 아래 CONFIG 블록뿐입니다.
   나머지 코드는 그대로 두셔도 됩니다.
   ========================================================================= */

const CONFIG = {
  // 구글 시트 주소창의 /d/ 뒤, /edit 앞에 있는 긴 문자열입니다.
  SHEET_ID: "1TzVtBFSy-WzCCid-3BfMlwhEszP7bBT-CI8fFDcYh-0",
  // 실제 데이터가 있는 시트(탭) 이름입니다. 하단 탭 이름을 그대로 적으면 됩니다.
  SHEET_NAME: "시트1",
  // 시트 연결에 실패했을 때 대신 사용할 로컬 백업 데이터 파일입니다.
  FALLBACK_URL: "data/bags.json",
};

/* ========================================================================= */

// 인벤토리 기본 크기와 확장권 규칙 (마비노기 기준: 기본 가로 6칸, 확장권 1장당 +1칸, 최대 3장까지 = 최대 가로 9칸)
const INVENTORY_BASE_COLS = 6;
const INVENTORY_ROWS = 10;
const INVENTORY_MAX_EXTENSIONS = 3;

const state = {
  bags: [],
  cols: INVENTORY_BASE_COLS,
  rows: INVENTORY_ROWS,
  extCount: 0,
  cellPx: 0,
  placements: [],
  selectedBagKey: null,
  nextId: 1,
  typeFilter: "전체",
  tagFilters: new Set(),
  searchText: "",
  sortMode: "name",
};

const el = {
  status: document.getElementById("data-status"),
  search: document.getElementById("search-input"),
  typeFilters: document.getElementById("type-filters"),
  tagFilters: document.getElementById("tag-filters"),
  sort: document.getElementById("sort-select"),
  catalogList: document.getElementById("catalog-list"),
  extInput: document.getElementById("ext-input"),
  gridSizeLabel: document.getElementById("grid-size-label"),
  placeMessage: document.getElementById("place-message"),
  clearBtn: document.getElementById("clear-btn"),
  grid: document.getElementById("grid"),
  summaryCount: document.getElementById("summary-count"),
  summaryCells: document.getElementById("summary-cells"),
  summaryCapacity: document.getElementById("summary-capacity"),
};

/* ---------------------------- 데이터 불러오기 ---------------------------- */

async function loadBags() {
  const sheetUrl =
    `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=` +
    encodeURIComponent(CONFIG.SHEET_NAME);

  try {
    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const parsed = csvToBags(text);
    if (parsed.length === 0) throw new Error("파싱된 가방이 없습니다");
    state.bags = parsed;
    setStatus(`구글 시트에서 데이터를 불러왔습니다 (${parsed.length}개 가방).`, "ok");
  } catch (err) {
    console.warn("시트 연결 실패, 백업 데이터로 전환합니다:", err);
    try {
      const res2 = await fetch(CONFIG.FALLBACK_URL);
      state.bags = await res2.json();
      setStatus(
        `구글 시트 연결에 실패해 저장된 백업 데이터를 사용 중입니다 (${state.bags.length}개 가방). ` +
        `시트가 "링크가 있는 모든 사용자에게 보기"로 공개되어 있는지 확인해보세요.`,
        "warn"
      );
    } catch (err2) {
      console.error(err2);
      setStatus("가방 데이터를 불러오지 못했습니다. 인터넷 연결 또는 시트 설정을 확인해주세요.", "error");
      state.bags = [];
    }
  }
}

function setStatus(msg, kind) {
  el.status.textContent = msg;
  el.status.className = "data-status " + (kind || "");
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function csvToBags(text) {
  const rows = parseCSV(text).filter(r => r.some(c => c.trim() !== ""));
  if (rows.length < 2) return [];

  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };

  const col = {
    type: idx(["type", "타입", "분류"]),
    name: idx(["name", "이름"]),
    out_w: idx(["out_w", "outw"]),
    out_h: idx(["out_h", "outh"]),
    in_w: idx(["in_w", "inw"]),
    in_h: idx(["in_h", "inh"]),
    image: idx(["image_url", "image", "img", "imageurl", "이미지"]),
    unique: idx(["unique", "no_duplicate", "중복불가", "중복소지불가", "dup_limit"]),
    tags: idx(["tags", "tag", "분류2", "용도", "목적", "category2"]),
  };

  if (col.name === -1 || col.out_w === -1 || col.out_h === -1 || col.in_w === -1 || col.in_h === -1) {
    return [];
  }

  const bags = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[col.name] || "").trim();
    if (!name) continue;

    const out_w = parseInt(row[col.out_w], 10);
    const out_h = parseInt(row[col.out_h], 10);
    const in_w = parseInt(row[col.in_w], 10);
    const in_h = parseInt(row[col.in_h], 10);
    if ([out_w, out_h, in_w, in_h].some(n => !Number.isFinite(n) || n <= 0)) continue;

    bags.push({
      type: col.type !== -1 ? (row[col.type] || "").trim() || "기타" : "기타",
      name,
      out_w, out_h, in_w, in_h,
      image_url: col.image !== -1 ? (row[col.image] || "").trim() : "",
      unique: col.unique !== -1 ? isTruthy(row[col.unique]) : false,
      tags: col.tags !== -1 ? splitTags(row[col.tags]) : [],
    });
  }
  return bags;
}

function splitTags(v) {
  if (!v) return [];
  return v.split(/[,/;|]/).map(s => s.trim()).filter(Boolean);
}

function isTruthy(v) {
  const s = (v || "").trim().toLowerCase();
  return ["y", "yes", "true", "1", "o", "중복불가", "불가", "unique"].includes(s);
}

/* ------------------------------ 카탈로그(목록) ------------------------------ */

function bagKey(bag, i) {
  return bag.name + "__" + i;
}

const TYPE_COLORS = {
  "인형": "var(--type-doll)",
  "일반": "var(--type-normal)",
};
function typeColor(type) {
  return TYPE_COLORS[type] || "var(--type-other)";
}

function renderTagFilters() {
  const allTags = new Set();
  state.bags.forEach(b => (b.tags || []).forEach(t => allTags.add(t)));

  if (allTags.size === 0) {
    el.tagFilters.classList.remove("visible");
    el.tagFilters.innerHTML = "";
    return;
  }

  el.tagFilters.classList.add("visible");
  el.tagFilters.innerHTML = "";
  [...allTags].sort((a, b) => a.localeCompare(b, "ko")).forEach(tag => {
    const btn = document.createElement("button");
    btn.className = "type-filter-btn" + (state.tagFilters.has(tag) ? " active" : "");
    btn.textContent = tag;
    btn.addEventListener("click", () => {
      if (state.tagFilters.has(tag)) state.tagFilters.delete(tag);
      else state.tagFilters.add(tag);
      renderTagFilters();
      renderCatalog();
    });
    el.tagFilters.appendChild(btn);
  });
}

function renderTypeFilters() {
  const types = ["전체", ...new Set(state.bags.map(b => b.type))];
  el.typeFilters.innerHTML = "";
  types.forEach(t => {
    const btn = document.createElement("button");
    btn.className = "type-filter-btn" + (t === state.typeFilter ? " active" : "");
    btn.textContent = t;
    btn.addEventListener("click", () => {
      state.typeFilter = t;
      renderTypeFilters();
      renderCatalog();
    });
    el.typeFilters.appendChild(btn);
  });
}

function getFilteredSortedBags() {
  let list = state.bags.map((b, i) => ({ bag: b, key: bagKey(b, i) }));

  if (state.typeFilter !== "전체") {
    list = list.filter(({ bag }) => bag.type === state.typeFilter);
  }
  if (state.tagFilters.size > 0) {
    list = list.filter(({ bag }) => (bag.tags || []).some(t => state.tagFilters.has(t)));
  }
  if (state.searchText.trim()) {
    const q = state.searchText.trim().toLowerCase();
    list = list.filter(({ bag }) => bag.name.toLowerCase().includes(q));
  }

  const cmp = {
    "name": (a, b) => a.bag.name.localeCompare(b.bag.name, "ko"),
    "out-desc": (a, b) => (b.bag.out_w * b.bag.out_h) - (a.bag.out_w * a.bag.out_h),
    "out-asc": (a, b) => (a.bag.out_w * a.bag.out_h) - (b.bag.out_w * b.bag.out_h),
    "in-desc": (a, b) => (b.bag.in_w * b.bag.in_h) - (a.bag.in_w * a.bag.in_h),
    "in-asc": (a, b) => (a.bag.in_w * a.bag.in_h) - (b.bag.in_w * b.bag.in_h),
  }[state.sortMode] || (() => 0);

  list.sort(cmp);
  return list;
}

function renderCatalog() {
  const list = getFilteredSortedBags();
  el.catalogList.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "조건에 맞는 가방이 없습니다.";
    el.catalogList.appendChild(empty);
    return;
  }

  list.forEach(({ bag, key }) => {
    const alreadyPlaced = bag.unique && state.placements.some(p => p.bag.name === bag.name);

    const card = document.createElement("div");
    card.className = "bag-card"
      + (state.selectedBagKey === key ? " selected" : "")
      + (alreadyPlaced ? " disabled" : "");
    card.draggable = !alreadyPlaced;
    card.dataset.key = key;

    const thumb = document.createElement("div");
    thumb.className = "bag-thumb";
    if (bag.image_url) {
      thumb.style.backgroundImage = `url("${bag.image_url}")`;
    } else {
      thumb.textContent = `${bag.out_w}×${bag.out_h}`;
    }

    const info = document.createElement("div");
    info.className = "bag-info";
    info.innerHTML = `
      <div class="bag-name" title="${escapeHtml(bag.name)}">${escapeHtml(bag.name)}</div>
      <div class="bag-meta">
        <span>배치 ${bag.out_w}×${bag.out_h}</span>
        <span>내부 ${bag.in_w}×${bag.in_h} (${bag.in_w * bag.in_h}칸)</span>
      </div>
    `;

    const badge = document.createElement("span");
    badge.className = "type-badge";
    badge.style.background = typeColor(bag.type);
    badge.textContent = bag.type;

    card.appendChild(thumb);
    card.appendChild(info);
    if (bag.unique) {
      const uniqueBadge = document.createElement("span");
      uniqueBadge.className = "unique-badge";
      uniqueBadge.textContent = "중복불가";
      card.appendChild(uniqueBadge);
    }
    card.appendChild(badge);

    card.addEventListener("click", () => {
      if (alreadyPlaced) {
        showMessage(`"${bag.name}"은(는) 중복 소지가 불가능해서 이미 배치된 것 외에는 추가할 수 없어요.`);
        return;
      }
      state.selectedBagKey = (state.selectedBagKey === key) ? null : key;
      renderCatalog();
    });

    card.addEventListener("dragstart", (e) => {
      if (alreadyPlaced) { e.preventDefault(); return; }
      e.dataTransfer.setData("text/plain", key);
      state.selectedBagKey = key;
    });

    el.catalogList.appendChild(card);
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function findBagByKey(key) {
  const idx = parseInt(key.split("__").pop(), 10);
  return state.bags[idx] || null;
}

/* -------------------------------- 그리드 -------------------------------- */

function applyExtensionCount() {
  state.cols = INVENTORY_BASE_COLS + state.extCount;
  state.rows = INVENTORY_ROWS;
  el.gridSizeLabel.textContent = `${state.cols} × ${state.rows}칸` +
    (state.extCount > 0 ? ` (확장권 ${state.extCount}장 사용)` : "");
}

function initGridControls() {
  el.extInput.value = state.extCount;
  applyExtensionCount();

  el.extInput.addEventListener("change", () => {
    state.extCount = clamp(parseInt(el.extInput.value, 10) || 0, 0, INVENTORY_MAX_EXTENSIONS);
    el.extInput.value = state.extCount;
    applyExtensionCount();
    pruneOutOfBoundsPlacements();
    renderGrid();
    saveState();
  });

  el.clearBtn.addEventListener("click", clearAllPlacements);
  document.getElementById("titlebar-clear-icon").addEventListener("click", clearAllPlacements);
}

function clearAllPlacements() {
  if (state.placements.length === 0) return;
  if (confirm("배치된 모든 가방을 지우시겠어요?")) {
    state.placements = [];
    renderGrid();
    saveState();
  }
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function pruneOutOfBoundsPlacements() {
  state.placements = state.placements.filter(
    p => p.x + p.bag.out_w <= state.cols && p.y + p.bag.out_h <= state.rows
  );
}

function cellFree(x, y, w, h, ignoreId) {
  if (x < 0 || y < 0 || x + w > state.cols || y + h > state.rows) return false;
  for (const p of state.placements) {
    if (p.id === ignoreId) continue;
    const overlap = x < p.x + p.bag.out_w && x + w > p.x && y < p.y + p.bag.out_h && y + h > p.y;
    if (overlap) return false;
  }
  return true;
}

function renderGrid() {
  el.grid.style.setProperty("--cols", state.cols);
  el.grid.style.setProperty("--rows", state.rows);
  el.grid.innerHTML = "";

  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      el.grid.appendChild(cell);
    }
  }

  state.placements.forEach(p => {
    el.grid.appendChild(makePlacedBagEl(p));
  });

  requestAnimationFrame(measureCellPx);
  renderSummary();
  renderCatalog();
}

function makePlacedBagEl(p) {
  const div = document.createElement("div");
  div.className = "placed-bag" + (p.bag.image_url ? " has-image" : "");
  div.style.gridColumn = `${p.x + 1} / span ${p.bag.out_w}`;
  div.style.gridRow = `${p.y + 1} / span ${p.bag.out_h}`;
  div.style.background = typeColor(p.bag.type);
  if (p.bag.image_url) {
    div.style.backgroundImage = `url("${p.bag.image_url}")`;
    div.style.backgroundSize = "cover";
    div.style.backgroundPosition = "center";
  }
  div.title = `${p.bag.name} (내부 ${p.bag.in_w}×${p.bag.in_h})`;
  div.textContent = p.bag.name;

  const removeBtn = document.createElement("span");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.placements = state.placements.filter(pl => pl.id !== p.id);
    renderGrid();
    saveState();
  });
  div.appendChild(removeBtn);

  return div;
}

function measureCellPx() {
  const rect = el.grid.getBoundingClientRect();
  state.cellPx = {
    w: rect.width / state.cols,
    h: rect.height / state.rows,
    left: rect.left,
    top: rect.top,
  };
}

function renderSummary() {
  const count = state.placements.length;
  const occupied = state.placements.reduce((s, p) => s + p.bag.out_w * p.bag.out_h, 0);
  const capacity = state.placements.reduce((s, p) => s + p.bag.in_w * p.bag.in_h, 0);

  el.summaryCount.textContent = `${count}개`;
  el.summaryCells.textContent = `${occupied} / ${state.cols * state.rows}`;
  el.summaryCapacity.textContent = `${capacity.toLocaleString()}칸`;
}

/* --------------------------- 배치 (드래그 & 클릭) --------------------------- */

let dragPreviewEl = null;

function setupGridInteractions() {
  el.grid.addEventListener("dragover", (e) => {
    e.preventDefault();
    const key = state.selectedBagKey;
    if (!key) return;
    const bag = findBagByKey(key);
    if (!bag) return;

    const { x, y } = pointerToCell(e.clientX, e.clientY, bag.out_w, bag.out_h);
    showDragPreview(x, y, bag);
  });

  el.grid.addEventListener("dragleave", (e) => {
    if (e.target === el.grid) clearDragPreview();
  });

  el.grid.addEventListener("drop", (e) => {
    e.preventDefault();
    const key = e.dataTransfer.getData("text/plain") || state.selectedBagKey;
    clearDragPreview();
    if (!key) return;
    const bag = findBagByKey(key);
    if (!bag) return;

    const { x, y } = pointerToCell(e.clientX, e.clientY, bag.out_w, bag.out_h);
    tryPlaceBag(bag, x, y);
  });

  el.grid.addEventListener("click", (e) => {
    const cellEl = e.target.closest(".cell");
    if (!cellEl) return;
    const key = state.selectedBagKey;
    if (!key) return;
    const bag = findBagByKey(key);
    if (!bag) return;

    const x = parseInt(cellEl.dataset.x, 10);
    const y = parseInt(cellEl.dataset.y, 10);
    tryPlaceBag(bag, x, y);
  });
}

function pointerToCell(clientX, clientY, w, h) {
  if (!state.cellPx || !state.cellPx.w) measureCellPx();
  const { left, top, w: cw, h: ch } = state.cellPx;
  let x = Math.floor((clientX - left) / cw);
  let y = Math.floor((clientY - top) / ch);
  x = clamp(x, 0, Math.max(0, state.cols - w));
  y = clamp(y, 0, Math.max(0, state.rows - h));
  return { x, y };
}

function showDragPreview(x, y, bag) {
  clearDragPreview();
  const valid = cellFree(x, y, bag.out_w, bag.out_h);
  const div = document.createElement("div");
  div.className = "drag-preview" + (valid ? "" : " invalid");
  div.style.gridColumn = `${x + 1} / span ${bag.out_w}`;
  div.style.gridRow = `${y + 1} / span ${bag.out_h}`;
  el.grid.appendChild(div);
  dragPreviewEl = div;
}

function clearDragPreview() {
  if (dragPreviewEl) {
    dragPreviewEl.remove();
    dragPreviewEl = null;
  }
}

function tryPlaceBag(bag, x, y) {
  if (bag.unique && state.placements.some(p => p.bag.name === bag.name)) {
    showMessage(`"${bag.name}"은(는) 중복 소지가 불가능한 가방이라 1개만 배치할 수 있어요.`);
    return false;
  }
  if (!cellFree(x, y, bag.out_w, bag.out_h)) {
    flashInvalid(x, y, bag);
    showMessage("이미 다른 가방이 있거나 인벤토리 범위를 벗어나서 배치할 수 없어요.");
    return false;
  }
  state.placements.push({ id: state.nextId++, bag, x, y });
  renderGrid();
  saveState();
  return true;
}

let messageTimer = null;
function showMessage(text) {
  el.placeMessage.textContent = text;
  el.placeMessage.classList.add("show");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => el.placeMessage.classList.remove("show"), 2600);
}

function flashInvalid(x, y, bag) {
  const div = document.createElement("div");
  div.className = "drag-preview invalid";
  div.style.gridColumn = `${x + 1} / span ${bag.out_w}`;
  div.style.gridRow = `${y + 1} / span ${bag.out_h}`;
  el.grid.appendChild(div);
  setTimeout(() => div.remove(), 260);
}

/* ------------------------------ 상태 저장/복원 ------------------------------ */

const STORAGE_KEY = "mabinogi-bag-sim-state-v1";

function saveState() {
  try {
    const data = {
      extCount: state.extCount,
      placements: state.placements.map(p => ({ name: p.bag.name, x: p.x, y: p.y })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) { /* 무시 */ }
}

function restoreState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (e) { saved = null; }
  if (!saved) return;

  state.extCount = clamp(saved.extCount || 0, 0, INVENTORY_MAX_EXTENSIONS);
  el.extInput.value = state.extCount;
  applyExtensionCount();

  (saved.placements || []).forEach(sp => {
    const bag = state.bags.find(b => b.name === sp.name);
    if (!bag) return;
    if (cellFree(sp.x, sp.y, bag.out_w, bag.out_h)) {
      state.placements.push({ id: state.nextId++, bag, x: sp.x, y: sp.y });
    }
  });
}

/* ------------------------------ 설정 패널: 색상 팔레트 ------------------------------ */

const THEME_STORAGE_KEY = "mabinogi-bag-sim-theme-v1";
const DEFAULT_THEME = { name: "블루(기본)", base: "#1c2a38", highlight: "#4fa3d9", shadow: "#0d151c" };

const THEME_PRESETS = [
  { name: "블루(기본)",   base: "#1c2a38", highlight: "#4fa3d9", shadow: "#0d151c" },
  { name: "블랙/스틸",    base: "#22262b", highlight: "#9aa5b1", shadow: "#101214" },
  { name: "핑크",        base: "#33202b", highlight: "#e685b5", shadow: "#1a0f15" },
  { name: "레드",        base: "#331c1c", highlight: "#d9534f", shadow: "#1a0d0d" },
  { name: "다크레드",     base: "#2a1418", highlight: "#a83244", shadow: "#160a0c" },
  { name: "그레이",       base: "#26282a", highlight: "#8fa3ad", shadow: "#131415" },
  { name: "로즈(연분홍)",  base: "#332428", highlight: "#e8a8b8", shadow: "#1c1315" },
  { name: "다크틸",       base: "#16292a", highlight: "#3f9c9e", shadow: "#0a1516" },
  { name: "퍼플",        base: "#26182c", highlight: "#a85fc9", shadow: "#140d17" },
  { name: "라임",        base: "#222c14", highlight: "#a8cc4f", shadow: "#11160a" },
  { name: "탄/브라운",    base: "#2c2418", highlight: "#c9964f", shadow: "#17130c" },
  { name: "슬레이트블루",  base: "#20242c", highlight: "#7d93b3", shadow: "#10131a" },
  { name: "크림/옐로우",   base: "#2c2a1c", highlight: "#e8d98f", shadow: "#171609" },
  { name: "스카이블루",    base: "#1c2830", highlight: "#7fc4e8", shadow: "#0e1418" },
];

const themeEl = {
  base: document.getElementById("theme-base-input"),
  highlight: document.getElementById("theme-highlight-input"),
  shadow: document.getElementById("theme-shadow-input"),
  reset: document.getElementById("theme-reset-btn"),
};

let currentThemeName = null;

function applyTheme(theme) {
  document.documentElement.style.setProperty("--theme-base", theme.base);
  document.documentElement.style.setProperty("--theme-highlight", theme.highlight);
  document.documentElement.style.setProperty("--theme-shadow", theme.shadow);
  themeEl.base.value = theme.base;
  themeEl.highlight.value = theme.highlight;
  themeEl.shadow.value = theme.shadow;
  currentThemeName = theme.name || null;
  renderPalettePresets();
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme)); } catch (e) { /* 무시 */ }
}

function renderPalettePresets() {
  const container = document.getElementById("palette-presets");
  container.innerHTML = "";
  THEME_PRESETS.forEach(preset => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-swatch-btn" + (currentThemeName === preset.name ? " active" : "");
    btn.innerHTML = `
      <span class="palette-swatch-dots">
        <span style="background:${preset.base}"></span>
        <span style="background:${preset.highlight}"></span>
        <span style="background:${preset.shadow}"></span>
      </span>
      ${escapeHtml(preset.name)}
    `;
    btn.addEventListener("click", () => {
      applyTheme(preset);
      saveTheme(preset);
    });
    container.appendChild(btn);
  });
}

function setupThemeControls() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || "null"); } catch (e) { saved = null; }
  applyTheme(saved || DEFAULT_THEME);

  const onManualChange = () => {
    const theme = {
      name: null,
      base: themeEl.base.value, highlight: themeEl.highlight.value, shadow: themeEl.shadow.value,
    };
    applyTheme(theme);
    saveTheme(theme);
  };
  themeEl.base.addEventListener("input", onManualChange);
  themeEl.highlight.addEventListener("input", onManualChange);
  themeEl.shadow.addEventListener("input", onManualChange);

  themeEl.reset.addEventListener("click", () => {
    applyTheme(DEFAULT_THEME);
    saveTheme(DEFAULT_THEME);
  });

  document.getElementById("palette-custom-toggle").addEventListener("click", (e) => {
    const box = document.getElementById("palette-custom");
    box.classList.toggle("hidden");
    e.target.textContent = box.classList.contains("hidden") ? "직접 입력하기 ▾" : "직접 입력하기 ▴";
  });
}

/* ------------------------------ 설정 패널: 폰트 ------------------------------ */

const FONT_STORAGE_KEY = "mabinogi-bag-sim-font-v1";

// fonts/ 폴더의 실제 폰트 3개를 style.css의 @font-face에서 CustomFont1~3으로 연결해두었습니다.
const FONT_PRESETS = [
  { key: "default", label: "기본 (Cinzel / Noto Sans KR)", display: '"Cinzel", serif', body: '"Noto Sans KR", sans-serif' },
  { key: "font1", label: "나눔고딕", display: '"CustomFont1", serif', body: '"CustomFont1", sans-serif' },
  { key: "font2", label: "마비옛체", display: '"CustomFont2", serif', body: '"CustomFont2", sans-serif' },
  { key: "font3", label: "MonaS12(도트)", display: '"CustomFont3", serif', body: '"CustomFont3", sans-serif' },
];

let currentFontKey = "default";

function applyFont(preset) {
  document.documentElement.style.setProperty("--font-display", preset.display);
  document.documentElement.style.setProperty("--font-body", preset.body);
  currentFontKey = preset.key;
  renderFontPresets();
}

function renderFontPresets() {
  const container = document.getElementById("font-presets");
  container.innerHTML = "";
  FONT_PRESETS.forEach(preset => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "font-preset-btn" + (currentFontKey === preset.key ? " active" : "");
    btn.textContent = preset.label;
    btn.addEventListener("click", () => {
      applyFont(preset);
      try { localStorage.setItem(FONT_STORAGE_KEY, preset.key); } catch (e) { /* 무시 */ }
    });
    container.appendChild(btn);
  });
}

function setupFontControls() {
  let savedKey = null;
  try { savedKey = localStorage.getItem(FONT_STORAGE_KEY); } catch (e) { savedKey = null; }
  applyFont(FONT_PRESETS.find(p => p.key === savedKey) || FONT_PRESETS[0]);
}

/* ------------------------------ 설정 패널: 열기/닫기 (서랍형) ------------------------------ */

function setupSettingsPanel() {
  const panel = document.getElementById("settings-panel");
  const btn = document.getElementById("settings-btn");
  const closeBtn = document.getElementById("settings-close-btn");

  // "hidden"(display:none) 대신 "open" 클래스로 transform을 토글합니다.
  // display:none은 트랜지션이 안 걸리기 때문에, 항상 렌더링해두고 화면 밖으로 밀어두는 방식입니다.
  btn.addEventListener("click", () => panel.classList.toggle("open"));
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));

  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("open")) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    panel.classList.remove("open");
  });
}

/* ---------------------------------- 시작 ---------------------------------- */

async function init() {
  setupSettingsPanel();
  setupThemeControls();
  setupFontControls();
  initGridControls();
  setupGridInteractions();

  el.search.addEventListener("input", () => {
    state.searchText = el.search.value;
    renderCatalog();
  });
  el.sort.addEventListener("change", () => {
    state.sortMode = el.sort.value;
    renderCatalog();
  });

  window.addEventListener("resize", () => requestAnimationFrame(measureCellPx));

  await loadBags();
  renderTypeFilters();
  renderTagFilters();
  renderCatalog();
  restoreState();
  renderGrid();
}

init();
