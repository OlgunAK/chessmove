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
  let hidden = false;
  let badgeEl = null;
  let badgeTimer = null;
  let repositionHooked = false;
  let lastArrows = null;

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

  /* ------------------------------ hamle okları ------------------------- */
  /*
   * Birden çok aday hamle aynı anda çizilir. Her okun "kuvveti" (0..1) görsel
   * olarak üç yerde karşılık bulur: zayıf ok daha saydam, daha ince ve hedefe
   * varmadan kısa kalır. En iyi hamle en üstte ve tam boyda çizilir.
   */

  const ARROW_STYLE = {
    minLength: 0.45,    // en zayıf ok mesafenin bu kadarını kateder
    minAlpha: 0.22,
    maxAlpha: 0.95,
    minWidth: 0.065,    // kare boyuna oran
    maxWidth: 0.14,
    weakHue: 42,        // zayıf: kehribar
    strongHue: 142      // güçlü: yeşil
  };

  function arrowGeometry(a, b, weight, squareSize) {
    const t = Math.max(0, Math.min(1, weight));
    const S = ARROW_STYLE;
    const dx = b.x - a.x, dy = b.y - a.y;
    const full = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const length = full * (S.minLength + (1 - S.minLength) * t);
    const width = squareSize * (S.minWidth + (S.maxWidth - S.minWidth) * t);
    const head = Math.max(10, width * 2.4);
    const tip = { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
    const shaftEnd = {
      x: tip.x - Math.cos(angle) * head * 0.85,
      y: tip.y - Math.sin(angle) * head * 0.85
    };
    // Ok ucu başlangıç karesinin içinde kalmasın
    const start = {
      x: a.x + Math.cos(angle) * squareSize * 0.3,
      y: a.y + Math.sin(angle) * squareSize * 0.3
    };
    return {
      angle, length, width, head, tip, shaftEnd, start,
      alpha: S.minAlpha + (S.maxAlpha - S.minAlpha) * t,
      hue: S.weakHue + (S.strongHue - S.weakHue) * t
    };
  }

  /**
   * @param {Array<{from:string,to:string,weight:number,rank:number}>} list
   */
  function drawArrows(rect, orientation, list) {
    ensureStyle();
    clearArrows();
    if (!list || !list.length) return;
    lastArrows = { rect, orientation, list };

    const R = NS.readers;
    const squareSize = rect.width / 8;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cm-arrow');
    Object.assign(svg.style, {
      left: rect.x + 'px', top: rect.y + 'px',
      width: rect.width + 'px', height: rect.height + 'px'
    });
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);

    let markup = '';
    // Zayıftan güçlüye çiz ki en iyi hamle en üstte kalsın
    const ordered = list.slice().sort((x, y) => (x.weight || 0) - (y.weight || 0));
    for (const item of ordered) {
      const a = R.squareCenter(rect, orientation, item.from);
      const b = R.squareCenter(rect, orientation, item.to);
      if (!a || !b) continue;
      const o = { x: a.x - rect.x, y: a.y - rect.y };
      const d = { x: b.x - rect.x, y: b.y - rect.y };
      const g = arrowGeometry(o, d, item.weight, squareSize);
      const color = `hsl(${g.hue.toFixed(0)} 72% 48%)`;
      const alpha = g.alpha.toFixed(3);

      if (item.rank === 0) {
        markup += `<circle cx="${o.x.toFixed(1)}" cy="${o.y.toFixed(1)}" r="${(squareSize * 0.42).toFixed(1)}" `
          + `fill="none" stroke="${color}" stroke-width="${Math.max(3, squareSize * 0.08).toFixed(1)}" opacity="${alpha}"/>`;
      }
      markup += `<line x1="${g.start.x.toFixed(1)}" y1="${g.start.y.toFixed(1)}" `
        + `x2="${g.shaftEnd.x.toFixed(1)}" y2="${g.shaftEnd.y.toFixed(1)}" `
        + `stroke="${color}" stroke-width="${g.width.toFixed(1)}" stroke-linecap="round" opacity="${alpha}"/>`;
      markup += `<polygon points="${g.tip.x.toFixed(1)},${g.tip.y.toFixed(1)} `
        + `${(g.tip.x - g.head * Math.cos(g.angle - 0.4)).toFixed(1)},${(g.tip.y - g.head * Math.sin(g.angle - 0.4)).toFixed(1)} `
        + `${(g.tip.x - g.head * Math.cos(g.angle + 0.4)).toFixed(1)},${(g.tip.y - g.head * Math.sin(g.angle + 0.4)).toFixed(1)}" `
        + `fill="${color}" opacity="${alpha}"/>`;
    }

    svg.innerHTML = markup;
    document.documentElement.appendChild(svg);
    arrowEl = svg;
    if (hidden) svg.style.visibility = 'hidden';
    hookReposition();
  }

  /** Tek hamlelik kısayol (eski çağrılar ve basit kullanım için). */
  function drawArrow(rect, orientation, from, to) {
    drawArrows(rect, orientation, [{ from, to, weight: 1, rank: 0 }]);
  }

  function clearArrows() {
    if (arrowEl) { arrowEl.remove(); arrowEl = null; }
    lastArrows = null;
  }

  function hookReposition() {
    if (repositionHooked) return;
    repositionHooked = true;
    const redraw = () => {
      if (!lastArrows) return;
      const board = NS.readers.scan(NS.state && NS.state.preferred);
      if (board) drawArrows(board.rect, board.orientation, lastArrows.list);
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

  /** Ekran görüntüsü alınırken kendi çizimlerimiz kareye girmesin diye gizlenir. */
  function setHidden(value) {
    hidden = !!value;
    for (const node of [arrowEl, badgeEl, regionBox]) {
      if (node) node.style.visibility = hidden ? 'hidden' : 'visible';
    }
    return hidden;
  }

  NS.overlay = { pickRegion, drawArrows, drawArrow, clearArrows, badge, showRegion, hideRegion, setHidden, arrowGeometry, ARROW_STYLE };
})();
