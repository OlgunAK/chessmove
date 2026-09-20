/*
 * worker.js — motor iş parçacığı.
 * Dahili motoru çalıştırır; vendor/stockfish.js bırakılmışsa UCI üzerinden onu kullanır.
 *
 * Gelen mesajlar : {id, cmd:'analyze', fen, movetime, depth}
 *                  {cmd:'stop'} | {cmd:'useStockfish', url} | {cmd:'useBuiltin'}
 * Giden mesajlar : {id, type:'info'|'bestmove'|'error'|'engine', ...}
 */
'use strict';

importScripts('chess.js', 'evaluate.js', 'search.js', 'variety.js');

const C = self.ChessCore;
const S = self.ChessSearch;

const searcher = new S.Searcher();
let stopRequested = false;
let uci = null;          // {worker, ready, busy}
let engineName = 'builtin';

function post(msg) { self.postMessage(msg); }

/* ---------------- dahili motor ---------------- */

function analyzeBuiltin(req) {
  let pos;
  try {
    pos = new C.Position(req.fen);
  } catch (err) {
    post({ id: req.id, type: 'error', message: 'FEN okunamadı: ' + err.message });
    return;
  }
  stopRequested = false;
  const result = searcher.go(pos, {
    movetime: req.movetime || 1500,
    depth: req.depth || 64,
    multiPv: req.multiPv || 1,
    multiPvMargin: req.multiPvMargin || 0,
    stopFlag: () => stopRequested,
    onInfo: (info) => post(Object.assign({ id: req.id, type: 'info', engine: 'builtin' }, info))
  });
  post(Object.assign({ id: req.id, type: 'bestmove', engine: 'builtin' }, result));
}

/* ---------------- Stockfish (UCI) köprüsü ---------------- */

function scoreToObject(tokens) {
  const i = tokens.indexOf('score');
  if (i < 0) return { score: 0, mate: null };
  if (tokens[i + 1] === 'mate') {
    const n = parseInt(tokens[i + 2], 10);
    return { score: n > 0 ? 30000 - n * 2 : -30000 - n * 2, mate: n };
  }
  return { score: parseInt(tokens[i + 2], 10) || 0, mate: null };
}

function setupUci(url) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(url); } catch (err) { reject(err); return; }
    let resolved = false;
    const timer = setTimeout(() => { if (!resolved) { reject(new Error('UCI motoru yanıt vermedi')); w.terminate(); } }, 8000);
    w.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : (e.data && e.data.text) || '';
      if (line.startsWith('uciok') || line.startsWith('readyok')) {
        if (!resolved) { resolved = true; clearTimeout(timer); resolve(w); }
      }
    };
    w.onerror = (err) => { if (!resolved) { clearTimeout(timer); reject(err); } };
    w.postMessage('uci');
    w.postMessage('isready');
  });
}

/** UCI hamlesini arayüzün beklediği aday nesnesine çevirir. */
function describeUciMove(pos, uciMove, score, mate) {
  const move = pos.moveFromUci(uciMove);
  if (!move) return null;
  return {
    uci: uciMove, san: pos.moveToSan(move),
    from: C.squareName(C.mFrom(move)), to: C.squareName(C.mTo(move)),
    promo: uciMove[4] || null, score, mate
  };
}

function analyzeUci(req) {
  const pos = new C.Position(req.fen);
  const w = uci.worker;
  const multiPv = Math.max(1, req.multiPv || 1);
  const lines = new Map();          // multipv sırası → son bilgi
  let lastInfo = null;

  w.onmessage = (e) => {
    const line = typeof e.data === 'string' ? e.data : (e.data && e.data.text) || '';
    if (line.startsWith('info') && line.includes(' pv ')) {
      const t = line.split(/\s+/);
      const depth = parseInt(t[t.indexOf('depth') + 1], 10) || 0;
      const nodes = parseInt(t[t.indexOf('nodes') + 1], 10) || 0;
      const nps = parseInt(t[t.indexOf('nps') + 1], 10) || 0;
      const pv = t.slice(t.indexOf('pv') + 1);
      const sc = scoreToObject(t);
      const idx = t.indexOf('multipv') >= 0 ? parseInt(t[t.indexOf('multipv') + 1], 10) || 1 : 1;
      lines.set(idx, { depth, score: sc.score, mate: sc.mate, pv });
      if (idx === 1) {
        lastInfo = { depth, nodes, nps, pv, score: sc.score, mate: sc.mate };
        post(Object.assign({ id: req.id, type: 'info', engine: 'stockfish', fen: req.fen }, lastInfo));
      }
    } else if (line.startsWith('bestmove')) {
      const uciMove = line.split(/\s+/)[1];
      const move = uciMove && uciMove !== '(none)' ? pos.moveFromUci(uciMove) : 0;

      const candidates = [];
      for (let i = 1; i <= multiPv; i++) {
        const info = lines.get(i);
        if (!info || !info.pv.length) continue;
        const desc = describeUciMove(pos, info.pv[0], info.score, info.mate);
        if (desc && !candidates.some((c) => c.uci === desc.uci)) candidates.push(desc);
      }
      if (!candidates.length && move) {
        candidates.push(describeUciMove(pos, uciMove, (lastInfo && lastInfo.score) || 0, lastInfo && lastInfo.mate));
      }

      post(Object.assign({
        id: req.id, type: 'bestmove', engine: 'stockfish', fen: req.fen,
        bestMove: move,
        best: move ? { from: C.squareName(C.mFrom(move)), to: C.squareName(C.mTo(move)), promo: uciMove[4] || null, uci: uciMove } : null,
        san: move ? pos.moveToSan(move) : null,
        pvSan: [], candidates,
        gameOver: move ? null : (pos.inCheck() ? 'checkmate' : 'stalemate')
      }, lastInfo || { depth: 0, nodes: 0, nps: 0, pv: [], score: 0, mate: null }));
    }
  };

  w.postMessage('setoption name MultiPV value ' + multiPv);
  w.postMessage('ucinewgame');
  w.postMessage('position fen ' + req.fen);
  if (req.depth && req.depth < 64) w.postMessage('go depth ' + req.depth);
  else w.postMessage('go movetime ' + (req.movetime || 1500));
}

/* ---------------- mesaj yönlendirme ---------------- */

self.onmessage = async (e) => {
  const req = e.data || {};
  switch (req.cmd) {
    case 'analyze':
      if (uci && uci.worker) { try { analyzeUci(req); } catch (err) { post({ id: req.id, type: 'error', message: String(err) }); } }
      else analyzeBuiltin(req);
      break;

    case 'stop':
      stopRequested = true;
      if (uci && uci.worker) uci.worker.postMessage('stop');
      break;

    case 'useStockfish':
      try {
        const w = await setupUci(req.url);
        uci = { worker: w };
        engineName = 'stockfish';
        post({ type: 'engine', engine: 'stockfish', ok: true });
      } catch (err) {
        uci = null;
        engineName = 'builtin';
        post({ type: 'engine', engine: 'builtin', ok: false, message: String(err && err.message || err) });
      }
      break;

    case 'useBuiltin':
      if (uci && uci.worker) { uci.worker.terminate(); uci = null; }
      engineName = 'builtin';
      post({ type: 'engine', engine: 'builtin', ok: true });
      break;
  }
};

post({ type: 'ready', engine: engineName });
