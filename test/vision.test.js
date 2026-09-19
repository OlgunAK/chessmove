const V = require('../src/vision/recognizer.js');
const { renderBoard } = require('./render-board.js');

let fails = 0;
const ok = (cond, name, extra) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  → ' + extra}`); };

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
const ITALIAN = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1';
const KIWI = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R';
const ENDGAME = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8';

function boardFor(fen, extra) {
  return renderBoard(Object.assign({ size: 512, pieces: V.fenToPieces(fen), orientation: 'white', seed: 7 }, extra || {}));
}

/* 1) Boş/dolu kare ve taş rengi tespiti (şablon gerekmez) */
{
  const a = V.analyzeBoard(boardFor(START), 'white');
  let occErr = 0, colErr = 0;
  const truth = V.fenToPieces(START);
  for (const name in a.squares) {
    const expected = !!truth[name];
    if (a.squares[name].occupied !== expected) occErr++;
    else if (expected) {
      const wantColor = truth[name] === truth[name].toUpperCase() ? 'w' : 'b';
      if (a.squares[name].color !== wantColor) colErr++;
    }
  }
  ok(occErr === 0, 'başlangıç: 64 karenin doluluk tespiti', occErr + ' hata');
  ok(colErr === 0, 'başlangıç: taş renkleri', colErr + ' hata');
}

/* 2) Başlangıç konumundan kalibrasyon, başka konumları tanıma */
let templates = V.emptyTemplates();
{
  const a = V.analyzeBoard(boardFor(START), 'white');
  const res = V.learn(a, V.fenToPieces(START), templates);
  templates = res.templates;
  ok(res.mismatched === 0, 'kalibrasyon uyumsuzluk bırakmaz', res.mismatched);
  ok(res.learned === 32, 'kalibrasyonda 32 taş öğrenildi', res.learned);
  ok(Object.keys(templates.byPiece).length === 12, '12 taş türü için şablon', Object.keys(templates.byPiece).join(''));
}

function check(fen, label, extra) {
  const a = V.analyzeBoard(boardFor(fen, extra), (extra && extra.orientation) || 'white');
  const c = V.classify(a, templates);
  const got = V.piecesToFenBoard(c.pieces);
  const good = got === fen;
  let diff = '';
  if (!good) {
    const truth = V.fenToPieces(fen);
    const names = new Set([...Object.keys(truth), ...Object.keys(c.pieces)]);
    diff = [...names].filter((n) => truth[n] !== c.pieces[n])
      .map((n) => `${n}:${truth[n] || '-'}→${c.pieces[n] || '-'}`).join(' ');
  }
  ok(good, label, diff + ` (güven ${c.confidence.toFixed(2)})`);
  return c;
}

check(ITALIAN, 'İtalyan açılışı konumu tanınır');
check(KIWI, 'kiwipete konumu tanınır');
check(ENDGAME, 'oyun sonu konumu tanınır');

/* 3) Gerçek hayat sapmaları */
check(ITALIAN, 'son hamle vurgusu olan kareler', { highlights: ['e2', 'e4', 'c4', 'f3'] });
check(KIWI, 'küçük tahtada (320 piksel) tanınır', { size: 320 });
check(KIWI, 'büyük tahtada (768 piksel) tanınır', { size: 768 });
check(ITALIAN, 'taş konumu/ölçeği oynadığında', { jitter: 0.03, scaleJitter: 0.08, seed: 99 });
check(KIWI, 'görüntü gürültüsüyle', { noise: 6, seed: 33 });
check(ITALIAN, 'siyah yönünde', { orientation: 'black' });
check(KIWI, 'farklı tahta renklerinde', { light: [240, 217, 181], dark: [181, 136, 99] });
check(ENDGAME, 'koyu temalı tahtada', { light: [120, 125, 135], dark: [60, 65, 75] });

/* 3b) Satranç kısıtları her zaman korunur */
{
  const positions = [ITALIAN, KIWI, ENDGAME, '4k3/PPPPPPPP/8/8/8/8/pppppppp/4K3', START];
  let bad = [];
  for (const fen of positions) {
    for (const theme of [{}, { light: [240, 217, 181], dark: [181, 136, 99] }, { noise: 5, jitter: 0.02 }]) {
      const c = V.classify(V.analyzeBoard(boardFor(fen, theme), 'white'), templates);
      const counts = {};
      for (const name in c.pieces) {
        const piece = c.pieces[name];
        counts[piece] = (counts[piece] || 0) + 1;
        const rank = +name[1];
        if (piece.toLowerCase() === 'p' && (rank === 1 || rank === 8)) bad.push(`${fen.slice(0, 12)} ${name}=${piece}`);
      }
      if ((counts.K || 0) !== 1 || (counts.k || 0) !== 1) bad.push(`${fen.slice(0, 12)} şah sayısı ${counts.K}/${counts.k}`);
      if ((counts.P || 0) > 8 || (counts.p || 0) > 8) bad.push(`${fen.slice(0, 12)} piyon sayısı ${counts.P}/${counts.p}`);
    }
  }
  ok(bad.length === 0, 'kısıtlar korunur: piyon 1/8. yatayda yok, renk başına tek şah, en çok 8 piyon', bad.join(' | '));
}

/* 3c) 7. yataydaki piyon hâlâ piyon kalabilir */
{
  const fen = '4k3/PPP5/8/8/8/8/5ppp/4K3';
  const c = V.classify(V.analyzeBoard(boardFor(fen), 'white'), templates);
  ok(V.piecesToFenBoard(c.pieces) === fen, 'terfi öncesi 7./2. yatay piyonları', V.piecesToFenBoard(c.pieces));
}

/* 3d) assumeKings kapatılınca şah zorlanmaz */
{
  const fen = '8/2p5/3p4/1P6/1R3p2/8/4P1P1/8';        // şahsız bulmaca diyagramı
  const c = V.classify(V.analyzeBoard(boardFor(fen), 'white'), templates, { assumeKings: false });
  const kings = Object.values(c.pieces).filter((p) => p.toLowerCase() === 'k').length;
  ok(kings === 0, 'assumeKings=false ile şah uydurulmaz', kings + ' şah');
}

/* 4) Şablonsuz sınıflandırma güveni sıfır olmalı */
{
  const a = V.analyzeBoard(boardFor(ITALIAN), 'white');
  const c = V.classify(a, V.emptyTemplates());
  ok(c.confidence === 0 && c.unknown > 0, 'şablon yokken güven bildirilmez', `güven=${c.confidence} bilinmeyen=${c.unknown}`);
}

/* 5) Yanlış FEN ile kalibrasyon uyumsuzluk bildirir */
{
  const a = V.analyzeBoard(boardFor(ITALIAN), 'white');
  const res = V.learn(a, V.fenToPieces(START), V.emptyTemplates());
  ok(res.mismatched > 0, 'yanlış FEN ile kalibrasyon uyarı verir', res.mismatched);
}

/* 6) Öğrenme birikimli: ikinci konumdan da öğrenip zor durumu düzeltir */
{
  const a = V.analyzeBoard(boardFor(KIWI, { light: [240, 217, 181], dark: [181, 136, 99] }), 'white');
  const before = V.classify(a, templates).confidence;
  const res = V.learn(a, V.fenToPieces(KIWI), templates);
  const after = V.classify(a, res.templates).confidence;
  ok(after >= before, 'ek kalibrasyon güveni düşürmez', `${before.toFixed(2)} → ${after.toFixed(2)}`);
  ok(res.templates.samples <= 12 * 6, 'örnek sayısı sınırlı kalır', res.templates.samples);
}

console.log(fails ? `\n${fails} test başarısız` : '\nTüm görüntü işleme testleri geçti');
process.exit(fails ? 1 : 0);
