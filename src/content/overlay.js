/*
 * overlay.js — sayfa üzerine çizilen katman: bölge seçici, hamle oku, durum rozeti.
 */
(function () {
  'use strict';
  const NS = (window.__chessmove = window.__chessmove || {});
  if (NS.overlay) return;

  const Z = 2147483000;
  let styleEl = null;
  let arrowEl = null;
  let badgeEl = null;
  let badgeTimer = null;
  let repositionHooked = false;
  let lastArrow = null;

  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return;
    styleEl = document.createElement('style');
    styleEl.textContent = `
      .cm-overlay-root{position:fixed;inset:0;z-index:${Z};cursor:crosshair;background:rgba(10,12,18,.45)}
      .cm-overlay-hint{position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:${Z + 1};
        background:#111827;color:#e5e7eb;font:600 13px/1.4 system-ui,sans-serif;padding:10px 16px;
        border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);border:1px solid #374151}
      .cm-overlay-sel{position:fixed;border:2px solid #4ade80;background:rgba(74,222,128,.14);
        z-index:${Z + 1};pointer-events:none;box-shadow:0 0 0 9999px rgba(10,12,18,.35)}
      .cm-arrow{position:fixed;z-index:${Z - 10};pointer-events:none}
      .cm-badge{position:fixed;z-index:${Z + 2};background:#111827;color:#e5e7eb;
        font:600 12px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:8px;
        border:1px solid #374151;box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .2s}
    `;
    document.documentElement.appendChild(styleEl);
  }

  /* --------------------------- bölge seçici --------------------------- */
  function pickRegion() {
    ensureStyle();
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'cm-overlay-root';
      const hint = document.createElement('div');
      hint.className = 'cm-overlay-hint';
      hint.textContent = 'Tahtanın sol üst köşesinden sağ alt köşesine sürükleyin · İptal: Esc';
      const sel = document.createElement('div');
      sel.className = 'cm-overlay-sel';
      sel.style.display = 'none';

      let startX = 0, startY = 0, dragging = false;

      const cleanup = () => {
        root.remove(); hint.remove(); sel.remove();
        window.removeEventListener('keydown', onKey, true);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cleanup(); resolve(null); }
      };

      root.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true; startX = e.clientX; startY = e.clientY;
        sel.style.display = 'block';
        Object.assign(sel.style, { left: startX + 'px', top: startY + 'px', width: '0px', height: '0px' });
      });
      root.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        // tahta kare olduğu için seçimi kareye zorluyoruz
        const dx = e.clientX - startX, dy = e.clientY - startY;
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        const left = dx < 0 ? startX - size : startX;
        const top = dy < 0 ? startY - size : startY;
        Object.assign(sel.style, { left: left + 'px', top: top + 'px', width: size + 'px', height: size + 'px' });
      });
      root.addEventListener('mouseup', (e) => {
        if (!dragging) return;
        dragging = false;
        const r = sel.getBoundingClientRect();
        cleanup();
        if (r.width < 64) { resolve(null); return; }
        resolve({ x: r.left, y: r.top, width: r.width, height: r.height });
      });

      window.addEventListener('keydown', onKey, true);
      document.documentElement.append(root, hint, sel);
    });
  }

  /* ------------------------------ hamle oku --------------------------- */
  function drawArrow(rect, orientation, from, to, color) {
    ensureStyle();
    clearArrow();
    const R = NS.readers;
    const a = R.squareCenter(rect, orientation, from);
    const b = R.squareCenter(rect, orientation, to);
    if (!a || !b) return;
    lastArrow = { from, to, color };

    const pad = 40;
    const minX = Math.min(a.x, b.x) - pad, minY = Math.min(a.y, b.y) - pad;
    const w = Math.abs(a.x - b.x) + pad * 2, h = Math.abs(a.y - b.y) + pad * 2;
    const size = rect.width / 8;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cm-arrow');
    Object.assign(svg.style, { left: minX + 'px', top: minY + 'px', width: w + 'px', height: h + 'px' });
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const stroke = color || '#22c55e';
    const x1 = a.x - minX, y1 = a.y - minY, x2 = b.x - minX, y2 = b.y - minY;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(12, size * 0.32);
    const ex = x2 - Math.cos(ang) * head * 0.9;
    const ey = y2 - Math.sin(ang) * head * 0.9;

    svg.innerHTML =
      `<circle cx="${x1}" cy="${y1}" r="${size * 0.42}" fill="none" stroke="${stroke}" stroke-width="${Math.max(3, size * 0.09)}" opacity=".85"/>` +
      `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="${Math.max(4, size * 0.13)}" stroke-linecap="round" opacity=".9"/>` +
      `<polygon points="${x2},${y2} ${x2 - head * Math.cos(ang - 0.42)},${y2 - head * Math.sin(ang - 0.42)} ${x2 - head * Math.cos(ang + 0.42)},${y2 - head * Math.sin(ang + 0.42)}" fill="${stroke}" opacity=".95"/>`;

    document.documentElement.appendChild(svg);
    arrowEl = svg;
    hookReposition();
  }

  function clearArrow() {
    if (arrowEl) { arrowEl.remove(); arrowEl = null; }
    lastArrow = null;
  }

  function hookReposition() {
    if (repositionHooked) return;
    repositionHooked = true;
    const redraw = () => {
      if (!lastArrow) return;
      const board = NS.readers.scan(NS.state && NS.state.preferred);
      if (board) drawArrow(board.rect, board.orientation, lastArrow.from, lastArrow.to, lastArrow.color);
    };
    window.addEventListener('scroll', redraw, { passive: true });
    window.addEventListener('resize', redraw, { passive: true });
  }

  /* ------------------------------ rozet ------------------------------- */
  function badge(text, ms) {
    ensureStyle();
    if (!badgeEl || !badgeEl.isConnected) {
      badgeEl = document.createElement('div');
      badgeEl.className = 'cm-badge';
      document.documentElement.appendChild(badgeEl);
    }
    badgeEl.textContent = text;
    badgeEl.style.opacity = '1';
    const board = NS.readers.scan(NS.state && NS.state.preferred);
    if (board) {
      badgeEl.style.left = board.rect.x + 'px';
      badgeEl.style.top = Math.max(4, board.rect.y - 34) + 'px';
    } else {
      badgeEl.style.left = '16px';
      badgeEl.style.top = '16px';
    }
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => { if (badgeEl) badgeEl.style.opacity = '0'; }, ms || 2500);
  }

  /** Seçilen bölgenin sınırlarını kalıcı olarak gösterir. */
  let regionBox = null;
  function showRegion(region) {
    ensureStyle();
    hideRegion();
    if (!region) return;
    regionBox = document.createElement('div');
    regionBox.className = 'cm-arrow';
    Object.assign(regionBox.style, {
      left: region.x + 'px', top: region.y + 'px',
      width: region.width + 'px', height: region.height + 'px',
      border: '2px dashed rgba(74,222,128,.8)', borderRadius: '4px'
    });
    document.documentElement.appendChild(regionBox);
  }
  function hideRegion() { if (regionBox) { regionBox.remove(); regionBox = null; } }

  NS.overlay = { pickRegion, drawArrow, clearArrow, badge, showRegion, hideRegion };
})();
