/*
 * Arama motoru testleri: taktik bulma, çok hamleli (MultiPV) aday üretimi,
 * aday skorlarının birbiriyle tutarlılığı.
 */
require('../src/engine/chess.js');
require('../src/engine/evaluate.js');
const C = globalThis.ChessCore;
const S = require('../src/engine/search.js');
const Variety = require('../src/engine/variety.js');

let fails = 0;
const ok = (cond, name, extra) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  → ' + extra}`); };

/* 1) Doğrulanmış taktikler */
const TACTICS = [
  ['6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'a1a8', 1, 'arka sıra matı'],
  ['r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'f3f7', 1, 'çoban matı'],
  ['r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 1', 'd5f6', 2, 'Nf6+ ile mat (2 hamlede)'],
  ['1k1r4/pp1b1R2/3q2pp/4p3/2B5/4Q3/PPP2B2/2K5 b - - 0 1', 'd6d1', 3, 'vezir fedasıyla mat (Qd1+)'],
  ['2rr3k/pp3pp1/1nnqbN1p/3pN3/2pP4/2P3Q1/PPB4P/R4RK1 w - - 0 1', 'g3g6', 2, 'vezir fedası (Qg6)']
];
for (const [fen, expect, mateIn, name] of TACTICS) {
  const r = new S.Searcher().go(new C.Position(fen), { movetime: 3000, depth: 16 });
  const okMove = r.best && r.best.uci === expect;
  const okMate = mateIn == null || r.mate === mateIn;
  ok(okMove && okMate, `taktik: ${name}`, `${r.best && r.best.uci} (${r.san}) mat=${r.mate} skor=${r.score}`);
}

/* 2) MultiPV aday listesi */
const MP_FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'
];
const DEPTH = 6, MARGIN = 120;

for (const fen of MP_FENS) {
  const label = fen.slice(0, 16);
  const r = new S.Searcher().go(new C.Position(fen), { movetime: 60000, depth: DEPTH, multiPv: 10, multiPvMargin: MARGIN });
  const c = r.candidates;

  const sorted = c.every((x, i) => i === 0 || c[i - 1].score >= x.score);
  const inMargin = c.every((x) => c[0].score - x.score <= MARGIN);
  const headIsBest = c[0].uci === r.best.uci;
  const unique = new Set(c.map((x) => x.uci)).size === c.length;
  const legal = c.every((x) => new C.Position(fen).moveFromUci(x.uci) !== 0);
  ok(c.length >= 2 && sorted && inMargin && headIsBest && unique && legal,
    `aday listesi tutarlı (${label})`,
    `n=${c.length} sıralı=${sorted} pay=${inMargin} baş=${headIsBest} tekil=${unique} kurallı=${legal}`);

  // Aralarında belirgin fark olan adaylar için sıralama bağımsız aramayla doğrulanmalı.
  // (Uçurum kuralı tam olarak bu farka güvenir.)
  const reference = new Map();
  for (const cand of c) {
    const pos = new C.Position(fen);
    pos.makeMove(pos.moveFromUci(cand.uci));
    reference.set(cand.uci, -new S.Searcher().go(pos, { movetime: 60000, depth: DEPTH - 1 }).score);
  }
  const disagreements = [];
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      if (c[i].score - c[j].score <= 60) continue;             // yakın adaylarda sıra önemli değil
      if (reference.get(c[i].uci) < reference.get(c[j].uci) - 20) {
        disagreements.push(`${c[i].uci}(${c[i].score}/${reference.get(c[i].uci)}) < ${c[j].uci}(${c[j].score}/${reference.get(c[j].uci)})`);
      }
    }
  }
  ok(disagreements.length === 0, `belirgin farklar bağımsız aramayla doğrulanıyor (${label})`, disagreements.join(' | '));
}

/* 3) MultiPV açıkken en iyi hamle değişmemeli */
{
  const fen = MP_FENS[1];
  const plain = new S.Searcher().go(new C.Position(fen), { movetime: 60000, depth: 7 });
  const multi = new S.Searcher().go(new C.Position(fen), { movetime: 60000, depth: 7, multiPv: 10, multiPvMargin: 100 });
  // Birkaç hamlenin eşdeğer olduğu konumlarda iki arama farklı birini seçebilir;
  // önemli olan seçilenin diğerinin aday listesinde ve skorca yakın olması.
  const twin = multi.candidates.find((c) => c.uci === plain.best.uci);
  ok(!!twin, 'tek hamleli aramanın seçimi aday listesinde var', `${plain.best.uci} ∉ ${multi.candidates.map((c) => c.uci).join(',')}`);
  ok(twin && Math.abs(twin.score - multi.candidates[0].score) <= 30, 'iki aramanın seçimleri skorca yakın',
    twin ? `${twin.score} / ${multi.candidates[0].score}` : '-');
  ok(Math.abs(plain.score - multi.score) <= 30, 'en iyi skor yakın kalıyor', `${plain.score} / ${multi.score}`);
  ok(plain.candidates.length === 1, 'çeşitlilik kapalıyken tek aday döner', plain.candidates.length);
}

/* 4) Mat varsa çeşitlilik mat dışına çıkmaz */
{
  const r = new S.Searcher().go(new C.Position('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4'),
    { movetime: 2000, depth: 8, multiPv: 10, multiPvMargin: 150 });
  let wrong = 0;
  for (let i = 0; i < 50; i++) {
    const pick = Variety.pickMove(r.candidates, { rng: Math.random });
    if (pick.choice.uci !== 'f3f7') wrong++;
  }
  ok(wrong === 0, 'çeşitlilik açıkken 50 denemede de mat oynanır', wrong + ' sapma');
}

console.log(fails ? `\n${fails} test başarısız` : '\nTüm arama testleri geçti');
process.exit(fails ? 1 : 0);
