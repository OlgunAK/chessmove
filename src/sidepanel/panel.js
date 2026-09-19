/*
 * panel.js — yan panel arayüzü.
 *
 * Üç işi birlikte yürütür:
 *  1) konumu okur (site DOM'undan ya da ekran görüntüsünden tanıyarak),
 *  2) motoru çalıştırıp en iyi hamleyi bulur,
 *  3) otomatik modda hamleyi oynar ve hemen bir sonraki konumu analiz etmeye döner.
 */
'use strict';

const CHANNEL = 'chessmove';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const CAPTURE_MIN_GAP = 550;        // captureVisibleTab saniyede iki çağrıyla sınırlı
const CAPTURE_SIZE = 512;

const $ = (id) => document.getElementById(id);
const el = {
  engineLine: $('engineLine'), statusDot: $('statusDot'), statusText: $('statusText'),
  board: $('board'), evalFill: $('evalFill'),
  bestMove: $('bestMove'), evalText: $('evalText'), depthText: $('depthText'),
  nodesText: $('nodesText'), pvText: $('pvText'),
  btnScan: $('btnScan'), btnAnalyze: $('btnAnalyze'), btnPlay: $('btnPlay'),
  autoPlay: $('autoPlay'), myColor: $('myColor'), liveAnalysis: $('liveAnalysis'), loopState: $('loopState'),
  turnSel: $('turnSel'), btnFlip: $('btnFlip'),
  fenBox: $('fenBox'), btnUseFen: $('btnUseFen'), btnStartPos: $('btnStartPos'), btnCopyFen: $('btnCopyFen'),
  btnCalibrate: $('btnCalibrate'), calibSource: $('calibSource'), btnRecognize: $('btnRecognize'),
  btnResetTemplates: $('btnResetTemplates'), useVision: $('useVision'), visionState: $('visionState'),
  movetime: $('movetime'), movetimeOut: $('movetimeOut'),
  maxDepth: $('maxDepth'), maxDepthOut: $('maxDepthOut'),
  playDelay: $('playDelay'), playDelayOut: $('playDelayOut'),
  scanInterval: $('scanInterval'), scanIntervalOut: $('scanIntervalOut'),
  method: $('method'), showArrow: $('showArrow'), useStockfish: $('useStockfish'),
  btnPickRegion: $('btnPickRegion'), btnClearRegion: $('btnClearRegion'),
  captureCanvas: $('captureCanvas')
};

const CONTENT_FILES = [
  'src/content/board-readers.js',
  'src/content/overlay.js',
  'src/content/player.js',
  'src/content/main.js'
];

const V = self.ChessVision;

const state = {
  tabId: null,
  origin: null,
  board: null,
  fen: START_FEN,
  previewFlip: false,
  lowSquares: null,
  analyzing: false,
  lastResult: null,
  lastPlayedFen: null,
  lastAnalyzed: null,
  reqId: 0,
  engine: 'builtin',
  templates: null,
  visionPrev: null,
  visionTurn: null,
  lastCapture: 0,
  loopTimer: null,
  loopBusy: false,
  waitingSince: 0,
  settings: {
    movetime: 1200, maxDepth: 30, playDelay: 400, scanInterval: 700,
    method: 'click', showArrow: true, autoPlay: false, liveAnalysis: true,
    myColor: 'auto', turnOverride: 'auto', useStockfish: false, useVision: false
  }
};

/* ------------------------------- motor ------------------------------- */

const worker = new Worker('../engine/worker.js');
const waiters = new Map();

worker.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'ready') { setEngineLine(msg.engine); return; }
  if (msg.type === 'engine') { state.engine = msg.engine; setEngineLine(msg.engine, msg.ok ? null : msg.message); return; }
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

function analyze(fen, movetime, onInfo) {
  const id = ++state.reqId;
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject, onInfo });
    worker.postMessage({
      id, cmd: 'analyze', fen,
      movetime: movetime || state.settings.movetime,
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

/* ---------------------------- sekme köprüsü ---------------------------- */

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function ensureContent(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { channel: CHANNEL, type: 'ping' });
    if (r && r.ok) return true;
  } catch (e) { /* betik henüz enjekte edilmemiş */ }
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
  if (!/^https?:|^file:/.test(tab.url || '')) { setStatus('err', 'Bu sayfa türünde çalışılamaz'); return null; }
  if (state.tabId !== tab.id) { state.tabId = tab.id; await setOrigin(tab.url); }
  if (!await ensureContent(tab.id)) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, Object.assign({ channel: CHANNEL, type }, payload || {}));
  } catch (err) {
    setStatus('err', 'İletişim hatası: ' + (err.message || err));
    return null;
  }
}

/* --------------------- ekran görüntüsünden tanıma --------------------- */

async function setOrigin(url) {
  let origin;
  try { origin = new URL(url).origin; } catch (e) { origin = 'bilinmeyen'; }
  if (origin === state.origin) return;
  state.origin = origin;
  state.visionPrev = null;
  const got = await chrome.storage.local.get('tpl:' + origin);
  state.templates = got['tpl:' + origin] || null;
  if (state.templates && state.templates.version !== V.TEMPLATE_VERSION) state.templates = null;
  renderVisionState();
}

function renderVisionState() {
  const t = state.templates;
  if (!t || !t.samples) {
    el.visionState.textContent = `${state.origin || 'bu site'} için kalibre edilmedi`;
    return;
  }
  const kinds = Object.keys(t.byPiece).length;
  el.visionState.textContent = `${state.origin} · ${kinds}/12 taş türü · ${t.samples} örnek`;
}

async function saveTemplates() {
  if (!state.origin) return;
  await chrome.storage.local.set({ ['tpl:' + state.origin]: state.templates });
  renderVisionState();
}

/** Etkin sekmenin görünen alanını yakalayıp tahtayı kare biçiminde kırpar. */
async function captureBoardImage() {
  const board = await send('scan', { turnOverride: null });
  if (!board || !board.ok) return { error: (board && board.error) || 'Tahta bulunamadı' };
  const r = board.rect;
  const vp = board.viewport;
  if (!vp) return { error: 'Görünüm bilgisi alınamadı' };
  if (r.x < -1 || r.y < -1 || r.x + r.width > vp.width + 1 || r.y + r.height > vp.height + 1) {
    return { error: 'Tahtanın tamamı ekranda görünmüyor — sayfayı kaydırın' };
  }

  const wait = CAPTURE_MIN_GAP - (Date.now() - state.lastCapture);
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));

  const tab = await activeTab();
  await send('hideOverlays');
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (err) {
    await send('showOverlays');
    return { error: 'Ekran görüntüsü alınamadı: ' + (err.message || err) };
  }
  state.lastCapture = Date.now();
  await send('showOverlays');

  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = bitmap.width / vp.width;
  const ctx = el.captureCanvas.getContext('2d', { willReadFrequently: true });
  el.captureCanvas.width = CAPTURE_SIZE;
  el.captureCanvas.height = CAPTURE_SIZE;
  const side = Math.min(r.width, r.height) * scale;
  ctx.drawImage(bitmap, r.x * scale, r.y * scale, side, side, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
  bitmap.close();

  return { image: ctx.getImageData(0, 0, CAPTURE_SIZE, CAPTURE_SIZE), board };
}

/** Ekran görüntüsünü çözümleyip taş sözlüğü üretir. */
async function recognizeFromScreen() {
  const cap = await captureBoardImage();
  if (cap.error) return { ok: false, error: cap.error };
  const analysis = V.analyzeBoard(cap.image, cap.board.orientation);
  if (!state.templates || !state.templates.samples) {
    return { ok: false, error: 'Önce kalibre edin', analysis, board: cap.board };
  }
  const result = V.classify(analysis, state.templates);
  const low = Object.keys(result.perSquare).filter((n) => result.perSquare[n].confidence < 0.12);
  return {
    ok: true, pieces: result.pieces, confidence: result.confidence,
    low, analysis, board: cap.board, occupied: analysis.occupied
  };
}

async function calibrate() {
  const source = el.calibSource.value;
  const fen = source === 'start' ? START_FEN : (el.fenBox.value.trim() || state.fen);
  const pieces = V.fenToPieces(fen);
  if (!Object.keys(pieces).length) { setStatus('warn', 'Kalibrasyon için geçerli bir konum gerekli'); return; }

  const cap = await captureBoardImage();
  if (cap.error) { setStatus('err', cap.error); return; }
  const analysis = V.analyzeBoard(cap.image, cap.board.orientation);
  const res = V.learn(analysis, pieces, state.templates);
  state.templates = res.templates;
  await saveTemplates();

  if (res.mismatched) {
    setStatus('warn', `Kalibre edildi ama ${res.mismatched} kare uyuşmadı — tahtadaki konum seçtiğinizle aynı mı?`);
  } else {
    setStatus('ok', `Kalibre edildi: ${res.learned} taş öğrenildi`);
  }
}

/* --------------------- konumdan FEN (ekran modu) --------------------- */

function isWhite(ch) { return ch === ch.toUpperCase(); }

/** İki tarama arasındaki farktan son oynayan rengi çıkarır. */
function inferMover(prev, curr) {
  if (!prev || !curr) return null;
  const appeared = [];
  for (const sq in curr) if (prev[sq] !== curr[sq]) appeared.push(curr[sq]);
  if (!appeared.length || appeared.length > 2) return null;
  const colors = new Set(appeared.map((c) => (isWhite(c) ? 'w' : 'b')));
  return colors.size === 1 ? [...colors][0] : null;
}

/** İki kare ilerleyen piyondan geçerken alma karesini çıkarır. */
function inferEp(prev, curr) {
  if (!prev) return '-';
  for (const sq in curr) {
    const piece = curr[sq];
    if (piece.toLowerCase() !== 'p' || prev[sq] === piece) continue;
    const file = sq[0], rank = +sq[1];
    const fromRank = isWhite(piece) ? 2 : 7;
    const midRank = isWhite(piece) ? 3 : 6;
    if (rank !== (isWhite(piece) ? 4 : 5)) continue;
    if (prev[file + fromRank] === piece && !curr[file + fromRank]) return file + midRank;
  }
  return '-';
}

function guessCastling(pieces) {
  let out = '';
  if (pieces.e1 === 'K' && pieces.h1 === 'R') out += 'K';
  if (pieces.e1 === 'K' && pieces.a1 === 'R') out += 'Q';
  if (pieces.e8 === 'k' && pieces.h8 === 'r') out += 'k';
  if (pieces.e8 === 'k' && pieces.a8 === 'r') out += 'q';
  return out || '-';
}

function buildVisionFen(pieces, orientation) {
  const mover = inferMover(state.visionPrev, pieces);
  const override = state.settings.turnOverride;
  let turn;
  if (override === 'w' || override === 'b') turn = override;
  else if (mover) turn = mover === 'w' ? 'b' : 'w';
  else if (state.visionTurn) turn = state.visionTurn;
  else turn = orientation === 'black' ? 'b' : 'w';
  const ep = inferEp(state.visionPrev, pieces);
  state.visionTurn = turn;
  return {
    fen: [V.piecesToFenBoard(pieces), turn, guessCastling(pieces), ep, '0', '1'].join(' '),
    turn,
    turnSource: (override === 'w' || override === 'b') ? 'manuel' : (mover ? 'değişim' : 'tahmin')
  };
}

/* ---------------------------- konum okuma ---------------------------- */

/** Ayarlara göre konumu DOM'dan ya da ekrandan okur. */
async function readPosition() {
  if (state.settings.useVision) {
    const res = await recognizeFromScreen();
    if (!res.ok) return { ok: false, error: res.error };
    const built = buildVisionFen(res.pieces, res.board.orientation);
    state.visionPrev = res.pieces;
    return {
      ok: true, source: 'vision', label: 'Ekrandan okundu',
      orientation: res.board.orientation, rect: res.board.rect,
      pieces: res.pieces, fen: built.fen, turn: built.turn, turnSource: built.turnSource,
      confidence: res.confidence, low: res.low, pieceCount: Object.keys(res.pieces).length
    };
  }

  const data = await send('scan', {
    turnOverride: state.settings.turnOverride === 'auto' ? null : state.settings.turnOverride
  });
  if (!data) return { ok: false, error: 'Sayfaya ulaşılamadı' };
  if (!data.ok) return data;
  if (!data.fen) return { ok: false, error: 'Konum okunamadı — ekrandan tanımayı deneyin', board: data };
  return data;
}

/* ------------------------------- arayüz ------------------------------- */

function setStatus(kind, text) {
  el.statusDot.className = 'dot ' + (kind || '');
  el.statusText.textContent = text;
}

function setLoopState(kind, text) {
  el.loopState.className = 'loopState ' + (kind || '');
  el.loopState.textContent = text;
}

function renderBoard(fen, best, low) {
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
      const rank = flip ? r : 7 - r;
      const file = flip ? 7 - f : f;
      const piece = grid[7 - rank] ? grid[7 - rank][file] : null;
      const name = 'abcdefgh'[file] + (rank + 1);
      const d = document.createElement('div');
      d.className = 'sq ' + ((file + rank) % 2 ? 'l' : 'd');
      if (best && best.from === name) d.classList.add('from');
      if (best && best.to === name) d.classList.add('to');
      if (low && low.includes(name)) d.classList.add('low');
      if (piece) {
        const sp = document.createElement('span');
        sp.className = 'p ' + (isWhite(piece) ? 'w' : 'b');
        sp.textContent = GLYPH[piece];
        d.appendChild(sp);
      }
      el.board.appendChild(d);
    }
  }
}

function winProbability(cp) { return 1 / (1 + Math.pow(10, -cp / 400)); }

function formatNodes(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

function renderResult(res, partial) {
  if (!res) return;
  const whitePov = (state.fen.split(' ')[1] === 'w') ? 1 : -1;
  const cp = res.score * whitePov;

  if (res.mate != null && res.mate !== 0) {
    el.evalText.textContent = 'M' + Math.abs(res.mate);
    el.evalFill.style.height = (res.mate * whitePov > 0 ? 100 : 0) + '%';
  } else {
    el.evalText.textContent = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
    el.evalFill.style.height = (winProbability(cp) * 100).toFixed(1) + '%';
  }

  el.bestMove.textContent = res.san || (res.best ? res.best.uci : '—');
  el.depthText.textContent = 'd' + (res.depth || 0);
  el.nodesText.textContent = formatNodes(res.nodes) + ' · ' + formatNodes(res.nps) + '/sn';
  el.pvText.textContent = (res.pvSan && res.pvSan.length) ? res.pvSan.join(' ') : (res.pv || []).join(' ');
  if (!partial) renderBoard(state.fen, res.best, state.lowSquares);
}

function applyPosition(data) {
  state.board = data;
  state.fen = data.fen;
  state.lowSquares = data.low || null;
  el.fenBox.value = data.fen;
  state.previewFlip = data.orientation === 'black';
  renderBoard(state.fen, null, state.lowSquares);

  const turnName = data.turn === 'w' ? 'beyaz' : 'siyah';
  let text = `${data.label || 'Tahta'} · sıra ${turnName} (${data.turnSource})`;
  if (data.confidence != null) text += ` · güven %${Math.round(data.confidence * 100)}`;
  setStatus('ok', text);
}

/* ----------------------------- iş akışları ----------------------------- */

async function doScan() {
  const data = await readPosition();
  if (!data || !data.ok) { setStatus('warn', (data && data.error) || 'Tahta bulunamadı'); return null; }
  applyPosition(data);
  if (!state.settings.useVision) await send('watch', { enabled: true });
  return data;
}

async function doAnalyze(fenArg, movetime) {
  if (state.analyzing) return null;
  const fen = fenArg || state.fen;
  if (!fen) { setStatus('warn', 'Önce bir konum gerekli'); return null; }
  state.analyzing = true;
  el.btnAnalyze.disabled = true;
  setLoopState('thinking', 'düşünüyor…');
  try {
    const res = await analyze(fen, movetime, (info) => { state.fen = fen; renderResult(info, true); });
    state.fen = fen;
    state.lastResult = res;
    state.lastAnalyzed = fen;
    renderResult(res, false);
    if (res.gameOver) {
      setStatus('warn', res.gameOver === 'checkmate' ? 'Mat — oynanacak hamle yok' : 'Pat — oynanacak hamle yok');
      return res;
    }
    if (state.settings.showArrow && res.best) await send('showArrow', { from: res.best.from, to: res.best.to });
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
  if (!r || !r.best) { setStatus('warn', 'Önce analiz edin'); return false; }
  if (!force && state.lastPlayedFen === state.fen) return false;
  state.lastPlayedFen = state.fen;
  const out = await send('playMove', {
    from: r.best.from, to: r.best.to, promo: r.best.promo,
    san: r.san, method: state.settings.method
  });
  if (out && out.ok) {
    setStatus('ok', `Oynandı: ${r.san || r.best.uci}`);
    await send('clearArrow');
    return true;
  }
  setStatus('err', 'Hamle oynanamadı' + (out && out.error ? ': ' + out.error : ''));
  return false;
}

function myColorNow() {
  const c = state.settings.myColor;
  if (c === 'w' || c === 'b') return c;
  return state.board && state.board.orientation === 'black' ? 'b' : 'w';
}

/* ------------------------- sürekli çalışma döngüsü -------------------- */
/*
 * Döngü açıkken her turda konum okunur. Sıra bizdeyse analiz edilip hamle
 * oynanır ve hemen bir sonraki tura geçilir; sıra rakipteyse konum yine analiz
 * edilir (canlı değerlendirme) ve rakibin hamlesi beklenir.
 */

function loopActive() { return state.settings.autoPlay || state.settings.liveAnalysis; }

function scheduleTick(delay) {
  clearTimeout(state.loopTimer);
  if (!loopActive()) { state.loopTimer = null; return; }
  state.loopTimer = setTimeout(tick, delay == null ? state.settings.scanInterval : delay);
}

function stopLoop() {
  clearTimeout(state.loopTimer);
  state.loopTimer = null;
  setLoopState('', 'durdu');
}

async function tick() {
  state.loopTimer = null;
  if (!loopActive()) { setLoopState('', 'durdu'); return; }
  if (state.loopBusy) { scheduleTick(); return; }
  state.loopBusy = true;
  let nextDelay = null;
  try {
    nextDelay = await tickOnce();
  } catch (err) {
    setStatus('err', 'Döngü hatası: ' + (err.message || err));
  } finally {
    state.loopBusy = false;
    scheduleTick(nextDelay);
  }
}

async function tickOnce() {
  const data = await readPosition();
  if (!data || !data.ok) {
    setLoopState('', 'tahta yok');
    if (data && data.error) setStatus('warn', data.error);
    return Math.max(1200, state.settings.scanInterval);
  }

  const changed = data.fen !== state.fen;
  if (changed || !state.board) applyPosition(data);

  const myTurn = data.turn === myColorNow();

  if (!myTurn) {
    setLoopState('active', 'rakip bekleniyor');
    // Rakibin sırasında da analiz sürer: değerlendirme ve beklenen cevap canlı kalır.
    if (state.settings.liveAnalysis && data.fen !== state.lastAnalyzed && !state.analyzing) {
      await doAnalyze(data.fen, Math.min(state.settings.movetime, 800));
      setLoopState('active', 'rakip bekleniyor');
    }
    return null;
  }

  if (!state.settings.autoPlay) {
    setLoopState('active', 'sıra sizde');
    if (state.settings.liveAnalysis && data.fen !== state.lastAnalyzed && !state.analyzing) {
      await doAnalyze(data.fen);
    }
    return null;
  }

  if (data.fen === state.lastPlayedFen) {
    // Oynadık ama tahta güncellenmedi. Tıklama sayfaya geçmemiş olabilir:
    // bir süre bekleyip aynı konumu yeniden denemek döngünün kilitlenmesini önler.
    if (!state.waitingSince) state.waitingSince = Date.now();
    const retryAfter = Math.max(2000, state.settings.scanInterval * 5);
    if (Date.now() - state.waitingSince > retryAfter) {
      state.waitingSince = 0;
      state.lastPlayedFen = null;
      setStatus('warn', 'Hamle tahtaya geçmedi, yeniden deneniyor');
      setLoopState('active', 'yeniden deneniyor');
      return 0;
    }
    setLoopState('active', 'hamle bekleniyor');
    return null;
  }
  state.waitingSince = 0;

  const res = await doAnalyze(data.fen);
  if (!res || !res.best) return null;

  if (state.settings.playDelay) await new Promise((r) => setTimeout(r, state.settings.playDelay));

  // Gecikme sırasında konum değiştiyse (rakip oynadı, geri alındı) hamleyi iptal et.
  const fresh = await readPosition();
  if (fresh && fresh.ok && fresh.fen.split(' ')[0] !== data.fen.split(' ')[0]) {
    setStatus('warn', 'Konum değişti, hamle iptal edildi');
    return 0;
  }

  const played = await doPlay(res);
  setLoopState('active', played ? 'oynandı, sıradaki konum' : 'oynanamadı');
  return played ? 250 : null;                        // oynadıysak hemen sıradaki tura geç
}

/* İçerik betiğinden gelen tahta değişimi döngüyü hemen uyandırır. */
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.channel !== CHANNEL) return;
  if (msg.type === 'command') {
    if (msg.command === 'analyze-now') doScan().then(() => doAnalyze());
    else if (msg.command === 'play-best') doPlay(null, true);
    return;
  }
  if (msg.type === 'boardChanged') {
    if (state.settings.useVision) return;             // ekran modunda döngü zaten tarıyor
    if (loopActive() && !state.loopBusy) scheduleTick(60);
    else if (!loopActive() && msg.data && msg.data.fen) applyPosition(msg.data);
  }
});

/* ------------------------------- ayarlar ------------------------------ */

function applySettingsToUi() {
  const s = state.settings;
  el.movetime.value = s.movetime;
  el.maxDepth.value = s.maxDepth;
  el.playDelay.value = s.playDelay;
  el.scanInterval.value = s.scanInterval;
  el.method.value = s.method;
  el.showArrow.checked = s.showArrow;
  el.autoPlay.checked = s.autoPlay;
  el.liveAnalysis.checked = s.liveAnalysis;
  el.myColor.value = s.myColor;
  el.turnSel.value = s.turnOverride;
  el.useStockfish.checked = s.useStockfish;
  el.useVision.checked = s.useVision;
  el.movetimeOut.textContent = (s.movetime / 1000).toFixed(1) + ' sn';
  el.maxDepthOut.textContent = s.maxDepth >= 30 ? 'sınırsız' : s.maxDepth;
  el.playDelayOut.textContent = (s.playDelay / 1000).toFixed(1) + ' sn';
  el.scanIntervalOut.textContent = (s.scanInterval / 1000).toFixed(1) + ' sn';
}

function saveSettings() { chrome.storage.local.set({ settings: state.settings }); }

async function loadSettings() {
  const got = await chrome.storage.local.get('settings');
  if (got && got.settings) Object.assign(state.settings, got.settings);
  applySettingsToUi();
}

/* -------------------------------- olaylar ----------------------------- */

el.btnScan.addEventListener('click', () => doScan());
el.btnAnalyze.addEventListener('click', async () => { await doScan(); await doAnalyze(); });
el.btnPlay.addEventListener('click', () => doPlay(null, true));

el.autoPlay.addEventListener('change', async () => {
  state.settings.autoPlay = el.autoPlay.checked;
  saveSettings();
  if (state.settings.autoPlay) {
    state.lastPlayedFen = null;
    await doScan();
    setStatus('ok', 'Otomatik mod açık');
    scheduleTick(0);
  } else {
    setStatus('ok', 'Otomatik mod kapalı');
    if (!loopActive()) stopLoop();
  }
});

el.liveAnalysis.addEventListener('change', () => {
  state.settings.liveAnalysis = el.liveAnalysis.checked;
  saveSettings();
  if (loopActive()) scheduleTick(0); else stopLoop();
});

el.myColor.addEventListener('change', () => { state.settings.myColor = el.myColor.value; saveSettings(); });

el.turnSel.addEventListener('change', async () => {
  state.settings.turnOverride = el.turnSel.value;
  saveSettings();
  state.visionTurn = null;
  await send('resetTurn');
  doScan();
});

el.btnFlip.addEventListener('click', async () => {
  state.previewFlip = !state.previewFlip;
  renderBoard(state.fen, state.lastResult && state.lastResult.best, state.lowSquares);
  if (state.board && (state.board.source === 'manual' || state.settings.useVision)) {
    await send('setRegionOrientation', { orientation: state.previewFlip ? 'black' : 'white' });
  }
});

el.btnUseFen.addEventListener('click', () => {
  const fen = el.fenBox.value.trim();
  if (!fen) return;
  state.fen = fen;
  state.lowSquares = null;
  renderBoard(fen, null, null);
  doAnalyze(fen);
});
el.btnStartPos.addEventListener('click', () => {
  el.fenBox.value = START_FEN; state.fen = START_FEN; renderBoard(START_FEN, null, null);
});
el.btnCopyFen.addEventListener('click', () => navigator.clipboard.writeText(el.fenBox.value || state.fen));

el.btnCalibrate.addEventListener('click', () => calibrate());
el.btnRecognize.addEventListener('click', async () => {
  const res = await recognizeFromScreen();
  if (!res.ok) { setStatus('warn', res.error); return; }
  const built = buildVisionFen(res.pieces, res.board.orientation);
  state.visionPrev = res.pieces;
  applyPosition({
    label: 'Ekrandan okundu', orientation: res.board.orientation,
    fen: built.fen, turn: built.turn, turnSource: built.turnSource,
    confidence: res.confidence, low: res.low
  });
});
el.btnResetTemplates.addEventListener('click', async () => {
  state.templates = null;
  if (state.origin) await chrome.storage.local.remove('tpl:' + state.origin);
  renderVisionState();
  setStatus('ok', 'Şablonlar silindi');
});
el.useVision.addEventListener('change', () => {
  state.settings.useVision = el.useVision.checked;
  saveSettings();
  state.visionPrev = null;
  doScan();
});

for (const [input, out, fmt, key] of [
  [el.movetime, el.movetimeOut, (v) => (v / 1000).toFixed(1) + ' sn', 'movetime'],
  [el.maxDepth, el.maxDepthOut, (v) => (v >= 30 ? 'sınırsız' : String(v)), 'maxDepth'],
  [el.playDelay, el.playDelayOut, (v) => (v / 1000).toFixed(1) + ' sn', 'playDelay'],
  [el.scanInterval, el.scanIntervalOut, (v) => (v / 1000).toFixed(1) + ' sn', 'scanInterval']
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
  if (res && res.ok) { setStatus('ok', 'Bölge seçildi'); doScan(); }
  else setStatus('warn', 'Bölge seçilmedi');
});
el.btnClearRegion.addEventListener('click', async () => { await send('clearRegion'); doScan(); });

chrome.tabs.onActivated.addListener(async () => {
  state.lastPlayedFen = null;
  state.visionPrev = null;
  await doScan();
});

/* ------------------------------ başlangıç ----------------------------- */

(async function init() {
  await loadSettings();
  renderBoard(START_FEN, null, null);
  const tab = await activeTab();
  if (tab) await setOrigin(tab.url || '');
  await detectStockfish();
  await doScan();
  if (loopActive()) scheduleTick(0);
})();
