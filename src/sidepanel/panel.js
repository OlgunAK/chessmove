/*
 * panel.js — yan panel arayüzü: motoru yönetir, içerik betiğiyle konuşur,
 * otomatik oynatma döngüsünü sürdürür.
 */
'use strict';

const CHANNEL = 'chessmove';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

const $ = (id) => document.getElementById(id);
const el = {
  engineLine: $('engineLine'), statusDot: $('statusDot'), statusText: $('statusText'),
  board: $('board'), evalFill: $('evalFill'),
  bestMove: $('bestMove'), evalText: $('evalText'), depthText: $('depthText'),
  nodesText: $('nodesText'), pvText: $('pvText'),
  btnScan: $('btnScan'), btnAnalyze: $('btnAnalyze'), btnPlay: $('btnPlay'),
  autoPlay: $('autoPlay'), myColor: $('myColor'), turnSel: $('turnSel'), btnFlip: $('btnFlip'),
  fenBox: $('fenBox'), btnUseFen: $('btnUseFen'), btnStartPos: $('btnStartPos'), btnCopyFen: $('btnCopyFen'),
  movetime: $('movetime'), movetimeOut: $('movetimeOut'),
  maxDepth: $('maxDepth'), maxDepthOut: $('maxDepthOut'),
  playDelay: $('playDelay'), playDelayOut: $('playDelayOut'),
  method: $('method'), showArrow: $('showArrow'), useStockfish: $('useStockfish'),
  btnPickRegion: $('btnPickRegion'), btnClearRegion: $('btnClearRegion')
};

const CONTENT_FILES = [
  'src/content/board-readers.js',
  'src/content/overlay.js',
  'src/content/player.js',
  'src/content/main.js'
];

const state = {
  tabId: null,
  board: null,          // son tarama sonucu
  fen: START_FEN,
  previewFlip: false,
  analyzing: false,
  lastResult: null,
  lastPlayedFen: null,
  lastAnalyzedFen: null,
  pending: null,
  reqId: 0,
  engine: 'builtin',
  settings: {
    movetime: 1200, maxDepth: 30, playDelay: 400,
    method: 'click', showArrow: true, autoPlay: false,
    myColor: 'auto', turnOverride: 'auto', useStockfish: false
  }
};

/* ----------------------------- motor ----------------------------- */

const worker = new Worker('../engine/worker.js');
const waiters = new Map();

worker.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'ready') { setEngineLine(msg.engine); return; }
  if (msg.type === 'engine') {
    state.engine = msg.engine;
    setEngineLine(msg.engine, msg.ok ? null : msg.message);
    return;
  }
  const w = waiters.get(msg.id);
  if (!w) return;
  if (msg.type === 'info') { w.onInfo && w.onInfo(msg); return; }
  waiters.delete(msg.id);
  if (msg.type === 'error') w.reject(new Error(msg.message));
  else w.resolve(msg);
};

function setEngineLine(engine, error) {
  const name = engine === 'stockfish' ? 'Stockfish (UCI)' : 'dahili motor';
  el.engineLine.textContent = error ? `${name} · ${error}` : `motor: ${name}`;
}

function analyze(fen, onInfo) {
  const id = ++state.reqId;
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject, onInfo });
    worker.postMessage({
      id, cmd: 'analyze', fen,
      movetime: state.settings.movetime,
      depth: state.settings.maxDepth >= 30 ? 64 : state.settings.maxDepth
    });
  });
}

async function detectStockfish() {
  if (!state.settings.useStockfish) { worker.postMessage({ cmd: 'useBuiltin' }); return; }
  const url = chrome.runtime.getURL('vendor/stockfish.js');
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) throw new Error('dosya yok');
    worker.postMessage({ cmd: 'useStockfish', url });
  } catch (err) {
    setEngineLine('builtin', 'vendor/stockfish.js bulunamadı');
    el.useStockfish.checked = false;
    state.settings.useStockfish = false;
    saveSettings();
  }
}

/* -------------------------- sekme köprüsü -------------------------- */

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function ensureContent(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: 'ping' });
    if (r && r.ok) return true;
  } catch (e) { /* betik henüz yok */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return true;
  } catch (err) {
    setStatus('err', 'Bu sayfaya erişilemiyor: ' + (err.message || err));
    return false;
  }
}

async function send(type, payload) {
  const tab = await activeTab();
  if (!tab || !tab.id) { setStatus('err', 'Etkin sekme yok'); return null; }
  if (!/^https?:|^file:/.test(tab.url || '')) {
    setStatus('err', 'Bu sayfa türünde çalışılamaz');
    return null;
  }
  state.tabId = tab.id;
  if (!await ensureContent(tab.id)) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, Object.assign({ channel: CHANNEL, type }, payload || {}));
  } catch (err) {
    setStatus('err', 'İletişim hatası: ' + (err.message || err));
    return null;
  }
}

/* ----------------------------- arayüz ----------------------------- */

function setStatus(kind, text) {
  el.statusDot.className = 'dot ' + (kind || '');
  el.statusText.textContent = text;
}

function renderBoard(fen, best) {
  const rows = fen.split(' ')[0].split('/');
  const grid = [];
  for (const row of rows) {
    const line = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) line.push(null);
      else line.push(ch);
    }
    grid.push(line);
  }
  const flip = state.previewFlip;
  el.board.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rank = flip ? r : 7 - r;         // grid[0] = 8. yatay
      const file = flip ? 7 - f : f;
      const piece = grid[7 - rank] ? grid[7 - rank][file] : null;
      const name = 'abcdefgh'[file] + (rank + 1);
      const d = document.createElement('div');
      d.className = 'sq ' + ((file + rank) % 2 ? 'l' : 'd');
      if (best && best.from === name) d.classList.add('from');
      if (best && best.to === name) d.classList.add('to');
      if (piece) {
        const sp = document.createElement('span');
        sp.className = 'p ' + (piece === piece.toUpperCase() ? 'w' : 'b');
        sp.textContent = GLYPH[piece];
        d.appendChild(sp);
      }
      el.board.appendChild(d);
    }
  }
}

function winProbability(cp) { return 1 / (1 + Math.pow(10, -cp / 400)); }

function renderResult(res, partial) {
  if (!res) return;
  const whitePov = (state.fen.split(' ')[1] === 'w') ? 1 : -1;
  const cp = res.score * whitePov;

  if (res.mate != null && res.mate !== 0) {
    const m = Math.abs(res.mate) * (res.mate > 0 ? whitePov : -whitePov);
    el.evalText.textContent = 'M' + Math.abs(res.mate) + (m > 0 ? ' (beyaz)' : ' (siyah)');
    el.evalFill.style.height = (res.mate * whitePov > 0 ? 100 : 0) + '%';
  } else {
    el.evalText.textContent = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
    el.evalFill.style.height = (winProbability(cp) * 100).toFixed(1) + '%';
  }

  el.bestMove.textContent = res.san || (res.best ? res.best.uci : '—');
  el.depthText.textContent = 'd' + (res.depth || 0);
  el.nodesText.textContent = formatNodes(res.nodes) + ' · ' + formatNodes(res.nps) + '/sn';
  const line = (res.pvSan && res.pvSan.length) ? res.pvSan.join(' ') : (res.pv || []).join(' ');
  el.pvText.textContent = line;
  if (!partial) renderBoard(state.fen, res.best);
}

function formatNodes(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

/* --------------------------- iş akışları --------------------------- */

async function doScan(quiet) {
  const data = await send('scan', { turnOverride: state.settings.turnOverride === 'auto' ? null : state.settings.turnOverride });
  if (!data) return null;
  if (!data.ok) { setStatus('warn', data.error || 'Tahta bulunamadı'); return null; }
  state.board = data;

  if (data.fen) {
    state.fen = data.fen;
    el.fenBox.value = data.fen;
    state.previewFlip = data.orientation === 'black';
    renderBoard(state.fen, state.lastResult && state.lastResult.fen === state.fen ? state.lastResult.best : null);
    const turnName = data.turn === 'w' ? 'beyaz' : 'siyah';
    setStatus('ok', `${data.label} · ${data.pieceCount} taş · sıra ${turnName} (${data.turnSource})`);
  } else {
    setStatus('warn', `${data.label} · konumu FEN kutusuna girin`);
  }
  if (!quiet) await send('watch', { enabled: true });
  return data;
}

async function doAnalyze(fenArg) {
  if (state.analyzing) return null;
  const fen = fenArg || state.fen;
  if (!fen) { setStatus('warn', 'Önce bir konum gerekli'); return null; }
  state.analyzing = true;
  el.btnAnalyze.disabled = true;
  el.bestMove.textContent = '…';
  try {
    const res = await analyze(fen, (info) => { state.fen = fen; renderResult(info, true); });
    state.fen = fen;
    state.lastResult = res;
    state.lastAnalyzedFen = fen;
    renderResult(res, false);
    if (res.gameOver) {
      setStatus('warn', res.gameOver === 'checkmate' ? 'Mat — oynanacak hamle yok' : 'Pat — oynanacak hamle yok');
      return res;
    }
    if (state.settings.showArrow && res.best) {
      await send('showArrow', { from: res.best.from, to: res.best.to });
    }
    return res;
  } catch (err) {
    setStatus('err', 'Analiz hatası: ' + (err.message || err));
    return null;
  } finally {
    state.analyzing = false;
    el.btnAnalyze.disabled = false;
  }
}

async function doPlay(res, force) {
  const r = res || state.lastResult;
  if (!r || !r.best) { setStatus('warn', 'Önce analiz edin'); return; }
  if (!force && state.lastPlayedFen === state.fen) { setStatus('warn', 'Bu konumda hamle zaten oynandı'); return; }
  state.lastPlayedFen = state.fen;
  const out = await send('playMove', {
    from: r.best.from, to: r.best.to, promo: r.best.promo,
    san: r.san, method: state.settings.method
  });
  if (out && out.ok) {
    setStatus('ok', `Oynandı: ${r.san || r.best.uci}`);
    await send('clearArrow');
  } else {
    setStatus('err', 'Hamle oynanamadı' + (out && out.error ? ': ' + out.error : ''));
  }
}

function myColorNow() {
  const c = state.settings.myColor;
  if (c === 'w' || c === 'b') return c;
  return state.board && state.board.orientation === 'black' ? 'b' : 'w';
}

let autoBusy = false;
async function autoTick(data) {
  if (!state.settings.autoPlay || autoBusy) return;
  if (!data || !data.fen) return;
  if (data.fen === state.lastPlayedFen) return;
  if (data.turn !== myColorNow()) {
    setStatus('ok', 'Rakip bekleniyor…');
    return;
  }
  autoBusy = true;
  try {
    state.board = data;
    state.fen = data.fen;
    el.fenBox.value = data.fen;
    state.previewFlip = data.orientation === 'black';
    const res = await doAnalyze(data.fen);
    if (!res || !res.best) return;
    if (state.settings.playDelay) await new Promise((r) => setTimeout(r, state.settings.playDelay));
    // gecikme sırasında konum değiştiyse vazgeç
    const fresh = await send('scan', { turnOverride: state.settings.turnOverride === 'auto' ? null : state.settings.turnOverride });
    if (fresh && fresh.ok && fresh.fen && fresh.fen.split(' ')[0] !== data.fen.split(' ')[0]) {
      setStatus('warn', 'Konum değişti, hamle iptal edildi');
      return;
    }
    await doPlay(res);
  } finally {
    autoBusy = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.channel !== CHANNEL) return;
  if (msg.type === 'command') {
    if (msg.command === 'analyze-now') doScan(true).then(() => doAnalyze());
    else if (msg.command === 'play-best') doPlay(null, true);
    return;
  }
  if (msg.type === 'boardChanged') {
    const data = msg.data;
    state.board = data;
    if (data.fen && !state.analyzing) {
      state.fen = data.fen;
      el.fenBox.value = data.fen;
      state.previewFlip = data.orientation === 'black';
      renderBoard(state.fen, null);
      const turnName = data.turn === 'w' ? 'beyaz' : 'siyah';
      setStatus('ok', `${data.label} · sıra ${turnName} (${data.turnSource})`);
    }
    autoTick(data);
  }
});

/* ----------------------------- ayarlar ----------------------------- */

function applySettingsToUi() {
  const s = state.settings;
  el.movetime.value = s.movetime;
  el.maxDepth.value = s.maxDepth;
  el.playDelay.value = s.playDelay;
  el.method.value = s.method;
  el.showArrow.checked = s.showArrow;
  el.autoPlay.checked = s.autoPlay;
  el.myColor.value = s.myColor;
  el.turnSel.value = s.turnOverride;
  el.useStockfish.checked = s.useStockfish;
  el.movetimeOut.textContent = (s.movetime / 1000).toFixed(1) + ' sn';
  el.maxDepthOut.textContent = s.maxDepth >= 30 ? 'sınırsız' : s.maxDepth;
  el.playDelayOut.textContent = (s.playDelay / 1000).toFixed(1) + ' sn';
}

function saveSettings() { chrome.storage.local.set({ settings: state.settings }); }

async function loadSettings() {
  const got = await chrome.storage.local.get('settings');
  if (got && got.settings) Object.assign(state.settings, got.settings);
  applySettingsToUi();
}

/* ------------------------------ olaylar ---------------------------- */

el.btnScan.addEventListener('click', () => doScan());
el.btnAnalyze.addEventListener('click', async () => { await doScan(true); await doAnalyze(); });
el.btnPlay.addEventListener('click', () => doPlay(null, true));

el.autoPlay.addEventListener('change', async () => {
  state.settings.autoPlay = el.autoPlay.checked;
  saveSettings();
  if (state.settings.autoPlay) {
    const data = await doScan();
    setStatus('ok', 'Otomatik mod açık');
    if (data) autoTick(data);
  } else {
    setStatus('ok', 'Otomatik mod kapalı');
  }
});

el.myColor.addEventListener('change', () => { state.settings.myColor = el.myColor.value; saveSettings(); });
el.turnSel.addEventListener('change', async () => {
  state.settings.turnOverride = el.turnSel.value;
  saveSettings();
  await send('resetTurn');
  doScan(true);
});
el.btnFlip.addEventListener('click', async () => {
  state.previewFlip = !state.previewFlip;
  renderBoard(state.fen, state.lastResult && state.lastResult.best);
  if (state.board && state.board.source === 'manual') {
    await send('setRegionOrientation', { orientation: state.previewFlip ? 'black' : 'white' });
  }
});

el.btnUseFen.addEventListener('click', () => {
  const fen = el.fenBox.value.trim();
  if (!fen) return;
  state.fen = fen;
  renderBoard(fen, null);
  doAnalyze(fen);
});
el.btnStartPos.addEventListener('click', () => { el.fenBox.value = START_FEN; state.fen = START_FEN; renderBoard(START_FEN, null); });
el.btnCopyFen.addEventListener('click', () => navigator.clipboard.writeText(el.fenBox.value || state.fen));

for (const [input, out, fmt, key] of [
  [el.movetime, el.movetimeOut, (v) => (v / 1000).toFixed(1) + ' sn', 'movetime'],
  [el.maxDepth, el.maxDepthOut, (v) => (v >= 30 ? 'sınırsız' : String(v)), 'maxDepth'],
  [el.playDelay, el.playDelayOut, (v) => (v / 1000).toFixed(1) + ' sn', 'playDelay']
]) {
  input.addEventListener('input', () => {
    const v = parseInt(input.value, 10);
    state.settings[key] = v;
    out.textContent = fmt(v);
    saveSettings();
  });
}

el.method.addEventListener('change', () => { state.settings.method = el.method.value; saveSettings(); });
el.showArrow.addEventListener('change', async () => {
  state.settings.showArrow = el.showArrow.checked;
  saveSettings();
  if (!state.settings.showArrow) await send('clearArrow');
});
el.useStockfish.addEventListener('change', async () => {
  state.settings.useStockfish = el.useStockfish.checked;
  saveSettings();
  await detectStockfish();
});

el.btnPickRegion.addEventListener('click', async () => {
  setStatus('warn', 'Sayfada tahtayı seçin…');
  const res = await send('pickRegion');
  if (res && res.ok) { setStatus('ok', 'Bölge seçildi — konumu FEN kutusuna girin'); doScan(true); }
  else setStatus('warn', 'Bölge seçilmedi');
});
el.btnClearRegion.addEventListener('click', async () => { await send('clearRegion'); doScan(); });

chrome.tabs.onActivated.addListener(() => { state.lastPlayedFen = null; doScan(); });

/* ------------------------------ başlangıç -------------------------- */

(async function init() {
  await loadSettings();
  renderBoard(START_FEN, null);
  await detectStockfish();
  await doScan();
})();
