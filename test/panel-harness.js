/*
 * panel-harness.js — panel.js'i tarayıcısız çalıştırmak için asgari ortam.
 * Sahte DOM + chrome API'leri + gerçek motoru çalıştıran sahte Worker +
 * hamleleri gerçekten uygulayan sahte bir sayfa (rakip de oynar).
 */
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

require('../src/engine/chess.js');
require('../src/engine/evaluate.js');
const C = globalThis.ChessCore;
const S = require('../src/engine/search.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function makeElement(id) {
  const listeners = {};
  const el = {
    id, value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
    className: '', hidden: false,
    style: {}, children: [],
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    appendChild(child) { this.children.push(child); return child; },
    getContext() { return null; },
    fire(type, ev) { return Promise.all((listeners[type] || []).map((fn) => fn(ev || {}))); }
  };
  return el;
}

/** Sahte sayfa: gerçek bir konum tutar, hamleleri uygular, rakip cevabını oynar. */
function makePage(opts) {
  const page = {
    pos: new C.Position(opts.fen || C.START_FEN),
    orientation: opts.orientation || 'white',
    played: [],
    opponentMoves: 0,
    replyDelay: opts.replyDelay == null ? 30 : opts.replyDelay,
    log: []
  };

  page.pieces = () => {
    const out = {};
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = page.pos.board[s];
      if (p) out[C.squareName(s)] = C.PIECE_TO_CHAR[p];
    }
    return out;
  };

  page.scan = () => {
    const fen = page.pos.fen();
    return {
      ok: true, source: 'test', label: 'Test tahtası',
      orientation: page.orientation,
      rect: { x: 0, y: 0, width: 400, height: 400 },
      viewport: { width: 1280, height: 800 }, dpr: 1,
      squareSize: 50, pieces: page.pieces(), lastMove: null,
      fen, turn: fen.split(' ')[1], turnSource: 'test',
      pieceCount: Object.keys(page.pieces()).length
    };
  };

  page.playMove = (msg) => {
    const uci = msg.from + msg.to + (msg.promo || '');
    if (opts.swallowMoves) {          // tıklamanın sayfaya geçmediği durumu taklit eder
      page.attempts = (page.attempts || 0) + 1;
      page.log.push('yutuldu: ' + uci);
      return { ok: true };
    }
    const move = page.pos.moveFromUci(uci);
    if (!move) { page.log.push('geçersiz: ' + uci); return { ok: false, error: 'geçersiz hamle ' + uci }; }
    page.pos.makeMove(move);
    page.played.push(uci);
    page.log.push('biz: ' + uci);
    // rakip cevabı
    setTimeout(() => {
      const legal = page.pos.legalMoves();
      if (!legal.length) return;
      const reply = legal[Math.floor(opts.rng() * legal.length)];
      page.pos.makeMove(reply);
      page.opponentMoves++;
      page.log.push('rakip: ' + C.moveToUci(reply));
    }, page.replyDelay);
    return { ok: true };
  };

  page.handle = (msg) => {
    switch (msg.type) {
      case 'ping': return { ok: true };
      case 'scan': return page.scan();
      case 'playMove': return page.playMove(msg);
      case 'watch': case 'showArrow': case 'clearArrow': case 'badge':
      case 'resetTurn': case 'hideOverlays': case 'showOverlays':
      case 'clearRegion': case 'setRegionOrientation':
        return { ok: true };
      case 'pickRegion': return { ok: false, error: 'test' };
      default: return { ok: false, error: 'bilinmeyen komut ' + msg.type };
    }
  };

  return page;
}

/** Gerçek arama motorunu çalıştıran sahte Worker. */
function makeWorkerClass() {
  return class FakeWorker {
    constructor() {
      this.onmessage = null;
      this.searcher = new S.Searcher();
      setTimeout(() => this._post({ type: 'ready', engine: 'builtin' }), 0);
    }
    _post(data) { if (this.onmessage) this.onmessage({ data }); }
    postMessage(req) {
      if (req.cmd === 'useBuiltin' || req.cmd === 'useStockfish') {
        setTimeout(() => this._post({ type: 'engine', engine: 'builtin', ok: true }), 0);
        return;
      }
      if (req.cmd !== 'analyze') return;
      setTimeout(() => {
        let pos;
        try { pos = new C.Position(req.fen); }
        catch (err) { this._post({ id: req.id, type: 'error', message: err.message }); return; }
        const res = this.searcher.go(pos, { movetime: req.movetime || 100, depth: req.depth || 64 });
        this._post(Object.assign({ id: req.id, type: 'bestmove', engine: 'builtin' }, res));
      }, 0);
    }
    terminate() {}
  };
}

/**
 * @param {{settings?:Object, page?:Object, rng?:Function}} options
 * @returns {{sandbox, elements, page, storage}}
 */
function bootPanel(options) {
  options = options || {};
  const rng = options.rng || (() => 0.5);
  const page = makePage(Object.assign({ rng }, options.page || {}));
  const elements = {};
  const storage = { settings: Object.assign({
    movetime: 80, maxDepth: 6, playDelay: 0, scanInterval: 40,
    method: 'click', showArrow: false, autoPlay: false, liveAnalysis: false,
    myColor: 'auto', turnOverride: 'auto', useStockfish: false, useVision: false
  }, options.settings || {}) };

  const runtimeListeners = [];
  const document = {
    getElementById(id) { return (elements[id] = elements[id] || makeElement(id)); },
    createElement(tag) { return makeElement(tag); }
  };

  const chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://test/' + p,
      onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
      sendMessage: async () => ({ ok: true })
    },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, url: 'https://test.local/board' }],
      sendMessage: async (tabId, msg) => page.handle(msg),
      onActivated: { addListener() {} },
      captureVisibleTab: async () => { throw new Error('test ortamında ekran görüntüsü yok'); }
    },
    scripting: { executeScript: async () => [] },
    storage: {
      local: {
        get: async (key) => (key in storage ? { [key]: storage[key] } : {}),
        set: async (obj) => Object.assign(storage, obj),
        remove: async (key) => { delete storage[key]; }
      }
    }
  };

  const sandbox = {
    document, chrome, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Worker: makeWorkerClass(),
    Math, Date, JSON, Promise, URL,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: false })
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(read('src/vision/recognizer.js'), sandbox, { filename: 'recognizer.js' });
  vm.runInContext(read('src/sidepanel/panel.js'), sandbox, { filename: 'panel.js' });

  return { sandbox, elements, page, storage, runtimeListeners };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { bootPanel, wait, makePage };
