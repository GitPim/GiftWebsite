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
  openedGrid: document.getElementById("openedGrid"),
  openedCount: document.getElementById("openedCount"),
  confetti: document.getElementById("confetti"),
  subHeader: document.getElementById("subHeader"),
};

let presents = [];
let tickTimer = null;
let nextPresent = null;

function loadOpenedSet() {
  try {
    const raw = localStorage.getItem("opened_presents");
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveOpenedSet(set) {
  localStorage.setItem("opened_presents", JSON.stringify([...set]));
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

function sortPresents(ps) {
  return [...ps].sort((a,b) => new Date(a.open_at) - new Date(b.open_at));
}

function pickNextPresent(ps, now) {
  // next not yet open OR open-but-not-opened-by-user (still the “current”)
  const sorted = sortPresents(ps);
  for (const p of sorted) {
    if (new Date(p.open_at) > now) return p;
  }
  // if all times passed, show latest (or null)
  return sorted[sorted.length - 1] ?? null;
}

function renderOpenedGallery(ps, openedSet, now) {
  const opened = sortPresents(ps).filter(p => new Date(p.open_at) <= now && openedSet.has(p.image_id));
  els.openedCount.textContent = String(opened.length);
  els.openedGrid.innerHTML = "";

  // Update subheader with remaining (yet to be opened) count
  const openedByUser = ps.filter(p => openedSet.has(p.image_id)).length;
  const remaining = Math.max(0, ps.length - openedByUser);
  if (els.subHeader) {
    els.subHeader.textContent = `A new present unlocks over time. Unopened: ${remaining}`;
  }

  if (opened.length === 0) {
    els.openedGrid.innerHTML = `<div class="small">No opened presents yet.</div>`;
    return;
  }

  for (const p of opened.slice().reverse()) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.innerHTML = `
      <img src="${p.image_path}" alt="${p.title ?? p.image_id}" loading="lazy" />
      <div class="t">${p.title ?? p.image_id}</div>
      <div class="d">Opened: ${fmtDate(p.open_at)}</div>
    `;
    tile.addEventListener("click", () => showGift(p, { silent: true }));
    els.openedGrid.appendChild(tile);
  }
}

function showLocked(p, now) {
  els.nextTitle.textContent = p?.title ?? "Next present";
  els.statusPill.textContent = "Locked";
  els.presentImg.src = UNOPENED_IMAGE;
  els.openBtn.disabled = true;
  els.viewBtn.style.display = "none";
  els.revealArea.hidden = true;
  els.hint.textContent = "Come back when the timer hits zero.";
  els.openAtText.textContent = p ? `Unlocks at: ${fmtDate(p.open_at)}` : "";
  updateCountdown(p, now);
}

function showUnlockedButNotOpened(p) {
  els.nextTitle.textContent = p?.title ?? "Present";
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
  els.statusPill.textContent = "Opened";
  els.presentImg.src = UNOPENED_IMAGE;
  els.openBtn.disabled = true;
  els.viewBtn.style.display = "inline-block";
  els.revealArea.hidden = false;
  els.giftImg.src = p.image_path;
  els.openAtText.textContent = `Unlocked at: ${fmtDate(p.open_at)}`;
  els.countdown.textContent = "00:00:00";
  els.hint.textContent = silent ? "" : "Enjoy 🎉";
}

function updateCountdown(p, now) {
  if (!p) {
    els.countdown.textContent = "—";
    return;
  }
  const diff = new Date(p.open_at) - now;
  els.countdown.textContent = fmtCountdown(diff);
}

function startTick(openedSet) {
  if (tickTimer) clearInterval(tickTimer);

  tickTimer = setInterval(() => {
    const now = new Date();
    nextPresent = pickNextPresent(presents, now);

    // Always update countdown if the next present is still future
    if (nextPresent) updateCountdown(nextPresent, now);

    // Keep gallery updated
    renderOpenedGallery(presents, openedSet, now);

    if (!nextPresent) return;

    const isTime = new Date(nextPresent.open_at) <= now;
    const isOpened = openedSet.has(nextPresent.image_id);

    if (!isTime) showLocked(nextPresent, now);
    else if (!isOpened) showUnlockedButNotOpened(nextPresent);
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

  const openedSet = loadOpenedSet();

  // Load config
  const res = await fetch(PRESENTS_URL, { cache: "no-store" });
  presents = await res.json();

  // Basic validation
  presents = presents.filter(p => p && p.image_id && p.open_at && p.image_path);

  // Initial render
  const now = new Date();
  nextPresent = pickNextPresent(presents, now);
  renderOpenedGallery(presents, openedSet, now);

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
    openedSet.add(nextPresent.image_id);
    saveOpenedSet(openedSet);

    // Animate + confetti
    els.presentWrapper.classList.remove("opening");
    void els.presentWrapper.offsetWidth; // reflow
    els.presentWrapper.classList.add("opening");
    confettiBurst();

    showGift(nextPresent);
    renderOpenedGallery(presents, openedSet, now2);
  });

  els.viewBtn.addEventListener("click", () => {
    const now2 = new Date();
    renderOpenedGallery(presents, openedSet, now2);
  });

  // Start ticking UI
  startTick(openedSet);
}

main().catch(err => {
  console.error(err);
  els.nextTitle.textContent = "Failed to load presents.json";
  els.hint.textContent = "Check the file path and JSON format.";
});
