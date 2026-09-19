/*
 * search.js — alfa-beta arama (iteratif derinleşme, transpozisyon tablosu,
 * null-move, LMR, killer/history sıralaması, sessizlik araması).
 */
(function (root) {
  'use strict';

  const C = root.ChessCore || (typeof require !== 'undefined' ? require('./chess.js') : null);
  const E = root.ChessEval || (typeof require !== 'undefined' ? require('./evaluate.js') : null);

  const { PAWN, KNIGHT, QUEEN, KING, TYPE_MASK, COLOR_MASK, WHITE,
          mFrom, mTo, mPromo, mFlags, FLAG_CAPTURE, FLAG_PROMO, moveToUci, colorIndex } = C;

  const MATE = 30000;
  const MATE_THRESHOLD = MATE - 1000;
  const INF = 40000;
  const MAX_PLY = 64;

  const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
  const PIECE_ORDER_VALUE = [0, 100, 320, 330, 500, 900, 20000];

  class Searcher {
    constructor() {
      this.tt = new Map();
      this.killers = [];
      this.history = new Int32Array(128 * 128);
      this.nodes = 0;
      this.stopAt = Infinity;
      this.aborted = false;
      this.stopFlag = null;
    }

    reset() {
      this.tt.clear();
      this.history.fill(0);
      this._lastDepth = 0;
      this.killers = [];
      for (let i = 0; i < MAX_PLY; i++) this.killers.push([0, 0]);
    }

    shouldStop() {
      if (this.aborted) return true;
      if ((this.nodes & 1023) === 0) {
        if (Date.now() >= this.stopAt) { this.aborted = true; return true; }
        if (this.stopFlag && this.stopFlag()) { this.aborted = true; return true; }
      }
      return false;
    }

    /**
     * @param {Position} pos
     * @param {{movetime?:number, depth?:number, onInfo?:Function, stopFlag?:Function}} opts
     */
    go(pos, opts) {
      opts = opts || {};
      const maxDepth = Math.min(opts.depth || 64, MAX_PLY - 2);
      const movetime = opts.movetime || 1500;
      this.reset();
      this.nodes = 0;
      this.aborted = false;
      this.stopFlag = opts.stopFlag || null;
      const started = Date.now();
      this.stopAt = started + movetime;

      const rootMoves = pos.legalMoves();
      if (!rootMoves.length) {
        const res = this._result(pos, 0, pos.inCheck() ? -MATE : 0, 0, [], started);
        res.gameOver = pos.inCheck() ? 'checkmate' : 'stalemate';
        return res;
      }
      if (rootMoves.length === 1) {
        const only = rootMoves[0];
        return this._result(pos, only, E.evaluate(pos), 1, [only], started);
      }

      let best = rootMoves[0];
      let bestScore = -INF;
      let bestPv = [best];

      for (let depth = 1; depth <= maxDepth; depth++) {
        const score = this._searchRoot(pos, depth, rootMoves);
        if (this.aborted && depth > 1) break;
        best = rootMoves[0];
        bestScore = score;
        bestPv = this._extractPv(pos, depth);
        if (opts.onInfo) {
          opts.onInfo(this._result(pos, best, bestScore, depth, bestPv, started));
        }
        if (Math.abs(score) >= MATE_THRESHOLD) break;          // mat bulundu
        if (Date.now() - started > movetime * 0.55) break;     // sonraki derinliğe vakit yok
      }

      return this._result(pos, best, bestScore, this._lastDepth || 1, bestPv, started);
    }

    _result(pos, move, score, depth, pv, started) {
      const elapsed = Math.max(1, Date.now() - started);
      const mateIn = Math.abs(score) >= MATE_THRESHOLD
        ? Math.sign(score) * Math.ceil((MATE - Math.abs(score)) / 2)
        : null;
      return {
        bestMove: move,
        best: move ? { from: C.squareName(mFrom(move)), to: C.squareName(mTo(move)), promo: mPromo(move) ? 'nbrq'[mPromo(move) - KNIGHT] : null, uci: moveToUci(move) } : null,
        san: move ? pos.moveToSan(move) : null,
        gameOver: null,
        score, mate: mateIn, depth,
        nodes: this.nodes,
        nps: Math.round(this.nodes / (elapsed / 1000)),
        time: elapsed,
        pv: pv.map(moveToUci),
        pvSan: this._pvSan(pos, pv),
        fen: pos.fen()
      };
    }

    _pvSan(pos, pv) {
      const out = [];
      let made = 0;
      for (const m of pv) {
        const legal = pos.legalMoves();
        if (!legal.includes(m)) break;
        out.push(pos.moveToSan(m));
        pos.makeMove(m); made++;
      }
      while (made--) pos.undoMove();
      return out;
    }

    _extractPv(pos, maxLen) {
      const pv = [];
      let made = 0;
      for (let i = 0; i < maxLen + 4; i++) {
        const entry = this.tt.get(pos.keyA);
        if (!entry || entry.keyB !== pos.keyB || !entry.move) break;
        const legal = pos.legalMoves();
        if (!legal.includes(entry.move)) break;
        pv.push(entry.move);
        pos.makeMove(entry.move); made++;
        if (pv.length > 32) break;
      }
      while (made--) pos.undoMove();
      return pv;
    }

    _searchRoot(pos, depth, rootMoves) {
      let alpha = -INF, beta = INF;
      let bestScore = -INF;
      let bestIdx = 0;
      const scores = new Array(rootMoves.length).fill(-INF);

      this._orderMoves(pos, rootMoves, 0, this._ttMove(pos));

      for (let i = 0; i < rootMoves.length; i++) {
        const m = rootMoves[i];
        if (!pos.makeMoveIfLegal(m)) continue;
        let score;
        if (i === 0) {
          score = -this._alphaBeta(pos, depth - 1, -beta, -alpha, 1, true);
        } else {
          score = -this._alphaBeta(pos, depth - 1, -alpha - 1, -alpha, 1, true);
          if (score > alpha && !this.aborted) score = -this._alphaBeta(pos, depth - 1, -beta, -alpha, 1, true);
        }
        pos.undoMove();
        if (this.aborted) break;
        scores[i] = score;
        if (score > bestScore) { bestScore = score; bestIdx = i; if (score > alpha) alpha = score; }
      }

      if (!this.aborted || depth === 1) {
        // en iyi hamleyi başa al; kalanları skora göre sırala (sonraki derinlik için)
        const paired = rootMoves.map((m, i) => ({ m, s: scores[i] }));
        paired.sort((a, b) => b.s - a.s);
        for (let i = 0; i < rootMoves.length; i++) rootMoves[i] = paired[i].m;
        this._storeTT(pos, depth, bestScore, TT_EXACT, paired[0].m, 0);
        this._lastDepth = depth;
      }
      return bestScore;
    }

    _ttMove(pos) {
      const e = this.tt.get(pos.keyA);
      return (e && e.keyB === pos.keyB) ? e.move : 0;
    }

    _storeTT(pos, depth, score, flag, move, ply) {
      if (this.tt.size > 400000) this.tt.clear();
      let s = score;
      if (s >= MATE_THRESHOLD) s += ply;
      else if (s <= -MATE_THRESHOLD) s -= ply;
      const prev = this.tt.get(pos.keyA);
      if (prev && prev.keyB === pos.keyB && prev.depth > depth) return;
      this.tt.set(pos.keyA, { keyB: pos.keyB, depth, score: s, flag, move });
    }

    _probeTT(pos, depth, alpha, beta, ply) {
      const e = this.tt.get(pos.keyA);
      if (!e || e.keyB !== pos.keyB) return null;
      if (e.depth < depth) return { move: e.move, score: null };
      let s = e.score;
      if (s >= MATE_THRESHOLD) s -= ply;
      else if (s <= -MATE_THRESHOLD) s += ply;
      if (e.flag === TT_EXACT) return { move: e.move, score: s };
      if (e.flag === TT_LOWER && s >= beta) return { move: e.move, score: s };
      if (e.flag === TT_UPPER && s <= alpha) return { move: e.move, score: s };
      return { move: e.move, score: null };
    }

    _orderMoves(pos, moves, ply, ttMove) {
      const b = pos.board;
      const killers = this.killers[ply] || [0, 0];
      const scored = moves.map((m) => {
        let s = 0;
        if (m === ttMove) s = 1e7;
        else {
          const flags = mFlags(m);
          if (flags & FLAG_CAPTURE) {
            const victim = b[mTo(m)] ? PIECE_ORDER_VALUE[b[mTo(m)] & TYPE_MASK] : 100;
            const attacker = PIECE_ORDER_VALUE[b[mFrom(m)] & TYPE_MASK];
            s = 1e6 + victim * 16 - attacker;
          } else if (flags & FLAG_PROMO) {
            s = 9e5 + PIECE_ORDER_VALUE[mPromo(m)];
          } else if (m === killers[0]) s = 8e5;
          else if (m === killers[1]) s = 7e5;
          else s = this.history[mFrom(m) * 128 + mTo(m)];
        }
        return { m, s };
      });
      scored.sort((a, b2) => b2.s - a.s);
      for (let i = 0; i < moves.length; i++) moves[i] = scored[i].m;
      return moves;
    }

    _hasNonPawnMaterial(pos) {
      const us = pos.turn;
      for (let s = 0; s < 128; s++) {
        if (s & 0x88) { s += 7; continue; }
        const p = pos.board[s];
        if (!p || (p & COLOR_MASK) !== us) continue;
        const t = p & TYPE_MASK;
        if (t !== PAWN && t !== KING) return true;
      }
      return false;
    }

    _isRepetition(pos) {
      // aynı zobrist anahtarının geçmişte tekrarı (basit iki-kat kontrolü)
      const h = pos.history;
      let count = 0;
      for (let i = h.length - 2; i >= 0 && i >= h.length - pos.half - 1; i -= 2) {
        if (h[i].keyA === pos.keyA && h[i].keyB === pos.keyB) { count++; if (count >= 1) return true; }
      }
      return false;
    }

    _alphaBeta(pos, depth, alpha, beta, ply, canNull) {
      if (this.shouldStop()) return 0;
      this.nodes++;

      if (ply > 0 && (pos.half >= 100 || this._isRepetition(pos))) return 0;
      if (ply >= MAX_PLY - 1) return E.evaluate(pos);

      const inCheck = pos.inCheck();
      if (inCheck) depth++;                       // şah uzatması

      if (depth <= 0) return this._quiesce(pos, alpha, beta, ply);

      const probe = this._probeTT(pos, depth, alpha, beta, ply);
      if (probe && probe.score !== null && ply > 0) return probe.score;
      const ttMove = probe ? probe.move : 0;

      const staticEval = inCheck ? -INF : E.evaluate(pos);

      // reverse futility
      if (!inCheck && depth <= 3 && Math.abs(beta) < MATE_THRESHOLD &&
          staticEval - 120 * depth >= beta) {
        return staticEval;
      }

      // null-move budama
      if (canNull && !inCheck && depth >= 3 && this._hasNonPawnMaterial(pos) &&
          staticEval >= beta) {
        const R = 2 + (depth > 6 ? 1 : 0);
        pos.makeNull();
        const score = -this._alphaBeta(pos, depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        pos.undoNull();
        if (this.aborted) return 0;
        if (score >= beta && Math.abs(score) < MATE_THRESHOLD) return beta;
      }

      const moves = pos.generateMoves(false);
      this._orderMoves(pos, moves, ply, ttMove);

      let bestScore = -INF;
      let bestMove = 0;
      let legalCount = 0;
      const origAlpha = alpha;

      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        if (!pos.makeMoveIfLegal(m)) continue;
        legalCount++;

        const isQuiet = !(mFlags(m) & (FLAG_CAPTURE | FLAG_PROMO));
        let score;

        if (legalCount === 1) {
          score = -this._alphaBeta(pos, depth - 1, -beta, -alpha, ply + 1, true);
        } else {
          // geç hamle indirimi
          let reduction = 0;
          if (depth >= 3 && isQuiet && legalCount > 3 && !inCheck) {
            reduction = 1 + Math.floor(Math.log(depth) * Math.log(legalCount) / 2.2);
            reduction = Math.min(reduction, depth - 2);
            if (reduction < 0) reduction = 0;
          }
          score = -this._alphaBeta(pos, depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
          if (score > alpha && reduction > 0) {
            score = -this._alphaBeta(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true);
          }
          if (score > alpha && score < beta) {
            score = -this._alphaBeta(pos, depth - 1, -beta, -alpha, ply + 1, true);
          }
        }
        pos.undoMove();
        if (this.aborted) return 0;

        if (score > bestScore) { bestScore = score; bestMove = m; }
        if (score > alpha) alpha = score;
        if (alpha >= beta) {
          if (isQuiet) {
            const k = this.killers[ply];
            if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
            this.history[mFrom(m) * 128 + mTo(m)] += depth * depth;
          }
          this._storeTT(pos, depth, bestScore, TT_LOWER, bestMove, ply);
          return bestScore;
        }
      }

      if (legalCount === 0) return inCheck ? -MATE + ply : 0;

      const flag = bestScore > origAlpha ? TT_EXACT : TT_UPPER;
      this._storeTT(pos, depth, bestScore, flag, bestMove, ply);
      return bestScore;
    }

    _quiesce(pos, alpha, beta, ply) {
      if (this.shouldStop()) return 0;
      this.nodes++;
      if (ply >= MAX_PLY - 1) return E.evaluate(pos);

      const inCheck = pos.inCheck();
      let best = -INF;

      if (!inCheck) {
        best = E.evaluate(pos);
        if (best >= beta) return best;
        if (best > alpha) alpha = best;
      }

      const moves = inCheck ? pos.generateMoves(false) : pos.generateMoves(true);
      this._orderMoves(pos, moves, Math.min(ply, MAX_PLY - 1), 0);

      let legal = 0;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        // delta budama
        if (!inCheck && !(mFlags(m) & FLAG_PROMO)) {
          const victim = pos.board[mTo(m)];
          const gain = victim ? PIECE_ORDER_VALUE[victim & TYPE_MASK] : 100;
          if (best + gain + 200 < alpha) continue;
        }
        if (!pos.makeMoveIfLegal(m)) continue;
        legal++;
        const score = -this._quiesce(pos, -beta, -alpha, ply + 1);
        pos.undoMove();
        if (this.aborted) return 0;
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }

      if (inCheck && legal === 0) return -MATE + ply;
      return best;
    }
  }

  const API = { Searcher, MATE, MATE_THRESHOLD };
  root.ChessSearch = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : globalThis);
