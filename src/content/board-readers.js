/*
 * board-readers.js — sayfadaki satranç tahtasını DOM'dan okuyan adaptörler.
 * Her adaptör detect() ile tahtayı bulur, read() ile konumu döndürür.
 *
 * read() çıktısı:
 *   { source, pieces:{'e4':'P',...}, orientation:'white'|'black',
 *     rect:{x,y,width,height}, squareSize, lastMove:['e2','e4']|null }
 */
(function () {
  'use strict';
  const NS = (window.__chessmove = window.__chessmove || {});
  if (NS.readers) return;

  const FILES = 'abcdefgh';
  const ROLE_CHAR = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' };

  function sqName(file, rank) { return FILES[file] + (rank + 1); }

  function numbersIn(text) {
    const out = [];
    const re = /-?\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(text))) out.push(parseFloat(m[0]));
    return out;
  }

  /** Çeviri (transform) konumundan kare adı üretir. */
  function translateToSquare(x, y, size, orientation) {
    let col = Math.round(x / size);
    let row = Math.round(y / size);
    col = Math.max(0, Math.min(7, col));
    row = Math.max(0, Math.min(7, row));
    const file = orientation === 'white' ? col : 7 - col;
    const rank = orientation === 'white' ? 7 - row : row;
    return sqName(file, rank);
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  }

  /* ------------------------------ lichess ------------------------------ */
  const lichess = {
    id: 'lichess',
    label: 'Lichess',
    detect() {
      const board = document.querySelector('cg-board');
      return visible(board) ? board : null;
    },
    read(board) {
      const wrap = board.closest('cg-container') || board.closest('.cg-wrap') || board.parentElement;
      const host = board.closest('.cg-wrap') || wrap;
      const orientation = (host && host.classList.contains('orientation-black')) ? 'black' : 'white';
      const rect = rectOf(board);
      const size = rect.width / 8;
      const pieces = {};

      board.querySelectorAll('piece').forEach((el) => {
        const cls = el.className.baseVal !== undefined ? el.className.baseVal : el.className;
        const parts = String(cls).split(/\s+/);
        const color = parts.includes('white') ? 'w' : (parts.includes('black') ? 'b' : null);
        let role = null;
        for (const p of parts) if (ROLE_CHAR[p]) { role = ROLE_CHAR[p]; break; }
        if (!color || !role) return;                       // hayalet/sürüklenen taş
        if (parts.includes('ghost') || parts.includes('fading')) return;
        const n = numbersIn(el.style.transform || '');
        if (n.length < 2) return;
        const sq = translateToSquare(n[0], n[1], size, orientation);
        pieces[sq] = color === 'w' ? role.toUpperCase() : role;
      });

      const lastMove = [];
      board.querySelectorAll('square.last-move').forEach((el) => {
        const n = numbersIn(el.style.transform || '');
        if (n.length >= 2) lastMove.push(translateToSquare(n[0], n[1], size, orientation));
      });

      return {
        source: 'lichess', pieces, orientation, rect, squareSize: size,
        lastMove: lastMove.length === 2 ? lastMove : null
      };
    }
  };

  /* ----------------------------- chess.com ----------------------------- */
  const chesscom = {
    id: 'chesscom',
    label: 'Chess.com',
    detect() {
      const board = document.querySelector('wc-chess-board, chess-board, .board.board-layout-chessboard, #board-single, .board');
      return visible(board) ? board : null;
    },
    read(board) {
      const orientation = board.classList.contains('flipped') ? 'black' : 'white';
      const rect = rectOf(board);
      const size = rect.width / 8;
      const pieces = {};

      const squareClass = (el) => {
        const cls = String(el.className || '');
        const m = cls.match(/square-(\d)(\d)/);
        if (!m) return null;
        return sqName(parseInt(m[1], 10) - 1, parseInt(m[2], 10) - 1);
      };

      board.querySelectorAll('.piece, piece').forEach((el) => {
        const cls = String(el.className || '');
        const codeMatch = cls.match(/\b([wb])([kqrbnp])\b/);
        if (!codeMatch) return;
        let sq = squareClass(el);
        if (!sq) {
          const n = numbersIn(el.style.transform || '');
          if (n.length < 2) return;
          sq = translateToSquare(n[0], n[1], size, orientation);
        }
        const [, color, role] = codeMatch;
        pieces[sq] = color === 'w' ? role.toUpperCase() : role;
      });

      const lastMove = [];
      board.querySelectorAll('.highlight').forEach((el) => {
        const sq = squareClass(el);
        if (sq && !lastMove.includes(sq)) lastMove.push(sq);
      });

      return {
        source: 'chesscom', pieces, orientation, rect, squareSize: size,
        lastMove: lastMove.length === 2 ? lastMove : null
      };
    }
  };

  /* --------------------- serbest bölge (elle seçilen) ------------------- */
  const manual = {
    id: 'manual',
    label: 'Seçilen bölge',
    detect() { return NS.state && NS.state.region ? NS.state.region : null; },
    read(region) {
      return {
        source: 'manual', pieces: null, orientation: region.orientation || 'white',
        rect: { x: region.x, y: region.y, width: region.width, height: region.height },
        squareSize: region.width / 8, lastMove: null
      };
    }
  };

  const readers = [lichess, chesscom, manual];

  /** Sayfadaki ilk uygun tahtayı okur. */
  function scan(preferred) {
    const ordered = preferred ? readers.slice().sort((a) => (a.id === preferred ? -1 : 1)) : readers;
    for (const reader of ordered) {
      let target;
      try { target = reader.detect(); } catch (e) { continue; }
      if (!target) continue;
      try {
        const data = reader.read(target);
        data.element = target;
        data.label = reader.label;
        return data;
      } catch (e) { /* sıradaki adaptöre geç */ }
    }
    return null;
  }

  /* ----------------------------- geometri ------------------------------ */
  function squareCenter(rect, orientation, square) {
    const file = FILES.indexOf(square[0]);
    const rank = parseInt(square[1], 10) - 1;
    if (file < 0 || rank < 0 || rank > 7) return null;
    const size = rect.width / 8;
    const col = orientation === 'white' ? file : 7 - file;
    const row = orientation === 'white' ? 7 - rank : rank;
    return { x: rect.x + (col + 0.5) * size, y: rect.y + (row + 0.5) * size };
  }

  /** pieces sözlüğünü FEN'in taş bölümüne çevirir. */
  function piecesToFenBoard(pieces) {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = pieces[sqName(file, rank)];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
      if (empty) out += empty;
      if (rank) out += '/';
    }
    return out;
  }

  NS.readers = { lichess, chesscom, manual, scan, squareCenter, piecesToFenBoard, sqName, FILES };
})();
