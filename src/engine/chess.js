/*
 * chess.js — 0x88 tabanlı satranç kuralları motoru.
 * Hem Web Worker (importScripts) hem Node (require) ortamında çalışır.
 */
(function (root) {
  'use strict';

  const EMPTY = 0;
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const WHITE = 8, BLACK = 16;
  const TYPE_MASK = 7, COLOR_MASK = 24;

  const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

  const FLAG_CAPTURE = 1, FLAG_EP = 2, FLAG_CASTLE = 4, FLAG_DOUBLE = 8, FLAG_PROMO = 16;

  const KNIGHT_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
  const BISHOP_OFF = [17, 15, -17, -15];
  const ROOK_OFF = [16, -16, 1, -1];
  const KING_OFF = [17, 16, 15, 1, -1, -17, -16, -15];

  const CHAR_TO_PIECE = {
    P: PAWN | WHITE, N: KNIGHT | WHITE, B: BISHOP | WHITE,
    R: ROOK | WHITE, Q: QUEEN | WHITE, K: KING | WHITE,
    p: PAWN | BLACK, n: KNIGHT | BLACK, b: BISHOP | BLACK,
    r: ROOK | BLACK, q: QUEEN | BLACK, k: KING | BLACK
  };
  const PIECE_TO_CHAR = [];
  for (const c in CHAR_TO_PIECE) PIECE_TO_CHAR[CHAR_TO_PIECE[c]] = c;

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function fileOf(s) { return s & 15; }
  function rankOf(s) { return s >> 4; }
  function sqOf(file, rank) { return rank * 16 + file; }
  function offBoard(s) { return (s & 0x88) !== 0; }
  function squareName(s) { return String.fromCharCode(97 + fileOf(s)) + (rankOf(s) + 1); }
  function parseSquare(name) {
    if (typeof name !== 'string' || name.length < 2) return -1;
    const f = name.charCodeAt(0) - 97, r = name.charCodeAt(1) - 49;
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    return sqOf(f, r);
  }
  function opponent(color) { return color === WHITE ? BLACK : WHITE; }
  function colorIndex(color) { return color === WHITE ? 0 : 1; }

  /* ---- hamle kodlaması (32-bit int) ---- */
  function mkMove(from, to, promo, flags) {
    return (from & 0x7f) | ((to & 0x7f) << 8) | ((promo & 7) << 16) | ((flags & 31) << 19);
  }
  function mFrom(m) { return m & 0x7f; }
  function mTo(m) { return (m >> 8) & 0x7f; }
  function mPromo(m) { return (m >> 16) & 7; }
  function mFlags(m) { return (m >> 19) & 31; }

  function moveToUci(m) {
    let s = squareName(mFrom(m)) + squareName(mTo(m));
    const p = mPromo(m);
    if (p) s += 'nbrq'[p - KNIGHT];
    return s;
  }

  /* ---- Zobrist ---- */
  let _seed = 0x9e3779b9 >>> 0;
  function rnd32() {
    _seed ^= _seed << 13; _seed >>>= 0;
    _seed ^= _seed >>> 17;
    _seed ^= _seed << 5; _seed >>>= 0;
    return _seed >>> 0;
  }
  const Z_PIECE_A = new Uint32Array(32 * 128), Z_PIECE_B = new Uint32Array(32 * 128);
  for (let i = 0; i < Z_PIECE_A.length; i++) { Z_PIECE_A[i] = rnd32(); Z_PIECE_B[i] = rnd32(); }
  const Z_CASTLE_A = new Uint32Array(16), Z_CASTLE_B = new Uint32Array(16);
  for (let i = 0; i < 16; i++) { Z_CASTLE_A[i] = rnd32(); Z_CASTLE_B[i] = rnd32(); }
  const Z_EP_A = new Uint32Array(128), Z_EP_B = new Uint32Array(128);
  for (let i = 0; i < 128; i++) { Z_EP_A[i] = rnd32(); Z_EP_B[i] = rnd32(); }
  const Z_TURN_A = rnd32(), Z_TURN_B = rnd32();

  /* ---- rok hakkı maskeleri ---- */
  const CASTLE_MASK = new Uint8Array(128).fill(15);
  CASTLE_MASK[0] = 15 & ~CASTLE_WQ;
  CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
  CASTLE_MASK[7] = 15 & ~CASTLE_WK;
  CASTLE_MASK[112] = 15 & ~CASTLE_BQ;
  CASTLE_MASK[116] = 15 & ~(CASTLE_BK | CASTLE_BQ);
  CASTLE_MASK[119] = 15 & ~CASTLE_BK;

  class Position {
    constructor(fen) {
      this.board = new Int8Array(128);
      this.turn = WHITE;
      this.castling = 0;
      this.ep = -1;
      this.half = 0;
      this.full = 1;
      this.kingSq = [-1, -1];
      this.keyA = 0; this.keyB = 0;
      this.history = [];
      this.setFen(fen || START_FEN);
    }

    clone() {
      const p = new Position(this.fen());
      return p;
    }

    setFen(fen) {
      const parts = String(fen).trim().split(/\s+/);
      this.board.fill(EMPTY);
      this.history.length = 0;
      this.kingSq[0] = this.kingSq[1] = -1;

      let rank = 7, file = 0;
      for (const ch of parts[0]) {
        if (ch === '/') { rank--; file = 0; continue; }
        if (ch >= '1' && ch <= '8') { file += ch.charCodeAt(0) - 48; continue; }
        const piece = CHAR_TO_PIECE[ch];
        if (piece === undefined) throw new Error('Geçersiz FEN taşı: ' + ch);
        const s = sqOf(file, rank);
        this.board[s] = piece;
        if ((piece & TYPE_MASK) === KING) this.kingSq[colorIndex(piece & COLOR_MASK)] = s;
        file++;
      }

      this.turn = (parts[1] === 'b') ? BLACK : WHITE;

      this.castling = 0;
      const rights = parts[2] || '-';
      if (rights.includes('K')) this.castling |= CASTLE_WK;
      if (rights.includes('Q')) this.castling |= CASTLE_WQ;
      if (rights.includes('k')) this.castling |= CASTLE_BK;
      if (rights.includes('q')) this.castling |= CASTLE_BQ;

      this.ep = (parts[3] && parts[3] !== '-') ? parseSquare(parts[3]) : -1;
      this.half = parts[4] ? parseInt(parts[4], 10) || 0 : 0;
      this.full = parts[5] ? parseInt(parts[5], 10) || 1 : 1;

      this.recomputeKey();
      return this;
    }

    fen() {
      let out = '';
      for (let rank = 7; rank >= 0; rank--) {
        let empty = 0;
        for (let file = 0; file < 8; file++) {
          const p = this.board[sqOf(file, rank)];
          if (p === EMPTY) { empty++; continue; }
          if (empty) { out += empty; empty = 0; }
          out += PIECE_TO_CHAR[p];
        }
        if (empty) out += empty;
        if (rank) out += '/';
      }
      let rights = '';
      if (this.castling & CASTLE_WK) rights += 'K';
      if (this.castling & CASTLE_WQ) rights += 'Q';
      if (this.castling & CASTLE_BK) rights += 'k';
      if (this.castling & CASTLE_BQ) rights += 'q';
      out += ' ' + (this.turn === WHITE ? 'w' : 'b');
      out += ' ' + (rights || '-');
      out += ' ' + (this.ep >= 0 ? squareName(this.ep) : '-');
      out += ' ' + this.half + ' ' + this.full;
      return out;
    }

    recomputeKey() {
      let a = 0, b = 0;
      for (let s = 0; s < 128; s++) {
        if (s & 0x88) { s += 7; continue; }
        const p = this.board[s];
        if (!p) continue;
        const i = p * 128 + s;
        a ^= Z_PIECE_A[i]; b ^= Z_PIECE_B[i];
      }
      a ^= Z_CASTLE_A[this.castling]; b ^= Z_CASTLE_B[this.castling];
      if (this.ep >= 0) { a ^= Z_EP_A[this.ep]; b ^= Z_EP_B[this.ep]; }
      if (this.turn === BLACK) { a ^= Z_TURN_A; b ^= Z_TURN_B; }
      this.keyA = a >>> 0; this.keyB = b >>> 0;
    }

    _xorPiece(piece, s) {
      const i = piece * 128 + s;
      this.keyA = (this.keyA ^ Z_PIECE_A[i]) >>> 0;
      this.keyB = (this.keyB ^ Z_PIECE_B[i]) >>> 0;
    }

    isAttacked(s, by) {
      const b = this.board;
      // piyonlar
      if (by === WHITE) {
        let t = s - 17; if (!(t & 0x88) && t >= 0 && b[t] === (PAWN | WHITE)) return true;
        t = s - 15; if (!(t & 0x88) && t >= 0 && b[t] === (PAWN | WHITE)) return true;
      } else {
        let t = s + 17; if (!(t & 0x88) && t < 128 && b[t] === (PAWN | BLACK)) return true;
        t = s + 15; if (!(t & 0x88) && t < 128 && b[t] === (PAWN | BLACK)) return true;
      }
      // at
      for (let i = 0; i < 8; i++) {
        const t = s + KNIGHT_OFF[i];
        if (t < 0 || t > 127 || (t & 0x88)) continue;
        if (b[t] === (KNIGHT | by)) return true;
      }
      // şah
      for (let i = 0; i < 8; i++) {
        const t = s + KING_OFF[i];
        if (t < 0 || t > 127 || (t & 0x88)) continue;
        if (b[t] === (KING | by)) return true;
      }
      // fil / vezir çaprazları
      for (let i = 0; i < 4; i++) {
        const d = BISHOP_OFF[i];
        for (let t = s + d; !(t & 0x88) && t >= 0 && t < 128; t += d) {
          const p = b[t];
          if (!p) continue;
          if ((p & COLOR_MASK) === by) {
            const ty = p & TYPE_MASK;
            if (ty === BISHOP || ty === QUEEN) return true;
          }
          break;
        }
      }
      // kale / vezir düzlükleri
      for (let i = 0; i < 4; i++) {
        const d = ROOK_OFF[i];
        for (let t = s + d; !(t & 0x88) && t >= 0 && t < 128; t += d) {
          const p = b[t];
          if (!p) continue;
          if ((p & COLOR_MASK) === by) {
            const ty = p & TYPE_MASK;
            if (ty === ROOK || ty === QUEEN) return true;
          }
          break;
        }
      }
      return false;
    }

    inCheck(color) {
      const c = color === undefined ? this.turn : color;
      const ks = this.kingSq[colorIndex(c)];
      if (ks < 0) return false;
      return this.isAttacked(ks, opponent(c));
    }

    generateMoves(capturesOnly) {
      const list = [];
      const b = this.board, us = this.turn, them = opponent(us);

      for (let s = 0; s < 128; s++) {
        if (s & 0x88) { s += 7; continue; }
        const p = b[s];
        if (!p || (p & COLOR_MASK) !== us) continue;
        const type = p & TYPE_MASK;

        if (type === PAWN) {
          const fwd = us === WHITE ? 16 : -16;
          const startRank = us === WHITE ? 1 : 6;
          const promoRank = us === WHITE ? 6 : 1;
          const onPromoRank = rankOf(s) === promoRank;

          if (!capturesOnly || onPromoRank) {
            const t1 = s + fwd;
            if (!(t1 & 0x88) && t1 >= 0 && t1 < 128 && b[t1] === EMPTY) {
              if (onPromoRank) {
                list.push(mkMove(s, t1, QUEEN, FLAG_PROMO));
                list.push(mkMove(s, t1, ROOK, FLAG_PROMO));
                list.push(mkMove(s, t1, BISHOP, FLAG_PROMO));
                list.push(mkMove(s, t1, KNIGHT, FLAG_PROMO));
              } else if (!capturesOnly) {
                list.push(mkMove(s, t1, 0, 0));
                const t2 = s + 2 * fwd;
                if (rankOf(s) === startRank && b[t2] === EMPTY) list.push(mkMove(s, t2, 0, FLAG_DOUBLE));
              }
            }
          }
          for (let k = 0; k < 2; k++) {
            const t = s + fwd + (k === 0 ? -1 : 1);
            if (t < 0 || t > 127 || (t & 0x88)) continue;
            const tp = b[t];
            if (tp && (tp & COLOR_MASK) === them) {
              if (onPromoRank) {
                list.push(mkMove(s, t, QUEEN, FLAG_PROMO | FLAG_CAPTURE));
                list.push(mkMove(s, t, ROOK, FLAG_PROMO | FLAG_CAPTURE));
                list.push(mkMove(s, t, BISHOP, FLAG_PROMO | FLAG_CAPTURE));
                list.push(mkMove(s, t, KNIGHT, FLAG_PROMO | FLAG_CAPTURE));
              } else {
                list.push(mkMove(s, t, 0, FLAG_CAPTURE));
              }
            } else if (!tp && t === this.ep && this.ep >= 0) {
              list.push(mkMove(s, t, 0, FLAG_CAPTURE | FLAG_EP));
            }
          }
          continue;
        }

        if (type === KNIGHT || type === KING) {
          const offs = type === KNIGHT ? KNIGHT_OFF : KING_OFF;
          for (let i = 0; i < 8; i++) {
            const t = s + offs[i];
            if (t < 0 || t > 127 || (t & 0x88)) continue;
            const tp = b[t];
            if (!tp) { if (!capturesOnly) list.push(mkMove(s, t, 0, 0)); }
            else if ((tp & COLOR_MASK) === them) list.push(mkMove(s, t, 0, FLAG_CAPTURE));
          }
          continue;
        }

        const offs = type === BISHOP ? BISHOP_OFF : (type === ROOK ? ROOK_OFF : KING_OFF);
        const n = type === QUEEN ? 8 : 4;
        for (let i = 0; i < n; i++) {
          const d = offs[i];
          for (let t = s + d; t >= 0 && t < 128 && !(t & 0x88); t += d) {
            const tp = b[t];
            if (!tp) { if (!capturesOnly) list.push(mkMove(s, t, 0, 0)); continue; }
            if ((tp & COLOR_MASK) === them) list.push(mkMove(s, t, 0, FLAG_CAPTURE));
            break;
          }
        }
      }

      if (!capturesOnly) this._genCastles(list);
      return list;
    }

    _genCastles(list) {
      const b = this.board, us = this.turn, them = opponent(us);
      if (us === WHITE) {
        if ((this.castling & CASTLE_WK) && b[4] === (KING | WHITE) && b[7] === (ROOK | WHITE) &&
            b[5] === EMPTY && b[6] === EMPTY &&
            !this.isAttacked(4, them) && !this.isAttacked(5, them) && !this.isAttacked(6, them)) {
          list.push(mkMove(4, 6, 0, FLAG_CASTLE));
        }
        if ((this.castling & CASTLE_WQ) && b[4] === (KING | WHITE) && b[0] === (ROOK | WHITE) &&
            b[1] === EMPTY && b[2] === EMPTY && b[3] === EMPTY &&
            !this.isAttacked(4, them) && !this.isAttacked(3, them) && !this.isAttacked(2, them)) {
          list.push(mkMove(4, 2, 0, FLAG_CASTLE));
        }
      } else {
        if ((this.castling & CASTLE_BK) && b[116] === (KING | BLACK) && b[119] === (ROOK | BLACK) &&
            b[117] === EMPTY && b[118] === EMPTY &&
            !this.isAttacked(116, them) && !this.isAttacked(117, them) && !this.isAttacked(118, them)) {
          list.push(mkMove(116, 118, 0, FLAG_CASTLE));
        }
        if ((this.castling & CASTLE_BQ) && b[116] === (KING | BLACK) && b[112] === (ROOK | BLACK) &&
            b[113] === EMPTY && b[114] === EMPTY && b[115] === EMPTY &&
            !this.isAttacked(116, them) && !this.isAttacked(115, them) && !this.isAttacked(114, them)) {
          list.push(mkMove(116, 114, 0, FLAG_CASTLE));
        }
      }
    }

    makeMove(m) {
      const b = this.board;
      const from = mFrom(m), to = mTo(m), flags = mFlags(m), promo = mPromo(m);
      const piece = b[from];
      const us = piece & COLOR_MASK;

      const undo = {
        move: m, captured: EMPTY, capturedSq: -1,
        castling: this.castling, ep: this.ep, half: this.half, full: this.full,
        keyA: this.keyA, keyB: this.keyB
      };

      if (this.ep >= 0) {
        this.keyA = (this.keyA ^ Z_EP_A[this.ep]) >>> 0;
        this.keyB = (this.keyB ^ Z_EP_B[this.ep]) >>> 0;
      }
      this.keyA = (this.keyA ^ Z_CASTLE_A[this.castling]) >>> 0;
      this.keyB = (this.keyB ^ Z_CASTLE_B[this.castling]) >>> 0;

      if (flags & FLAG_EP) {
        const capSq = us === WHITE ? to - 16 : to + 16;
        undo.captured = b[capSq];
        undo.capturedSq = capSq;
        this._xorPiece(undo.captured, capSq);
        b[capSq] = EMPTY;
      } else if (b[to]) {
        undo.captured = b[to];
        undo.capturedSq = to;
        this._xorPiece(undo.captured, to);
      }

      this._xorPiece(piece, from);
      b[from] = EMPTY;
      const landed = promo ? (promo | us) : piece;
      b[to] = landed;
      this._xorPiece(landed, to);

      if ((piece & TYPE_MASK) === KING) this.kingSq[colorIndex(us)] = to;

      if (flags & FLAG_CASTLE) {
        let rFrom, rTo;
        if (to === 6) { rFrom = 7; rTo = 5; }
        else if (to === 2) { rFrom = 0; rTo = 3; }
        else if (to === 118) { rFrom = 119; rTo = 117; }
        else { rFrom = 112; rTo = 115; }
        const rook = b[rFrom];
        this._xorPiece(rook, rFrom);
        b[rFrom] = EMPTY;
        b[rTo] = rook;
        this._xorPiece(rook, rTo);
      }

      this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
      this.keyA = (this.keyA ^ Z_CASTLE_A[this.castling]) >>> 0;
      this.keyB = (this.keyB ^ Z_CASTLE_B[this.castling]) >>> 0;

      this.ep = (flags & FLAG_DOUBLE) ? (us === WHITE ? from + 16 : from - 16) : -1;
      if (this.ep >= 0) {
        this.keyA = (this.keyA ^ Z_EP_A[this.ep]) >>> 0;
        this.keyB = (this.keyB ^ Z_EP_B[this.ep]) >>> 0;
      }

      if ((piece & TYPE_MASK) === PAWN || undo.captured) this.half = 0; else this.half++;
      if (us === BLACK) this.full++;

      this.turn = opponent(us);
      this.keyA = (this.keyA ^ Z_TURN_A) >>> 0;
      this.keyB = (this.keyB ^ Z_TURN_B) >>> 0;

      this.history.push(undo);
      return undo;
    }

    /** Hamleyi oynar, kendi şahını açıkta bırakıyorsa geri alıp false döner. */
    makeMoveIfLegal(m) {
      const us = this.turn;
      this.makeMove(m);
      if (this.isAttacked(this.kingSq[colorIndex(us)], opponent(us))) {
        this.undoMove();
        return false;
      }
      return true;
    }

    undoMove() {
      const undo = this.history.pop();
      if (!undo) return null;
      const b = this.board;
      const m = undo.move;
      const from = mFrom(m), to = mTo(m), flags = mFlags(m), promo = mPromo(m);
      const landed = b[to];
      const us = landed & COLOR_MASK;

      b[from] = promo ? (PAWN | us) : landed;
      b[to] = EMPTY;
      if ((b[from] & TYPE_MASK) === KING) this.kingSq[colorIndex(us)] = from;

      if (undo.capturedSq >= 0) b[undo.capturedSq] = undo.captured;

      if (flags & FLAG_CASTLE) {
        let rFrom, rTo;
        if (to === 6) { rFrom = 7; rTo = 5; }
        else if (to === 2) { rFrom = 0; rTo = 3; }
        else if (to === 118) { rFrom = 119; rTo = 117; }
        else { rFrom = 112; rTo = 115; }
        b[rFrom] = b[rTo];
        b[rTo] = EMPTY;
      }

      this.castling = undo.castling;
      this.ep = undo.ep;
      this.half = undo.half;
      this.full = undo.full;
      this.keyA = undo.keyA;
      this.keyB = undo.keyB;
      this.turn = us;
      return undo;
    }

    makeNull() {
      const undo = {
        move: 0, captured: EMPTY, capturedSq: -1, nullMove: true,
        castling: this.castling, ep: this.ep, half: this.half, full: this.full,
        keyA: this.keyA, keyB: this.keyB
      };
      if (this.ep >= 0) {
        this.keyA = (this.keyA ^ Z_EP_A[this.ep]) >>> 0;
        this.keyB = (this.keyB ^ Z_EP_B[this.ep]) >>> 0;
      }
      this.ep = -1;
      this.half++;
      this.turn = opponent(this.turn);
      this.keyA = (this.keyA ^ Z_TURN_A) >>> 0;
      this.keyB = (this.keyB ^ Z_TURN_B) >>> 0;
      this.history.push(undo);
    }

    undoNull() {
      const undo = this.history.pop();
      this.castling = undo.castling;
      this.ep = undo.ep;
      this.half = undo.half;
      this.full = undo.full;
      this.keyA = undo.keyA;
      this.keyB = undo.keyB;
      this.turn = opponent(this.turn);
    }

    legalMoves() {
      const pseudo = this.generateMoves(false);
      const out = [];
      for (let i = 0; i < pseudo.length; i++) {
        if (this.makeMoveIfLegal(pseudo[i])) { out.push(pseudo[i]); this.undoMove(); }
      }
      return out;
    }

    /** 'e2e4' / 'e7e8q' veya {from,to,promo} biçimini iç hamleye çevirir. */
    moveFromUci(uci) {
      const text = typeof uci === 'string' ? uci
        : (uci.from + uci.to + (uci.promo || ''));
      const from = parseSquare(text.slice(0, 2));
      const to = parseSquare(text.slice(2, 4));
      const promoChar = text[4];
      const promo = promoChar ? { n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN }[promoChar.toLowerCase()] : 0;
      for (const m of this.legalMoves()) {
        if (mFrom(m) === from && mTo(m) === to && (!promo || mPromo(m) === promo)) {
          if (mPromo(m) && !promo && mPromo(m) !== QUEEN) continue;
          return m;
        }
      }
      return 0;
    }

    moveToSan(m) {
      const legal = this.legalMoves();
      if (!legal.includes(m)) return moveToUci(m);
      const from = mFrom(m), to = mTo(m), flags = mFlags(m), promo = mPromo(m);
      const piece = this.board[from];
      const type = piece & TYPE_MASK;
      let san;

      if (flags & FLAG_CASTLE) {
        san = (to === 6 || to === 118) ? 'O-O' : 'O-O-O';
      } else if (type === PAWN) {
        san = (flags & FLAG_CAPTURE) ? squareName(from)[0] + 'x' + squareName(to) : squareName(to);
        if (promo) san += '=' + 'NBRQ'[promo - KNIGHT];
      } else {
        let sameFile = false, sameRank = false, ambiguous = false;
        for (const o of legal) {
          if (o === m) continue;
          if (mTo(o) !== to) continue;
          if (this.board[mFrom(o)] !== piece) continue;
          ambiguous = true;
          if (fileOf(mFrom(o)) === fileOf(from)) sameFile = true;
          if (rankOf(mFrom(o)) === rankOf(from)) sameRank = true;
        }
        let disamb = '';
        if (ambiguous) {
          if (!sameFile) disamb = squareName(from)[0];
          else if (!sameRank) disamb = squareName(from)[1];
          else disamb = squareName(from);
        }
        san = 'NBRQK'[type - KNIGHT] + disamb + ((flags & FLAG_CAPTURE) ? 'x' : '') + squareName(to);
      }

      this.makeMove(m);
      if (this.inCheck(this.turn)) san += this.legalMoves().length ? '+' : '#';
      this.undoMove();
      return san;
    }

    /** Oyun bitti mi: 'checkmate' | 'stalemate' | 'fifty' | 'material' | null */
    gameOver() {
      if (this.legalMoves().length === 0) return this.inCheck(this.turn) ? 'checkmate' : 'stalemate';
      if (this.half >= 100) return 'fifty';
      let pieces = 0, minors = 0;
      for (let s = 0; s < 128; s++) {
        if (s & 0x88) { s += 7; continue; }
        const p = this.board[s];
        if (!p) continue;
        const t = p & TYPE_MASK;
        if (t === PAWN || t === ROOK || t === QUEEN) return null;
        if (t !== KING) minors++;
        pieces++;
      }
      return minors <= 1 ? 'material' : null;
    }
  }

  function perft(pos, depth) {
    if (depth === 0) return 1;
    let nodes = 0;
    const moves = pos.generateMoves(false);
    for (let i = 0; i < moves.length; i++) {
      if (!pos.makeMoveIfLegal(moves[i])) continue;
      nodes += depth === 1 ? 1 : perft(pos, depth - 1);
      pos.undoMove();
    }
    return nodes;
  }

  const API = {
    EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
    TYPE_MASK, COLOR_MASK,
    CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
    FLAG_CAPTURE, FLAG_EP, FLAG_CASTLE, FLAG_DOUBLE, FLAG_PROMO,
    START_FEN, Position, perft,
    mkMove, mFrom, mTo, mPromo, mFlags, moveToUci,
    squareName, parseSquare, fileOf, rankOf, sqOf, offBoard, opponent, colorIndex,
    PIECE_TO_CHAR, CHAR_TO_PIECE
  };

  root.ChessCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : globalThis);
