/*
 * main.js — içerik betiği giriş noktası.
 * Paneldan gelen komutları yürütür, tahta değişimlerini panele bildirir.
 */
(function () {
  'use strict';
  const NS = (window.__chessmove = window.__chessmove || {});
  if (NS.booted) { NS.announce && NS.announce(); return; }
  NS.booted = true;

  NS.state = NS.state || {
    region: null,
    preferred: null,
    lastPieces: null,
    lastSignature: null,
    watching: false,
    inferredTurn: null
  };
  const S = NS.state;

  /* -------------------- konumdan FEN üretimi -------------------- */

  function isWhitePiece(ch) { return ch === ch.toUpperCase(); }

  /** İki tarama arasındaki farktan son oynayan rengi çıkarır. */
  function inferMover(prev, curr) {
    if (!prev || !curr) return null;
    const appeared = [];
    for (const sq in curr) if (prev[sq] !== curr[sq]) appeared.push(curr[sq]);
    if (!appeared.length || appeared.length > 2) return null;
    const colors = new Set(appeared.map((c) => (isWhitePiece(c) ? 'w' : 'b')));
    return colors.size === 1 ? [...colors][0] : null;
  }

  /** Sitenin işaretlediği son hamleden oynayan rengi ve geçerken alma karesini çıkarır. */
  function readLastMove(pieces, lastMove) {
    if (!lastMove || lastMove.length !== 2) return { mover: null, ep: null };
    const [a, b] = lastMove;
    const dest = pieces[b] ? b : (pieces[a] ? a : null);
    const orig = dest === b ? a : b;
    if (!dest) return { mover: null, ep: null };
    const piece = pieces[dest];
    const mover = isWhitePiece(piece) ? 'w' : 'b';
    let ep = null;
    if (piece.toLowerCase() === 'p') {
      const fromRank = parseInt(orig[1], 10), toRank = parseInt(dest[1], 10);
      if (Math.abs(toRank - fromRank) === 2 && orig[0] === dest[0]) {
        ep = dest[0] + ((fromRank + toRank) / 2);
      }
    }
    return { mover, ep };
  }

  /** Şah/kale başlangıç karelerinde mi diye bakıp rok haklarını tahmin eder. */
  function guessCastling(pieces) {
    let out = '';
    if (pieces.e1 === 'K' && pieces.h1 === 'R') out += 'K';
    if (pieces.e1 === 'K' && pieces.a1 === 'R') out += 'Q';
    if (pieces.e8 === 'k' && pieces.h8 === 'r') out += 'k';
    if (pieces.e8 === 'k' && pieces.a8 === 'r') out += 'q';
    return out || '-';
  }

  function buildFen(board, override) {
    const pieces = board.pieces;
    if (!pieces) return null;
    const site = readLastMove(pieces, board.lastMove);
    const diffMover = inferMover(S.lastPieces, pieces);
    const mover = site.mover || diffMover;

    let turn;
    if (override && (override === 'w' || override === 'b')) turn = override;
    else if (mover) turn = mover === 'w' ? 'b' : 'w';
    else if (S.inferredTurn) turn = S.inferredTurn;
    else turn = board.orientation === 'black' ? 'b' : 'w';

    S.inferredTurn = turn;
    const fen = [
      NS.readers.piecesToFenBoard(pieces),
      turn,
      guessCastling(pieces),
      site.ep || '-',
      '0', '1'
    ].join(' ');

    return { fen, turn, turnSource: override ? 'manuel' : (site.mover ? 'son hamle' : (diffMover ? 'değişim' : 'tahmin')) };
  }

  function signatureOf(board) {
    if (!board) return 'none';
    return board.source + '|' + (board.pieces ? NS.readers.piecesToFenBoard(board.pieces) : 'manual') +
      '|' + board.orientation + '|' + (board.lastMove ? board.lastMove.join('') : '');
  }

  function scan(override) {
    const board = NS.readers.scan(S.preferred);
    if (!board) return { ok: false, error: 'Bu sayfada tahta bulunamadı' };
    const built = board.pieces ? buildFen(board, override) : null;
    if (board.pieces) S.lastPieces = board.pieces;
    return {
      ok: true,
      source: board.source,
      label: board.label,
      orientation: board.orientation,
      rect: board.rect,
      squareSize: board.squareSize,
      pieces: board.pieces,
      lastMove: board.lastMove,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio || 1,
      fen: built ? built.fen : null,
      turn: built ? built.turn : null,
      turnSource: built ? built.turnSource : null,
      pieceCount: board.pieces ? Object.keys(board.pieces).length : 0
    };
  }

  /* -------------------- tahta değişimi izleme -------------------- */

  let observer = null;
  let debounce = null;

  function notifyChange() {
    const data = scan();
    if (!data.ok) return;
    const sig = signatureOf({ source: data.source, pieces: data.pieces, orientation: data.orientation, lastMove: data.lastMove });
    if (sig === S.lastSignature) return;
    S.lastSignature = sig;
    try {
      chrome.runtime.sendMessage({ channel: 'chessmove', type: 'boardChanged', data });
    } catch (e) { /* panel kapalı olabilir */ }
  }

  function startWatching() {
    if (observer) return true;
    const board = NS.readers.scan(S.preferred);
    const target = (board && board.element instanceof Element) ? board.element : document.body;
    observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(notifyChange, 140);
    });
    observer.observe(target === document.body ? document.body : (target.closest('cg-container') || target.parentElement || target), {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'transform']
    });
    S.watching = true;
    notifyChange();
    return true;
  }

  function stopWatching() {
    if (observer) { observer.disconnect(); observer = null; }
    clearTimeout(debounce);
    S.watching = false;
  }

  /* -------------------- komut yönlendirici -------------------- */

  const handlers = {
    ping: () => ({ ok: true, url: location.href, watching: S.watching }),

    scan: (msg) => scan(msg.turnOverride),

    pickRegion: async () => {
      const region = await NS.overlay.pickRegion();
      if (!region) return { ok: false, error: 'Seçim iptal edildi' };
      S.region = Object.assign(region, { orientation: 'white' });
      S.preferred = 'manual';
      NS.overlay.showRegion(S.region);
      return { ok: true, region: S.region };
    },

    clearRegion: () => {
      S.region = null;
      S.preferred = null;
      NS.overlay.hideRegion();
      return { ok: true };
    },

    setRegionOrientation: (msg) => {
      if (S.region) S.region.orientation = msg.orientation === 'black' ? 'black' : 'white';
      return { ok: true, region: S.region };
    },

    playMove: async (msg) => {
      const board = NS.readers.scan(S.preferred);
      if (!board) return { ok: false, error: 'Tahta bulunamadı' };
      NS.overlay.badge(`Oynanıyor: ${msg.san || (msg.from + msg.to)}`, 1800);
      const res = await NS.player.playMove({
        from: msg.from, to: msg.to, promo: msg.promo,
        method: msg.method || 'click',
        rect: board.rect, orientation: board.orientation,
        speed: msg.speed || 1
      });
      // oynadıktan sonra imzayı tazele ki kendi hamlemizi "değişim" sanmayalım
      setTimeout(() => {
        const d = scan();
        if (d.ok) { S.lastSignature = signatureOf(d); }
      }, 350);
      return res;
    },

    showArrow: (msg) => {
      const board = NS.readers.scan(S.preferred);
      if (!board) return { ok: false, error: 'Tahta bulunamadı' };
      NS.overlay.drawArrow(board.rect, board.orientation, msg.from, msg.to, msg.color);
      return { ok: true };
    },

    clearArrow: () => { NS.overlay.clearArrow(); return { ok: true }; },

    // ekran görüntüsü alınmadan önce/sonra kendi çizimlerimizi gizle-göster
    hideOverlays: () => { NS.overlay.setHidden(true); return { ok: true }; },
    showOverlays: () => { NS.overlay.setHidden(false); return { ok: true }; },

    badge: (msg) => { NS.overlay.badge(msg.text, msg.ms); return { ok: true }; },

    watch: (msg) => (msg.enabled ? { ok: startWatching() } : (stopWatching(), { ok: true })),

    resetTurn: () => { S.inferredTurn = null; S.lastPieces = null; return { ok: true }; }
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.channel !== 'chessmove' || !handlers[msg.type]) return;
    Promise.resolve()
      .then(() => handlers[msg.type](msg))
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;   // eşzamansız yanıt
  });

  // Test ve konsoldan hata ayıklama için iç fonksiyonlar
  NS.debug = { buildFen, inferMover, readLastMove, guessCastling, signatureOf, scan };

  NS.announce = () => {
    try { chrome.runtime.sendMessage({ channel: 'chessmove', type: 'contentReady', url: location.href }); } catch (e) {}
  };
  NS.announce();
})();
