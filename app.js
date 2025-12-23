const PRESENTS_URL = "presents.json";
const UNOPENED_IMAGE = "images/unopened.png";

const els = {
  nextTitle: document.getElementById("nextTitle"),
  statusPill: document.getElementById("statusPill"),
  presentImg: document.getElementById("presentImg"),
  presentWrapper: document.getElementById("presentWrapper"),
  countdown: document.getElementById("countdown"),
  openAtText: document.getElementById("openAtText"),
  openBtn: document.getElementById("openBtn"),
  viewBtn: document.getElementById("viewBtn"),
  hint: document.getElementById("hint"),
  revealArea: document.getElementById("revealArea"),
  giftImg: document.getElementById("giftImg"),
  revealedGrid: document.getElementById("revealedGrid"),
  revealedCount: document.getElementById("revealedCount"),
  confetti: document.getElementById("confetti"),
  subHeader: document.getElementById("subHeader"),
  revealAllBtn: document.getElementById("revealAllBtn"),
  featuredCard: document.getElementById("featuredCard"),
  featuredImg: document.getElementById("featuredImg"),
  featuredMeta: document.getElementById("featuredMeta"),
  featuredWheelArea: document.getElementById("featuredWheelArea"),
  featuredWheelCanvas: document.getElementById("featuredWheelCanvas"),
  featuredWheelRotator: document.getElementById("featuredWheelRotator"),
  featuredWheelSpinBtn: document.getElementById("featuredWheelSpinBtn"),
  featuredWheelRespinBtn: document.getElementById("featuredWheelRespinBtn"),
  featuredWheelResult: document.getElementById("featuredWheelResult"),
  wheelArea: document.getElementById("wheelArea"),
  wheelCanvas: document.getElementById("wheelCanvas"),
  wheelRotator: document.getElementById("wheelRotator"),
  wheelSpinBtn: document.getElementById("wheelSpinBtn"),
  wheelRespinBtn: document.getElementById("wheelRespinBtn"),
  wheelResult: document.getElementById("wheelResult"),
};

// Deterministic seed so spins are identical across devices
const APP_SEED = "GiftWebsiteSeed_v2";
// Canvas 0° is at the right (east); our pointer is at the top (north).
// Use a -90° offset so the selected slice centers under the top pointer.
const POINTER_OFFSET_DEG = -90;

let presents = [];
let tickTimer = null;
let nextPresent = null;

// Normalize options from:
// - array of strings
// - object map { label: color }
// - object map { label: { color, textColor } } where textColor is 'white' | 'black'
function normalizeOptions(raw) {
  if (!raw) return [];
  const defaultColor = (i) => (i % 2 === 0 ? "#150144ff" : "#0a2716ff");
  const defaultText = "white";
  if (Array.isArray(raw)) {
    return raw.map((label, i) => ({ label: String(label), color: defaultColor(i), textColor: defaultText }));
  }
  if (typeof raw === "object") {
    // Use insertion order of object keys as slice order
    const entries = Object.entries(raw);
    return entries.map(([label, val], i) => {
      if (val && typeof val === "object") {
        const color = val.color || defaultColor(i);
        let textColor = (val.textColor || val.text || defaultText);
        textColor = String(textColor).toLowerCase() === "black" ? "black" : "white";
        return { label: String(label), color, textColor };
      }
      return { label: String(label), color: val || defaultColor(i), textColor: defaultText };
    });
  }
  return [];
}
function labelsFromItems(items) {
  return items.map((it) => it.label);
}

function loadRevealedSet() {
  try {
    const raw = localStorage.getItem("revealed_presents");
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveRevealedSet(set) {
  localStorage.setItem("revealed_presents", JSON.stringify([...set]));
}
function loadFeaturedId() {
  try {
    const id = localStorage.getItem("featured_present_id");
    return id || null;
  } catch {
    return null;
  }
}
function saveFeaturedId(id) {
  if (!id) {
    localStorage.removeItem("featured_present_id");
  } else {
    localStorage.setItem("featured_present_id", id);
  }
}

function wheelKey(id){ return `wheel_result_${id}`; }
function loadWheelResult(id){
  try { return localStorage.getItem(wheelKey(id)); } catch { return null; }
}
function saveWheelResult(id, value){
  try { localStorage.setItem(wheelKey(id), value); } catch {}
}

// FNV-1a 32-bit hash → deterministic integer
function fnv1a32(str){
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h >>> 0) * 0x01000193; // mul by FNV prime
  }
  return h >>> 0;
}
function seededIndex(p, labels){
  const seedStr = `${APP_SEED}|${p.image_id}|${p.open_at}|${labels.join('|')}`;
  const h = fnv1a32(seedStr);
  return h % labels.length;
}
function seededExtraTurns(p, labels){
  const seedStr = `${APP_SEED}|turns|${p.image_id}|${p.open_at}|${labels.length}`;
  const h = fnv1a32(seedStr);
  return 3 + (h % 3); // 3–5 full turns, deterministic
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function pad(n) { return String(n).padStart(2, "0"); }
function fmtCountdown(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600) % 24;
  const d = Math.floor(total / 86400);
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Placeholder title used until a present is revealed
function getPlaceholderTitle(p) {
  if (!p) return "Next present";
  const sorted = sortPresents(presents);
  const idx = sorted.findIndex(q => q.image_id === p.image_id);
  const n = idx >= 0 ? idx + 1 : "";
  return n ? `Present ${n}` : "Present";
}

function sortPresents(ps) {
  return [...ps].sort((a,b) => new Date(a.open_at) - new Date(b.open_at));
}

function pickCurrentPresent(ps, revealedSet) {
  const sorted = sortPresents(ps);
  const unrevealed = sorted.filter(p => !revealedSet.has(p.image_id));
  if (unrevealed.length > 0) return unrevealed[0];
  return sorted[sorted.length - 1] ?? null; // all opened → show last for viewing
}

function renderRevealedGallery(ps, revealedSet, now) {
  const revealed = sortPresents(ps).filter(p => new Date(p.open_at) <= now && revealedSet.has(p.image_id));
  els.revealedCount.textContent = String(revealed.length);
  els.revealedGrid.innerHTML = "";

  // Update subheader with remaining unrevealed count
  const revealedByUser = ps.filter(p => revealedSet.has(p.image_id)).length;
  const remainingUnrevealed = Math.max(0, ps.length - revealedByUser);
  if (els.subHeader) {
    els.subHeader.textContent = `A new present unlocks over time. Unrevealed: ${remainingUnrevealed}`;
  }

  if (revealed.length === 0) {
    els.revealedGrid.innerHTML = `<div class="small">No revealed presents yet.</div>`;
    return;
  }

  for (const p of revealed.slice().reverse()) {
    const tile = document.createElement("div");
    tile.className = "tile";
    const choice = loadWheelResult(p.image_id);
    tile.innerHTML = `
      <img src="${p.image_path}" alt="${p.title ?? p.image_id}" loading="lazy" />
      <div class="t">${p.title ?? p.image_id}</div>
      <div class="d">Unlocked: ${fmtDate(p.open_at)}</div>
      ${choice ? `<div class=\"d\">Choice: ${choice}</div>` : ""}
    `;
    tile.addEventListener("click", () => showGift(p, { silent: true }));
    els.revealedGrid.appendChild(tile);
  }
}

function renderFeatured(ps) {
  const id = loadFeaturedId();
  if (!id) {
    if (els.featuredCard) els.featuredCard.hidden = true;
    return;
  }
  const p = ps.find(q => q.image_id === id);
  if (!p) {
    if (els.featuredCard) els.featuredCard.hidden = true;
    return;
  }
  els.featuredCard.hidden = false;
  els.featuredImg.src = p.image_path;
  els.featuredMeta.textContent = `${p.title ?? p.image_id} — Unlocked: ${fmtDate(p.open_at)}`;
  showFeaturedWheel(p);
}

// Unified wheel renderer for both normal and featured wheels
class WheelRenderer {
  constructor(canvas) {
    this.canvas = canvas;
  }

  draw(items) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const size = 360;
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r = Math.min(cx, cy) - 6 * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const n = items.length;
    const slice = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      const a0 = i * slice;
      const a1 = a0 + slice;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a1, false);
      ctx.closePath();
      ctx.fillStyle = items[i]?.color || (i % 2 === 0 ? "#150144ff" : "#0a2716ff");
      ctx.fill();

      const mid = a0 + slice / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * (r * 0.68), cy + Math.sin(mid) * (r * 0.68));
      ctx.rotate(mid);
      const txt = (items[i]?.textColor || "white") === "black" ? "#000000ff" : "#ffffffff";
      ctx.fillStyle = txt;
      ctx.font = `${Math.floor(14 * dpr)}px arial`;
      const text = items[i]?.label ?? "";
      const maxChars = 18;
      const t = text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t, 0, 0);
      ctx.restore();
    }
    // outline
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = 3 * dpr;
    ctx.stroke();
  }
}

// Unified controller to handle drawing, alignment, and spinning
class WheelController {
  constructor({ canvas, rotator, spinBtn, respinBtn, resultEl, restorePrevTransition }) {
    this.renderer = new WheelRenderer(canvas);
    this.canvas = canvas;
    this.rotator = rotator;
    this.spinBtn = spinBtn;
    this.respinBtn = respinBtn;
    this.resultEl = resultEl;
    this.restorePrevTransition = !!restorePrevTransition;
    this.items = [];
  }

  draw(items = []) {
    this.items = Array.isArray(items) ? items : [];
    this.renderer.draw(this.items);
  }

  alignToIndex(idx, n, { animate }) {
    if (!this.rotator) return;
    const sliceDeg = 360 / n;
    const centerDeg = idx * sliceDeg + sliceDeg / 2;
    const target = -centerDeg + POINTER_OFFSET_DEG;
    const style = this.rotator.style;
    if (!animate) {
      const prev = style.transition;
      style.transition = "none";
      style.transform = `rotate(${target}deg)`;
      void this.rotator.offsetWidth;
      style.transition = this.restorePrevTransition ? (prev || "") : "";
    } else {
      style.transform = `rotate(${target}deg)`;
    }
  }

  spin(p) {
    const items = normalizeOptions(p.options);
    const labels = labelsFromItems(items);
    if (!this.rotator || labels.length < 2) return;
    if (this.spinBtn) this.spinBtn.disabled = true;
    if (this.resultEl) this.resultEl.textContent = "Spinning…";

    const n = labels.length;
    const sliceDeg = 360 / n;
    const idx = seededIndex(p, labels);
    const centerDeg = idx * sliceDeg + sliceDeg / 2;
    const extraTurns = seededExtraTurns(p, labels);
    const targetDeg = -centerDeg + POINTER_OFFSET_DEG - extraTurns * 360;

    this.rotator.style.transform = `rotate(${targetDeg}deg)`;

    const onDone = () => {
      this.rotator.removeEventListener("transitionend", onDone);
      const chosen = labels[idx];
      if (this.resultEl) this.resultEl.textContent = `Chosen: ${chosen}`;
      saveWheelResult(p.image_id, chosen);
      if (this.spinBtn) {
        this.spinBtn.disabled = false;
        this.spinBtn.style.display = "none";
      }
      if (this.respinBtn) this.respinBtn.style.display = "none";
    };
    this.rotator.addEventListener("transitionend", onDone);
  }
}

// Singletons for the two wheels
let wheelCtrl = null;
function ensureWheelCtrl() {
  if (!wheelCtrl) {
    wheelCtrl = new WheelController({
      canvas: els.wheelCanvas,
      rotator: els.wheelRotator,
      spinBtn: els.wheelSpinBtn,
      respinBtn: els.wheelRespinBtn,
      resultEl: els.wheelResult,
      restorePrevTransition: false,
    });
  }
  return wheelCtrl;
}

let featuredWheelCtrl = null;
function ensureFeaturedWheelCtrl() {
  if (!featuredWheelCtrl) {
    featuredWheelCtrl = new WheelController({
      canvas: els.featuredWheelCanvas,
      rotator: els.featuredWheelRotator,
      spinBtn: els.featuredWheelSpinBtn,
      respinBtn: els.featuredWheelRespinBtn,
      resultEl: els.featuredWheelResult,
      restorePrevTransition: true,
    });
  }
  return featuredWheelCtrl;
}

function drawWheel(items) {
  const ctrl = ensureWheelCtrl();
  ctrl.draw(items);
}

function showWheel(p) {
  const items = normalizeOptions(p.options);
  const labels = labelsFromItems(items);
  const shouldShow = p && p.action && /spin the wheel/i.test(p.action) && labels.length > 1;
  if (!shouldShow) {
    if (els.wheelArea) els.wheelArea.hidden = true;
    return;
  }
  els.wheelArea.hidden = false;
  drawWheel(items);

  // read persisted result
  const stored = loadWheelResult(p.image_id);
  if (stored) {
    els.wheelResult.textContent = `Chosen: ${stored}`;
    els.wheelSpinBtn.style.display = "none";
    els.wheelRespinBtn.style.display = "none";
    // align wheel to stored selection (no animation)
    const idx = labels.indexOf(stored);
    alignWheelToIndex(idx, labels.length, { animate: false });
  } else {
    els.wheelResult.textContent = "";
    els.wheelSpinBtn.style.display = "inline-block";
    els.wheelRespinBtn.style.display = "none";
    alignWheelToIndex(0, labels.length, { animate: false }); // reset orientation
  }

  // bind handlers
  els.wheelSpinBtn.onclick = () => spinWheel(p);
  // Respin disabled
  els.wheelRespinBtn.onclick = null;
}

function alignWheelToIndex(idx, n, { animate }) {
  const ctrl = ensureWheelCtrl();
  ctrl.alignToIndex(idx, n, { animate });
}

function spinWheel(p) {
  ensureWheelCtrl().spin(p);
}

// Featured wheel (separate instance)
function drawFeaturedWheel(items) {
  const ctrl = ensureFeaturedWheelCtrl();
  ctrl.draw(items);
}

function showFeaturedWheel(p) {
  const items = normalizeOptions(p.options);
  const labels = labelsFromItems(items);
  const shouldShow = p && p.action && /spin the wheel/i.test(p.action) && labels.length > 1;
  if (!shouldShow) {
    if (els.featuredWheelArea) els.featuredWheelArea.hidden = true;
    return;
  }
  els.featuredWheelArea.hidden = false;
  drawFeaturedWheel(items);

  const stored = loadWheelResult(p.image_id);
  if (stored) {
    els.featuredWheelResult.textContent = `Chosen: ${stored}`;
    els.featuredWheelSpinBtn.style.display = "none";
    els.featuredWheelRespinBtn.style.display = "none";
    const idx = labels.indexOf(stored);
    alignFeaturedWheelToIndex(idx, labels.length, { animate: false });
  } else {
    els.featuredWheelResult.textContent = "";
    els.featuredWheelSpinBtn.style.display = "inline-block";
    els.featuredWheelRespinBtn.style.display = "none";
    alignFeaturedWheelToIndex(0, labels.length, { animate: false });
  }

  els.featuredWheelSpinBtn.onclick = () => spinFeaturedWheel(p);
  // Respin disabled
  els.featuredWheelRespinBtn.onclick = null;
}

function alignFeaturedWheelToIndex(idx, n, { animate }) {
  const ctrl = ensureFeaturedWheelCtrl();
  ctrl.alignToIndex(idx, n, { animate });
}

function spinFeaturedWheel(p) {
  ensureFeaturedWheelCtrl().spin(p);
}

function showLocked(p, now) {
  els.nextTitle.textContent = getPlaceholderTitle(p);
  els.statusPill.textContent = "Locked";
  els.presentImg.src = UNOPENED_IMAGE;
  els.openBtn.disabled = true;
  els.viewBtn.style.display = "none";
  els.revealArea.hidden = true;
  els.hint.textContent = "Come back when the timer hits zero.";
  els.openAtText.textContent = p ? `Unlocks at: ${fmtDate(p.open_at)}` : "";
  updateCountdown(p, now);
}

function showUnlockedNotRevealed(p) {
  els.nextTitle.textContent = getPlaceholderTitle(p);
  els.statusPill.textContent = "Unlocked";
  els.presentImg.src = UNOPENED_IMAGE;
  els.openBtn.disabled = false;
  els.viewBtn.style.display = "none";
  els.revealArea.hidden = true;
  els.hint.textContent = "It’s time. Click to open!";
  els.openAtText.textContent = p ? `Unlocked at: ${fmtDate(p.open_at)}` : "";
  els.countdown.textContent = "00:00:00";
}

function showGift(p, { silent = false } = {}) {
  els.nextTitle.textContent = p?.title ?? "Present";
  els.statusPill.textContent = "Revealed";
  els.presentImg.src = UNOPENED_IMAGE;
  els.openBtn.disabled = true;
  els.viewBtn.style.display = "inline-block";
  els.revealArea.hidden = false;
  els.giftImg.src = p.image_path;
  els.openAtText.textContent = `Unlocked at: ${fmtDate(p.open_at)}`;
  els.countdown.textContent = "00:00:00";
  els.hint.textContent = silent ? "" : "Enjoy 🎉";

  // Optional wheel
  showWheel(p);
}

function updateCountdown(p, now) {
  if (!p) {
    els.countdown.textContent = "—";
    return;
  }
  const diff = new Date(p.open_at) - now;
  els.countdown.textContent = fmtCountdown(diff);
}

function startTick(revealedSet) {
  if (tickTimer) clearInterval(tickTimer);

  tickTimer = setInterval(() => {
    const now = new Date();
    nextPresent = pickCurrentPresent(presents, revealedSet);

    // Always update countdown if the next present is still future
    if (nextPresent) updateCountdown(nextPresent, now);

    // Keep gallery updated
    renderRevealedGallery(presents, revealedSet, now);

    if (!nextPresent) return;

    const isTime = new Date(nextPresent.open_at) <= now;
    const isRevealed = revealedSet.has(nextPresent.image_id);

    if (!isTime) showLocked(nextPresent, now);
    else if (!isRevealed) showUnlockedNotRevealed(nextPresent);
    else showGift(nextPresent, { silent: true });

  }, 250);
}

// Simple confetti burst (no libs)
function confettiBurst() {
  const canvas = els.confetti;
  const ctx = canvas.getContext("2d");
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  function resize() {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  }
  resize();

  const pieces = [];
  const count = 160;
  const originX = canvas.width / 2;
  const originY = canvas.height * 0.28;

  for (let i = 0; i < count; i++) {
    pieces.push({
      x: originX,
      y: originY,
      vx: (Math.random() - 0.5) * 16 * dpr,
      vy: (Math.random() * -18 - 8) * dpr,
      g: (Math.random() * 0.35 + 0.18) * dpr,
      r: (Math.random() * 6 + 3) * dpr,
      a: 1,
      spin: (Math.random() - 0.5) * 0.25,
      rot: Math.random() * Math.PI,
    });
  }

  let t = 0;
  const maxT = 140;

  function frame() {
    t++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of pieces) {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      p.a *= 0.985;

      // random colors without specifying palette by name
      const hue = Math.floor((p.x + p.y) % 360);
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.a);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = `hsl(${hue} 90% 60%)`;
      ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
      ctx.restore();
    }

    if (t < maxT) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  requestAnimationFrame(frame);

  window.addEventListener("resize", () => {
    resize();
  }, { once: true });
}

async function main() {
  els.presentImg.src = UNOPENED_IMAGE;

  const revealedSet = loadRevealedSet();

  // Load config
  const res = await fetch(PRESENTS_URL, { cache: "no-store" });
  presents = await res.json();

  // Basic validation
  presents = presents.filter(p => p && p.image_id && p.open_at && p.image_path);

  // Initial render
  const now = new Date();
  nextPresent = pickCurrentPresent(presents, revealedSet);
  renderRevealedGallery(presents, revealedSet, now);
  renderFeatured(presents);

  if (!nextPresent) {
    els.nextTitle.textContent = "No presents configured";
    els.statusPill.textContent = "—";
    els.hint.textContent = "Add items to presents.json";
    els.openBtn.disabled = true;
    els.countdown.textContent = "—";
    return;
  }

  // Button handlers
  els.openBtn.addEventListener("click", () => {
    const now2 = new Date();
    const isTime = new Date(nextPresent.open_at) <= now2;
    if (!isTime) return;

    // Mark opened
    revealedSet.add(nextPresent.image_id);
    saveRevealedSet(revealedSet);

    // Animate + confetti
    els.presentWrapper.classList.remove("opening");
    void els.presentWrapper.offsetWidth; // reflow
    els.presentWrapper.classList.add("opening");
    confettiBurst();

    showGift(nextPresent);
    renderRevealedGallery(presents, revealedSet, now2);
    // Persist as featured and render prominently
    saveFeaturedId(nextPresent.image_id);
    renderFeatured(presents);
    // After opening, the next tick will advance to the next unopened item
  });

  els.viewBtn.addEventListener("click", () => {
    const now2 = new Date();
    // Find the last revealed present (most recently unlocked among revealed)
    const revealedList = sortPresents(presents).filter(p => revealedSet.has(p.image_id));
    if (revealedList.length > 0) {
      const lastRevealed = revealedList[revealedList.length - 1];
      revealedSet.delete(lastRevealed.image_id);
      saveRevealedSet(revealedSet);
    }

    // Recompute current and refresh UI
    nextPresent = pickCurrentPresent(presents, revealedSet);
    renderRevealedGallery(presents, revealedSet, now2);
    // Keep featured as last opened; do not change here
    renderFeatured(presents);

    if (nextPresent) {
      const isTime = new Date(nextPresent.open_at) <= now2;
      const isRevealed = revealedSet.has(nextPresent.image_id);
      if (!isTime) showLocked(nextPresent, now2);
      else if (!isRevealed) showUnlockedNotRevealed(nextPresent);
      else showGift(nextPresent, { silent: true });
    }
  });

  // Reveal all previously unlocked presents except the latest unlocked
  els.revealAllBtn.addEventListener("click", () => {
    const now2 = new Date();
    const unlocked = sortPresents(presents).filter(p => new Date(p.open_at) <= now2);
    if (unlocked.length > 1) {
      for (const p of unlocked.slice(0, -1)) {
        revealedSet.add(p.image_id);
      }
      saveRevealedSet(revealedSet);
    }

    // Refresh UI state to reflect bulk reveal
    nextPresent = pickCurrentPresent(presents, revealedSet);
    if (nextPresent) updateCountdown(nextPresent, now2);
    renderRevealedGallery(presents, revealedSet, now2);
    // Featured remains the last opened by user
    renderFeatured(presents);

    if (nextPresent) {
      const isTime = new Date(nextPresent.open_at) <= now2;
      const isRevealed = revealedSet.has(nextPresent.image_id);
      if (!isTime) showLocked(nextPresent, now2);
      else if (!isRevealed) showUnlockedNotRevealed(nextPresent);
      else showGift(nextPresent, { silent: true });
    }
  });

  // Start ticking UI
  startTick(revealedSet);
}

main().catch(err => {
  console.error(err);
  els.nextTitle.textContent = "Failed to load presents.json";
  els.hint.textContent = "Check the file path and JSON format.";
});
