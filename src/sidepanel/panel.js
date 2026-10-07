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
  nodesText: $('nodesText'), pvText: $('pvText'), candidates: $('candidates'),
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
  variety: $('variety'),
  varietyCount: $('varietyCount'), varietyCountOut: $('varietyCountOut'),
  varietyGap: $('varietyGap'), varietyGapOut: $('varietyGapOut'),
  varietyMaxLoss: $('varietyMaxLoss'), varietyMaxLossOut: $('varietyMaxLossOut'),
  method: $('method'), useStockfish: $('useStockfish'),
  btnArrows: $('btnArrows'), arrowCount: $('arrowCount'), arrowCountOut: $('arrowCountOut'),
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
const Variety = self.ChessVariety;

const state = {
  tabId: null,
  origin: null,
  board: null,
  fen: START_FEN,
  previewFlip: false,
  lowSquares: null,
  analysis: null,          // {id, fen, startedAt, result, done, promise}
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
    method: 'click', showArrows: true, arrowCount: 6, autoPlay: false, liveAnalysis: true,
    myColor: 'auto', turnOverride: 'auto', useStockfish: false, useVision: false,
    variety: false, varietyCount: 10, varietyGap: 50, varietyMaxLoss: 120
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

/* ----------------------- sürekli analiz oturumu -----------------------
 * Motor artık "şu kadar süre düşün" değil, "ben durdurana kadar derinleş"
 * biçiminde çalışır. Her derinlik tamamlandığında panele güncel sonuç gelir;
 * arayüz ve oklar buna göre tazelenir. Süre ayarı aramayı kesmez, yalnızca
 * otomatik modda hamlenin ne zaman oynanacağını belirler.
 */

/** Oklar ve çeşitlilik birlikte kaç adayın hesaplanacağını belirler. */
function analysisNeeds() {
  const s = state.settings;
  const forArrows = s.showArrows ? Math.max(2, s.arrowCount) : 1;
  const forVariety = s.variety ? s.varietyCount : 1;
  const count = Math.max(forArrows, forVariety);
  if (count < 2) return { count: 1, margin: 0 };
  const varietyMargin = s.variety ? Math.max(s.varietyMaxLoss, s.varietyGap) + 40 : 0;
  return { count, margin: Math.max(300, varietyMargin) };
}

function startAnalysis(fen) {
  stopAnalysis();
  const id = ++state.reqId;
  const need = analysisNeeds();
  const entry = { id, fen, startedAt: Date.now(), result: null, done: false };
  state.analysis = entry;

  entry.promise = new Promise((resolve) => {
    waiters.set(id, {
      resolve,
      reject: (err) => resolve({ type: 'error', message: String((err && err.message) || err) }),
      onInfo: (info) => {
        if (state.analysis !== entry) return;
        entry.result = decorate(info);
        onLiveResult(entry);
      }
    });
  }).then((final) => {
    if (final && final.type !== 'error') entry.result = decorate(final);
    else if (final && final.type === 'error') setStatus('err', 'Analiz hatası: ' + final.message);
    entry.done = true;
    if (state.analysis === entry) onLiveResult(entry);
    return entry.result;
  });

  worker.postMessage({
    id, cmd: 'analyze', fen,
    depth: state.settings.maxDepth,
    multiPv: need.count,
    multiPvMargin: need.margin
  });
  updateAnalyzeButton();
  return entry;
}

function stopAnalysis() {
  if (state.analysis && !state.analysis.done) worker.postMessage({ cmd: 'stop' });
}

/** Bu konum için analiz yoksa başlatır; varsa olduğu gibi bırakır. */
function ensureAnalysis(fen) {
  const a = state.analysis;
  if (a && a.fen === fen) return a;
  return startAnalysis(fen);
}

function decorate(res) {
  if (res && res.best) res.play = choosePlayMove(res);
  return res;
}

let lastPaint = 0;
function onLiveResult(entry) {
  const res = entry.result;
  if (!res) return;
  state.fen = entry.fen;
  state.lastResult = res;
  state.lastAnalyzed = entry.fen;

  const now = Date.now();
  const force = entry.done || !!res.gameOver;
  if (!force && now - lastPaint < 150) return;        // erken derinlikler saniyede onlarca gelir
  lastPaint = now;

  renderResult(res, false);
  updateAnalyzeButton();
  paintArrows(res);
  if (res.gameOver) {
    setStatus('warn', res.gameOver === 'checkmate' ? 'Mat — oynanacak hamle yok' : 'Pat — oynanacak hamle yok');
  }
}

function updateAnalyzeButton() {
  const running = state.analysis && !state.analysis.done;
  el.btnAnalyze.textContent = running ? 'Durdur' : 'Analiz et';
  el.btnAnalyze.classList.toggle('running', !!running);
}

/** Aday hamleleri kuvvetlerine göre tahtaya çizer. */
let arrowToken = 0;
async function paintArrows(res) {
  const token = ++arrowToken;
  if (!state.settings.showArrows) return;
  if (!res || !res.candidates || !res.candidates.length) return;
  const arrows = Variety.arrowWeights(res.candidates, { count: state.settings.arrowCount });
  if (!arrows.length) return;
  // Oynanacak hamle en iyi değilse onu da belirgin kıl
  const playing = res.play && res.play.move && res.play.move.uci;
  for (const a of arrows) if (playing && a.uci === playing) a.rank = 0;
  if (token !== arrowToken) return;
  await send('showArrows', { arrows });
}

async function clearArrows() { await send('clearArrows'); }

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

/** Çeşitlilik açıksa adaylar arasından seçim yapar, değilse en iyiyi döndürür. */
function choosePlayMove(res) {
  if (!res) return null;
  if (!state.settings.variety || !res.candidates || res.candidates.length < 2) {
    return { move: res.best, pool: res.candidates || [], reason: 'en iyi hamle' };
  }
  const pick = Variety.pickMove(res.candidates, {
    count: state.settings.varietyCount,
    gap: state.settings.varietyGap,
    maxLoss: state.settings.varietyMaxLoss
  });
  if (!pick) return { move: res.best, pool: [], reason: 'en iyi hamle' };
  return { move: pick.choice, pool: pick.pool, reason: pick.reason };
}

function renderCandidates(res) {
  if (!res || !res.candidates || res.candidates.length < 2 || !state.settings.variety) {
    el.candidates.innerHTML = '';
    return;
  }
  const poolSet = new Set((res.play && res.play.pool || []).map((c) => c.uci));
  const chosen = res.play && res.play.move ? res.play.move.uci : null;
  el.candidates.innerHTML = '';
  for (const c of res.candidates) {
    const span = document.createElement('span');
    span.className = 'cand' + (c.uci === chosen ? ' picked' : (poolSet.has(c.uci) ? '' : ' out'));
    const value = c.mate != null ? 'M' + Math.abs(c.mate) : (c.score >= 0 ? '+' : '') + (c.score / 100).toFixed(2);
    span.textContent = `${c.san} ${value}`;
    el.candidates.appendChild(span);
  }
  const note = document.createElement('span');
  note.className = 'cand';
  note.textContent = `${(res.play && res.play.pool || []).length} aday · ${res.play ? res.play.reason : ''}`;
  el.candidates.appendChild(note);
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

  const shown = (res.play && res.play.move) || res.best;
  el.bestMove.textContent = (shown && (shown.san || res.san)) || (shown ? shown.uci : '—');
  const running = state.analysis && !state.analysis.done && state.analysis.result === res;
  el.depthText.textContent = 'd' + (res.depth || 0) + (running ? '…' : (res.complete ? ' ✓' : ''));
  el.nodesText.textContent = formatNodes(res.nodes) + ' · ' + formatNodes(res.nps) + '/sn';
  el.pvText.textContent = (res.pvSan && res.pvSan.length) ? res.pvSan.join(' ') : (res.pv || []).join(' ');
  if (!partial) {
    renderBoard(state.fen, (res.play && res.play.move) || res.best, state.lowSquares);
    renderCandidates(res);
  }
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
  if (state.analysis && state.analysis.fen !== data.fen) { stopAnalysis(); state.analysis = null; }
  if (!state.settings.useVision) await send('watch', { enabled: true });
  return data;
}

/**
 * Konumu analiz eder. Varsayılanda sonucu beklemeden döner (analiz arka planda
 * derinleşmeyi sürdürür). waitMs verilirse o kadar bekleyip analizi durdurur ve
 * eldeki en iyi sonucu döndürür.
 */
async function doAnalyze(fenArg, waitMs) {
  const fen = fenArg || state.fen;
  if (!fen) { setStatus('warn', 'Önce bir konum gerekli'); return null; }
  const entry = ensureAnalysis(fen);
  if (waitMs == null) return entry.result;

  const deadline = entry.startedAt + waitMs;
  while (Date.now() < deadline && !entry.done && state.analysis === entry) {
    await new Promise((r) => setTimeout(r, Math.min(80, Math.max(10, deadline - Date.now()))));
  }
  if (state.analysis === entry && !entry.done) {
    stopAnalysis();
    await entry.promise;
  }
  return entry.result;
}

async function doPlay(res, force) {
  const r = res || state.lastResult;
  if (!r) { setStatus('warn', 'Önce analiz edin'); return false; }
  const move = (r.play && r.play.move) || r.best;
  if (!move) { setStatus('warn', 'Önce analiz edin'); return false; }
  if (!force && state.lastPlayedFen === state.fen) return false;
  state.lastPlayedFen = state.fen;
  const label = move.san || r.san || move.uci;
  const out = await send('playMove', {
    from: move.from, to: move.to, promo: move.promo,
    san: label, method: state.settings.method
  });
  if (out && out.ok) {
    setStatus('ok', `Oynandı: ${label}`);
    await clearArrows();
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

/** Döngü durumuna analiz derinliğini ekler. */
function analysisLabel(base) {
  const a = state.analysis;
  if (!a || !a.result || !a.result.depth) return base;
  return `${base} · d${a.result.depth}${a.done ? '' : '…'}`;
}

async function tickOnce() {
  const data = await readPosition();
  if (!data || !data.ok) {
    setLoopState('', 'tahta yok');
    if (data && data.error) setStatus('warn', data.error);
    return Math.max(1200, state.settings.scanInterval);
  }

  const s = state.settings;
  const changed = data.fen !== state.fen;
  if (changed || !state.board) applyPosition(data);

  const myTurn = data.turn === myColorNow();

  // Konum için analiz sürekli açık tutulur; derinlik sınırına kadar derinleşir.
  if (s.liveAnalysis || (s.autoPlay && myTurn)) ensureAnalysis(data.fen);
  const a = state.analysis;

  if (!myTurn) {
    setLoopState('active', analysisLabel('rakip bekleniyor'));
    return null;
  }

  if (!s.autoPlay) {
    setLoopState('active', analysisLabel('sıra sizde'));
    return null;
  }

  if (data.fen === state.lastPlayedFen) {
    // Oynadık ama tahta güncellenmedi. Tıklama sayfaya geçmemiş olabilir:
    // bir süre bekleyip aynı konumu yeniden denemek döngünün kilitlenmesini önler.
    if (!state.waitingSince) state.waitingSince = Date.now();
    const retryAfter = Math.max(2000, s.scanInterval * 5);
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

  if (!a || a.fen !== data.fen || !a.result) {
    setLoopState('thinking', 'düşünüyor…');
    return 120;                                   // ilk derinlik henüz yok
  }

  // Süre dolmadıysa analizin derinleşmesine izin ver, tam zamanında geri dön.
  const elapsed = Date.now() - a.startedAt;
  if (elapsed < s.movetime && !a.done) {
    setLoopState('thinking', analysisLabel('düşünüyor'));
    return Math.min(s.scanInterval, Math.max(60, s.movetime - elapsed));
  }

  const res = await doAnalyze(data.fen, s.movetime);
  if (!res || !((res.play && res.play.move) || res.best)) return null;

  if (s.playDelay) await new Promise((r) => setTimeout(r, s.playDelay));

  // Gecikme sırasında konum değiştiyse (rakip oynadı, geri alındı) hamleyi iptal et.
  const fresh = await readPosition();
  if (fresh && fresh.ok && fresh.fen.split(' ')[0] !== data.fen.split(' ')[0]) {
    setStatus('warn', 'Konum değişti, hamle iptal edildi');
    return 0;
  }

  const played = await doPlay(res);
  setLoopState('active', played ? 'oynandı, sıradaki konum' : 'oynanamadı');
  return played ? 250 : null;                     // oynadıysak hemen sıradaki tura geç
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
  el.arrowCount.value = s.arrowCount;
  el.arrowCountOut.textContent = s.arrowCount;
  el.btnArrows.classList.toggle('on', s.showArrows);
  el.autoPlay.checked = s.autoPlay;
  el.liveAnalysis.checked = s.liveAnalysis;
  el.myColor.value = s.myColor;
  el.turnSel.value = s.turnOverride;
  el.useStockfish.checked = s.useStockfish;
  el.useVision.checked = s.useVision;
  el.variety.checked = s.variety;
  el.varietyCount.value = s.varietyCount;
  el.varietyGap.value = s.varietyGap;
  el.varietyMaxLoss.value = s.varietyMaxLoss;
  el.varietyCountOut.textContent = s.varietyCount;
  el.varietyGapOut.textContent = (s.varietyGap / 100).toFixed(2);
  el.varietyMaxLossOut.textContent = (s.varietyMaxLoss / 100).toFixed(2);
  el.movetimeOut.textContent = (s.movetime / 1000).toFixed(1) + ' sn';
  el.maxDepthOut.textContent = 'd' + s.maxDepth;
  el.playDelayOut.textContent = (s.playDelay / 1000).toFixed(1) + ' sn';
  el.scanIntervalOut.textContent = (s.scanInterval / 1000).toFixed(1) + ' sn';
}

function saveSettings() { chrome.storage.local.set({ settings: state.settings }); }

async function loadSettings() {
  const got = await chrome.storage.local.get('settings');
  if (got && got.settings) Object.assign(state.settings, got.settings);
  // eski ayar adı: showArrow → showArrows
  if (state.settings.showArrow !== undefined) {
    if (got.settings && got.settings.showArrows === undefined) state.settings.showArrows = state.settings.showArrow;
    delete state.settings.showArrow;
  }
  applySettingsToUi();
}

/* -------------------------------- olaylar ----------------------------- */

el.btnScan.addEventListener('click', () => doScan());
el.btnAnalyze.addEventListener('click', async () => {
  if (state.analysis && !state.analysis.done) {       // çalışıyorsa durdur
    stopAnalysis();
    await state.analysis.promise;
    updateAnalyzeButton();
    return;
  }
  await doScan();
  await doAnalyze();                                   // beklemeden başlat, arkada derinleşir
});
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
  [el.maxDepth, el.maxDepthOut, (v) => 'd' + v, 'maxDepth'],
  [el.playDelay, el.playDelayOut, (v) => (v / 1000).toFixed(1) + ' sn', 'playDelay'],
  [el.scanInterval, el.scanIntervalOut, (v) => (v / 1000).toFixed(1) + ' sn', 'scanInterval'],
  [el.varietyCount, el.varietyCountOut, (v) => String(v), 'varietyCount'],
  [el.varietyGap, el.varietyGapOut, (v) => (v / 100).toFixed(2), 'varietyGap'],
  [el.varietyMaxLoss, el.varietyMaxLossOut, (v) => (v / 100).toFixed(2), 'varietyMaxLoss'],
  [el.arrowCount, el.arrowCountOut, (v) => String(v), 'arrowCount']
]) {
  input.addEventListener('input', () => {
    const v = parseInt(input.value, 10);
    state.settings[key] = v;
    out.textContent = fmt(v);
    saveSettings();
    if (key === 'arrowCount' || key === 'varietyCount' || key === 'maxDepth') restartAnalysis();
  });
}

el.variety.addEventListener('change', () => {
  state.settings.variety = el.variety.checked;
  saveSettings();
  if (!state.settings.variety) el.candidates.innerHTML = '';
  restartAnalysis();                    // aday sayısı değişti, baştan hesapla
});

/** Aday sayısını etkileyen ayarlar değişince analizi baştan başlatır. */
function restartAnalysis() {
  const fen = state.analysis ? state.analysis.fen : state.fen;
  stopAnalysis();
  state.analysis = null;
  state.lastAnalyzed = null;
  if (fen && (state.settings.liveAnalysis || state.settings.autoPlay)) ensureAnalysis(fen);
}

el.method.addEventListener('change', () => { state.settings.method = el.method.value; saveSettings(); });
el.btnArrows.addEventListener('click', async () => {
  state.settings.showArrows = !state.settings.showArrows;
  el.btnArrows.classList.toggle('on', state.settings.showArrows);
  saveSettings();
  if (state.settings.showArrows) {
    const res = state.analysis && state.analysis.result;
    if (res) await paintArrows(res);
    else if (state.lastResult) await paintArrows(state.lastResult);
  } else {
    await clearArrows();
  }
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
  const data = await doScan();
  updateAnalyzeButton();
  if (data && data.fen && state.settings.liveAnalysis) ensureAnalysis(data.fen);
  if (loopActive()) scheduleTick(0);
})();
