const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { El, makeWindow } = require('./dom-stub.js');

let fails = 0;
const ok = (cond, name, extra) => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  → ' + extra}`);
};

function loadContent(win, files) {
  const sandbox = {
    window: win, document: win.document, console,
    setTimeout, clearTimeout, MutationObserver: win.MutationObserver,
    chrome: { runtime: { sendMessage() {}, onMessage: { addListener() {} } } },
    location: { href: 'https://example.test/' }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const SIZE = 400, SQ = SIZE / 8;

/* ---------- lichess adaptörü ---------- */
function lichessBoard(orientation) {
  const wrap = new El('div', { className: 'cg-wrap orientation-' + orientation });
  const container = new El('cg-container');
  const board = new El('cg-board', { rect: { left: 100, top: 50, width: SIZE, height: SIZE } });
  wrap.append(container);
  container.append(board);

  const rows = START.split('/');
  for (let gi = 0; gi < 8; gi++) {          // gi 0 = 8. yatay
    let file = 0;
    for (const ch of rows[gi]) {
      if (ch >= '1' && ch <= '8') { file += +ch; continue; }
      const rank = 7 - gi;
      const col = orientation === 'white' ? file : 7 - file;
      const row = orientation === 'white' ? 7 - rank : rank;
      const isWhite = ch === ch.toUpperCase();
      const role = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[ch.toLowerCase()];
      board.append(new El('piece', {
        className: `${isWhite ? 'white' : 'black'} ${role}`,
        transform: `translate(${col * SQ}px, ${row * SQ}px)`
      }));
      file++;
    }
  }
  return { wrap, board };
}

for (const orientation of ['white', 'black']) {
  const win = makeWindow();
  const { wrap } = lichessBoard(orientation);
  win.document.body.append(wrap);
  const sb = loadContent(win, ['src/content/board-readers.js']);
  const R = win.__chessmove.readers;
  const data = R.lichess.read(win.document.querySelector('cg-board'));
  ok(R.piecesToFenBoard(data.pieces) === START, `lichess ${orientation} konumu okur`, R.piecesToFenBoard(data.pieces));
  ok(data.orientation === orientation, `lichess ${orientation} yönü`, data.orientation);
}

/* ---------- chess.com adaptörü ---------- */
function chesscomBoard(orientation) {
  const board = new El('wc-chess-board', {
    className: 'board' + (orientation === 'black' ? ' flipped' : ''),
    rect: { left: 0, top: 0, width: SIZE, height: SIZE }
  });
  const rows = START.split('/');
  for (let gi = 0; gi < 8; gi++) {
    let file = 0;
    for (const ch of rows[gi]) {
      if (ch >= '1' && ch <= '8') { file += +ch; continue; }
      const rank = 7 - gi;
      const isWhite = ch === ch.toUpperCase();
      board.append(new El('div', {
        className: `piece ${isWhite ? 'w' : 'b'}${ch.toLowerCase()} square-${file + 1}${rank + 1}`
      }));
      file++;
    }
  }
  return board;
}

for (const orientation of ['white', 'black']) {
  const win = makeWindow();
  win.document.body.append(chesscomBoard(orientation));
  loadContent(win, ['src/content/board-readers.js']);
  const R = win.__chessmove.readers;
  const data = R.chesscom.read(win.document.querySelector('wc-chess-board'));
  ok(R.piecesToFenBoard(data.pieces) === START, `chess.com ${orientation} konumu okur`, R.piecesToFenBoard(data.pieces));
  ok(data.orientation === orientation, `chess.com ${orientation} yönü`, data.orientation);
}

/* ---------- geometri ---------- */
{
  const win = makeWindow();
  loadContent(win, ['src/content/board-readers.js']);
  const R = win.__chessmove.readers;
  const rect = { x: 100, y: 50, width: 400, height: 400 };
  const a1w = R.squareCenter(rect, 'white', 'a1');
  ok(Math.abs(a1w.x - 125) < 0.01 && Math.abs(a1w.y - 425) < 0.01, 'a1 merkezi (beyaz yön)', JSON.stringify(a1w));
  const a1b = R.squareCenter(rect, 'black', 'a1');
  ok(Math.abs(a1b.x - 475) < 0.01 && Math.abs(a1b.y - 75) < 0.01, 'a1 merkezi (siyah yön)', JSON.stringify(a1b));
  const h8 = R.squareCenter(rect, 'white', 'h8');
  ok(Math.abs(h8.x - 475) < 0.01 && Math.abs(h8.y - 75) < 0.01, 'h8 merkezi (beyaz yön)', JSON.stringify(h8));
}

/* ---------- FEN kurulumu ve sıra çıkarımı ---------- */
{
  const win = makeWindow();
  const { wrap, board } = lichessBoard('white');
  win.document.body.append(wrap);
  const sb = loadContent(win, ['src/content/board-readers.js', 'src/content/overlay.js', 'src/content/player.js', 'src/content/main.js']);
  const D = win.__chessmove.debug;

  const first = D.scan();
  ok(first.fen === START + ' w KQkq - 0 1', 'başlangıç konumu FEN', first.fen);
  ok(first.turn === 'w', 'ilk taramada sıra beyazda', first.turn);

  // e2-e4 oynanmış gibi taşı taşı
  const e2 = [...board.querySelectorAll('piece')].find((p) => p.style.transform === `translate(${4 * SQ}px, ${6 * SQ}px)`);
  e2.style.transform = `translate(${4 * SQ}px, ${4 * SQ}px)`;
  const second = D.scan();
  ok(second.turn === 'b', 'değişimden sonra sıra siyaha geçer', second.turn + ' / ' + second.turnSource);
  ok(second.fen.startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b '), 'e4 sonrası FEN', second.fen);

  // siteden gelen son hamle işareti önceliklidir
  board.append(new El('square', { className: 'last-move', transform: `translate(${4 * SQ}px, ${4 * SQ}px)` }));
  board.append(new El('square', { className: 'last-move', transform: `translate(${4 * SQ}px, ${6 * SQ}px)` }));
  const third = D.scan();
  ok(third.turn === 'b' && third.turnSource === 'son hamle', 'son hamle işaretinden sıra', third.turn + ' / ' + third.turnSource);

  // elle geçersiz kılma
  const forced = D.scan('w');
  ok(forced.turn === 'w' && forced.turnSource === 'manuel', 'elle sıra seçimi', forced.turn);

  // rok hakları: şah oynayınca düşer
  ok(D.guessCastling({ e1: 'K', h1: 'R', a1: 'R', e8: 'k', h8: 'r', a8: 'r' }) === 'KQkq', 'tüm rok hakları', '');
  ok(D.guessCastling({ f1: 'K', h1: 'R', e8: 'k', h8: 'r' }) === 'k', 'şah oynamışsa rok hakkı yok', D.guessCastling({ f1: 'K', h1: 'R', e8: 'k', h8: 'r' }));

  // geçerken alma karesi
  const lm = D.readLastMove({ e4: 'P' }, ['e2', 'e4']);
  ok(lm.ep === 'e3' && lm.mover === 'w', 'iki kare piyon itişi geçerken alma karesi verir', JSON.stringify(lm));
}

/* ---------- ok geometrisi: kuvvet → uzunluk, kalınlık, saydamlık ---------- */
{
  const win = makeWindow();
  loadContent(win, ['src/content/board-readers.js', 'src/content/overlay.js']);
  const O = win.__chessmove.overlay;
  const a = { x: 0, y: 0 }, b = { x: 300, y: 0 };      // 300 piksel yatay
  const SQ = 50;

  const strong = O.arrowGeometry(a, b, 1, SQ);
  const weak = O.arrowGeometry(a, b, 0, SQ);
  const mid = O.arrowGeometry(a, b, 0.5, SQ);

  ok(Math.abs(strong.length - 300) < 0.01, 'tam kuvvetli ok hedefe ulaşır', strong.length.toFixed(1));
  ok(Math.abs(weak.length - 300 * O.ARROW_STYLE.minLength) < 0.01, 'zayıf ok kısa kalır', weak.length.toFixed(1));
  ok(weak.length < mid.length && mid.length < strong.length, 'uzunluk kuvvetle birlikte artar',
    [weak.length, mid.length, strong.length].map((v) => v.toFixed(0)).join(' < '));
  ok(weak.alpha < mid.alpha && mid.alpha < strong.alpha, 'saydamlık kuvvetle birlikte azalır',
    [weak.alpha, mid.alpha, strong.alpha].map((v) => v.toFixed(2)).join(' < '));
  ok(weak.width < strong.width, 'kalınlık kuvvetle birlikte artar', `${weak.width.toFixed(1)} < ${strong.width.toFixed(1)}`);
  ok(weak.hue < strong.hue, 'renk zayıfta kehribar, güçlüde yeşil', `${weak.hue.toFixed(0)} → ${strong.hue.toFixed(0)}`);
  ok(strong.alpha <= 1 && weak.alpha >= 0.15, 'saydamlık makul aralıkta',
    `${weak.alpha.toFixed(2)}..${strong.alpha.toFixed(2)}`);

  // ok ucu gövdenin ilerisinde, gövde başlangıç karesinin dışında
  ok(strong.tip.x > strong.shaftEnd.x, 'ok ucu gövdenin ucunda', `${strong.tip.x} > ${strong.shaftEnd.x}`);
  ok(strong.start.x > a.x, 'gövde başlangıç karesinin içinden başlamaz', strong.start.x.toFixed(1));

  // dikey ve çapraz yönlerde de tutarlı
  const up = O.arrowGeometry({ x: 100, y: 300 }, { x: 100, y: 0 }, 1, SQ);
  ok(Math.abs(up.tip.y - 0) < 0.01 && Math.abs(up.tip.x - 100) < 0.01, 'yukarı yönlü ok doğru uçta',
    `${up.tip.x.toFixed(1)},${up.tip.y.toFixed(1)}`);
  const diag = O.arrowGeometry({ x: 0, y: 0 }, { x: 200, y: 200 }, 1, SQ);
  ok(Math.abs(diag.tip.x - 200) < 0.01 && Math.abs(diag.tip.y - 200) < 0.01, 'çapraz ok doğru uçta',
    `${diag.tip.x.toFixed(1)},${diag.tip.y.toFixed(1)}`);
}

console.log(fails ? `\n${fails} test başarısız` : '\nTüm tahta testleri geçti');
process.exit(fails ? 1 : 0);
