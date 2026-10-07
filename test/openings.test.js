/*
 * Açılış repertuarı testleri: hatların kurallılığı, üslup süzgeci, kitap
 * aramasının doğru hamleleri vermesi ve kitabın kendi kendine oynandığında
 * tanınır açılışlara götürmesi.
 */
require('../src/engine/chess.js');
const C = globalThis.ChessCore;
const O = require('../src/engine/openings.js');

let fails = 0;
const ok = (cond, name, extra) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  → ' + extra}`); };

const seeded = (seed) => { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };

/** SAN dizisini oynayıp konumu döndürür. */
function after(sans) {
  const pos = new C.Position();
  for (const san of sans) {
    const move = pos.legalMoves().find((m) => O.normalizeSan(pos.moveToSan(m)) === O.normalizeSan(san));
    if (!move) throw new Error('oynanamadı: ' + san + ' @ ' + pos.fen());
    pos.makeMove(move);
  }
  return pos;
}

/* 1) Her üslupta tüm hatlar kurallı olmalı */
const STYLES = O.styles();
ok(STYLES.includes('keskin') && STYLES.includes('gambit') && STYLES.includes('klasik'),
  'üslup etiketleri tanımlı', STYLES.join(','));

const books = {};
for (const style of [null, 'keskin', 'gambit', 'klasik']) {
  const built = O.buildBook(C, { styles: style ? [style] : null });
  books[style || 'hepsi'] = built;
  ok(built.errors.length === 0, `hatlar kurallı (${style || 'hepsi'})`, built.errors.slice(0, 3).join(' | '));
  ok(built.positions > 10, `kitap konum üretti (${style || 'hepsi'})`, built.positions);
}
ok(books.hepsi.used === O.LINES.length, 'süzgeç olmadan tüm hatlar kullanılır', `${books.hepsi.used}/${O.LINES.length}`);
ok(books.gambit.used < books.keskin.used, 'gambit süzgeci daha az hat seçer', `${books.gambit.used} < ${books.keskin.used}`);

/* 2) Hatları yeniden oynarken kitap her kendi sıramızda o hamleyi vermeli.
 *    (Konum anahtarı rok hakkını taşımaz; bu yüzden anahtardan FEN kurup
 *    doğrulamak yanlış olur — hatları oynayarak doğruluyoruz.) */
{
  let missing = 0, illegal = 0, duplicate = 0;
  for (const line of O.LINES) {
    const pos = new C.Position();
    for (const token of line.moves.trim().split(/\s+/)) {
      const move = pos.legalMoves().find((m) => O.normalizeSan(pos.moveToSan(m)) === O.normalizeSan(token));
      if (!move) break;
      const side = pos.turn === C.WHITE ? 'w' : 'b';
      if (line.color.includes(side)) {
        const entries = O.lookup(books.hepsi, pos.fen()) || [];
        if (!entries.some((e) => e.uci === C.moveToUci(move))) missing++;
        const seen = new Set();
        for (const e of entries) {
          if (!pos.moveFromUci(e.uci)) illegal++;
          if (seen.has(e.uci)) duplicate++;
          seen.add(e.uci);
        }
      }
      pos.makeMove(move);
    }
  }
  ok(missing === 0, 'her hattın kendi hamlesi kitapta bulunuyor', missing + ' eksik');
  ok(duplicate === 0, 'aynı konumda hamle tekrarı yok', duplicate);
  ok(illegal === 0, 'hattın kendi konumunda tüm kitap hamleleri kurallı', illegal + ' hata');
}

/* 2b) Anahtar rok hakkını taşımadığı için kitap, farklı rok haklı bir
 *     transpozisyonda kurallı olmayan bir hamle önerebilir. Motor bunu
 *     süzdüğü için güvenli; burada süzmenin gerçekten gerektiğini belgeliyoruz. */
{
  const key = O.keyFromFen(after(['e4', 'c5', 'd4', 'cxd4', 'c3', 'dxc3', 'Nxc3', 'Nc6', 'Nf3', 'd6', 'Bc4', 'e6']).fen());
  const entries = books.hepsi.book.get(key) || [];
  const hasCastle = entries.some((e) => e.uci === 'e1g1');
  ok(hasCastle, 'Smith-Morra hattında rok kitapta', entries.map((e) => e.uci).join(','));
  // aynı dizilim ama rok hakkı yok: motorun süzgeci bunu atmalı
  const noRights = new C.Position(key + ' - - 0 1');
  ok(noRights.moveFromUci('e1g1') === 0, 'rok hakkı yoksa kitap hamlesi kurallı değil (süzgeç şart)', '');
}

/* 3) Repertuar beklenen açılışlara yönlendiriyor mu */
{
  const sans = (built, moves) => {
    const list = O.lookup(built, after(moves).fen());
    return (list || []).map((e) => O.normalizeSan(e.san)).sort();
  };
  const keskin = books.keskin;

  ok(sans(keskin, []).includes('e4'), 'keskin: beyaz 1.e4 oynar', sans(keskin, []).join(','));
  const afterE5 = sans(keskin, ['e4', 'e5']);
  ok(['f4', 'Nc3', 'd4'].every((m) => afterE5.includes(m)),
    'keskin: 1.e4 e5 sonrası Kral Gambiti / Viyana / Danimarka', afterE5.join(','));
  const kgAccepted = sans(keskin, ['e4', 'e5', 'f4', 'exf4']);
  ok(kgAccepted.includes('Nf3') && kgAccepted.includes('Bc4'),
    'Kral Gambiti kabul edilince Nf3 ve Bc4 hatları var', kgAccepted.join(','));
  ok(sans(keskin, ['e4', 'e5', 'f4', 'exf4', 'Nf3', 'g5', 'h4', 'g4']).includes('Ne5'),
    'Kieseritzky hattı sonuna kadar gidiyor', '');
  ok(sans(keskin, ['e4', 'c5']).includes('d4') && sans(keskin, ['e4', 'c5']).includes('Nc3'),
    'keskin: Sicilya karşısında Smith-Morra ve Grand Prix', sans(keskin, ['e4', 'c5']).join(','));
  ok(sans(keskin, ['e4', 'c6', 'd4', 'd5']).includes('f3'), 'keskin: Caro-Kann karşısında Fantezi (3.f3)',
    sans(keskin, ['e4', 'c6', 'd4', 'd5']).join(','));
  ok(sans(keskin, ['d4']).includes('Nf6'), 'keskin: siyah 1.d4\'e Nf6 ile karşılık verir', sans(keskin, ['d4']).join(','));
  const afterC4 = sans(keskin, ['d4', 'Nf6', 'c4']);
  ok(['c5', 'e5', 'g6'].every((m) => afterC4.includes(m)),
    'keskin: 2.c4 sonrası Benkö / Budapeşte / Kral Hint', afterC4.join(','));
  ok(sans(keskin, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3']).sort().join(',') === 'a6,g6',
    'Sicilya: Ejder (g6) ve Najdorf (a6)', sans(keskin, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3']).join(','));

  const klasik = books.klasik;
  ok(sans(klasik, ['e4', 'e5', 'Nf3', 'Nc6']).sort().join(',') === 'Bb5,Bc4',
    'klasik: İtalyan ve İspanyol', sans(klasik, ['e4', 'e5', 'Nf3', 'Nc6']).join(','));
  ok(!sans(klasik, ['e4', 'e5']).includes('f4'), 'klasik repertuarda Kral Gambiti yok', sans(klasik, ['e4', 'e5']).join(','));
  ok(!sans(books.gambit, ['e4', 'e5', 'Nf3', 'Nc6']).includes('Bb5'), 'gambit repertuarında İspanyol yok', '');
  ok(sans(books.gambit, ['e4', 'e5', 'Nf3', 'Nc6']).includes('Bc4'), 'gambit repertuarında Evans için Bc4 var', '');
}

/* 4) Ağırlıklı seçim: ağır hamle daha sık, ama hepsi çıkabiliyor */
{
  const entries = [
    { uci: 'e2e4', san: 'e4', weight: 30, names: ['A'] },
    { uci: 'd2d4', san: 'd4', weight: 10, names: ['B'] }
  ];
  const rng = seeded(5);
  const count = { e4: 0, d4: 0 };
  for (let i = 0; i < 4000; i++) count[O.pick(entries, rng).san]++;
  const ratio = count.e4 / count.d4;
  ok(ratio > 2.3 && ratio < 3.9, 'seçim ağırlıklara uyuyor (≈3:1)', `${count.e4}:${count.d4} = ${ratio.toFixed(2)}`);
  ok(count.d4 > 0, 'hafif hamle de seçilebiliyor', count.d4);
  ok(O.pick([], rng) === null && O.pick(null, rng) === null, 'boş girdi null döner', '');
}

/* 5) Kitap kendi kendine oynandığında tanınır bir açılış çıkıyor mu */
{
  const built = books.keskin;
  const rng = seeded(77);
  const openings = new Set();
  const lengths = [];
  let shortest = 99;
  for (let game = 0; game < 12; game++) {
    const pos = new C.Position();
    const sans = [];
    for (let ply = 0; ply < 24; ply++) {
      const entries = O.lookup(built, pos.fen());
      if (!entries) break;
      const picked = O.pick(entries, rng);
      const move = pos.moveFromUci(picked.uci);
      if (!move) { ok(false, 'kitap hamlesi oynanamadı', picked.uci + ' @ ' + pos.fen()); break; }
      sans.push(pos.moveToSan(move));
      pos.makeMove(move);
    }
    lengths.push(sans.length);
    shortest = Math.min(shortest, sans.length);
    openings.add(sans.slice(0, 6).join(' '));
  }
  // Kitap, rakip repertuardan çıkınca biter — bu bir hata değil, tasarım.
  // Ölçüt: hiçbir parti hemen bitmesin ve ortanca derinlik makul olsun.
  const sorted = lengths.slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  ok(shortest >= 3, 'hiçbir parti ilk hamlede kitapsız kalmıyor', shortest + ' yarım hamle');
  ok(median >= 8, 'ortanca kitap derinliği makul', `ortanca ${median}, en kısa ${shortest}, en uzun ${sorted[sorted.length - 1]}`);
  ok(openings.size >= 2, 'farklı partilerde farklı açılışlar çıkıyor', [...openings].join(' | '));
}

/* 6) Kitap orta oyunda devreye girmez */
{
  const middlegame = '2rr3k/pp3pp1/1nnqbN1p/3pN3/2pP4/2P3Q1/PPB4P/R4RK1 w - - 0 1';
  ok(O.lookup(books.hepsi, middlegame) === null, 'orta oyun konumu kitapta yok', '');
}

console.log(fails ? `\n${fails} test başarısız` : '\nTüm açılış testleri geçti');
process.exit(fails ? 1 : 0);
