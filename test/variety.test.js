/*
 * Aday seçim kuralının testleri: uçurum kesme, en fazla kayıp sınırı,
 * mat koruması ve rastgeleliğin havuz içinde kalması.
 */
const Variety = require('../src/engine/variety.js');

let fails = 0;
const ok = (cond, name, extra) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  → ' + extra}`); };

const cand = (uci, score, mate) => ({ uci, san: uci, score, mate: mate == null ? null : mate });

/* 1) Uçurum: belirgin düşüşten sonrakiler havuza girmez */
{
  const list = [cand('a', 40), cand('b', 35), cand('c', 30), cand('d', -60), cand('e', -70)];
  const pick = Variety.pickMove(list, { gap: 50, rng: () => 0.99 });
  ok(pick.pool.length === 3, 'uçurumdan önceki üç aday havuzda', pick.pool.map((c) => c.uci).join(''));
  ok(['a', 'b', 'c'].includes(pick.choice.uci), 'seçim havuzun içinden', pick.choice.uci);
  ok(pick.reason === 'uçurumdan önce kesildi', 'kesme gerekçesi bildirilir', pick.reason);
}

/* 2) Uçurum hemen başta ise tek hamle kalır */
{
  const list = [cand('a', 300), cand('b', 10), cand('c', 5)];
  const pick = Variety.pickMove(list, { gap: 50, rng: () => 0.99 });
  ok(pick.pool.length === 1 && pick.choice.uci === 'a', 'tek üstün hamle varsa o oynanır', pick.pool.map((c) => c.uci).join(''));
}

/* 3) Uçurum yoksa tüm adaylar aday, ama sayı ve kayıp sınırları geçerli */
{
  const list = Array.from({ length: 14 }, (_, i) => cand('m' + i, 50 - i * 8));
  const pick = Variety.pickMove(list, { gap: 50, count: 10, maxLoss: 60, rng: () => 0 });
  ok(pick.pool.length <= 10, 'aday sayısı sınırı uygulanır', pick.pool.length);
  ok(pick.pool.every((c) => 50 - c.score <= 60), 'en fazla kayıp sınırı uygulanır',
    pick.pool.map((c) => c.score).join(','));
}

/* 4) Mat koruması */
{
  const mate = [cand('m1', 29998, 1), cand('m2', 29994, 3), cand('q', 250)];
  for (let i = 0; i < 20; i++) {
    const pick = Variety.pickMove(mate, { gap: 10000, maxLoss: 100000, rng: Math.random });
    if (pick.choice.score < Variety.MATE_THRESHOLD) { ok(false, 'mat varken mat dışı hamle seçilmez', pick.choice.uci); break; }
    if (i === 19) ok(true, 'mat varken hep mat varyantı seçilir', '');
  }
  // -29990 (5 hamlede mat) -29998'den (1 hamlede mat) iyidir: en uzun direniş seçilmeli
  const lost = [cand('a', -29998, -1), cand('b', -29990, -5)];
  const pick = Variety.pickMove(lost, { rng: () => 0.99 });
  ok(pick.pool.length === 1 && pick.choice.uci === 'b', 'kayıp konumda en uzun direniş korunur', pick.choice.uci);
}

/* 5) Rastgelelik havuzu gerçekten dolaşıyor mu */
{
  const list = [cand('a', 20), cand('b', 18), cand('c', 16), cand('d', 15)];
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(Variety.pickMove(list, { gap: 50, rng: Math.random }).choice.uci);
  ok(seen.size === 4, 'havuzdaki her aday zamanla seçilebiliyor', [...seen].join(''));
}

/* 6) Sıralanmamış liste de doğru işlenir */
{
  const list = [cand('c', 10), cand('a', 90), cand('b', 85)];
  const pick = Variety.pickMove(list, { gap: 50, rng: () => 0 });
  ok(pick.pool.length === 2 && pick.choice.uci === 'a', 'liste kendi içinde sıralanır', pick.pool.map((c) => c.uci).join(''));
}

/* 7) Sınır durumları */
{
  ok(Variety.pickMove([], {}) === null, 'boş liste null döner', '');
  ok(Variety.pickMove(null, {}) === null, 'liste yoksa null döner', '');
  const one = Variety.pickMove([cand('a', 5)], { rng: () => 0.999999 });
  ok(one.choice.uci === 'a', 'tek aday varsa o seçilir', one.choice.uci);
}

/* 8) Ok kuvvetleri */
{
  const withSquares = (uci, score, mate) =>
    ({ uci, san: uci, from: uci.slice(0, 2), to: uci.slice(2, 4), score, mate: mate == null ? null : mate });

  // azalan kuvvet, en iyi tam kuvvette, hepsi 0-1 arasında
  const list = [withSquares('e2e4', 40), withSquares('g1f3', 10), withSquares('b1c3', -30), withSquares('a2a3', -120)];
  const w = Variety.arrowWeights(list, { count: 10 });
  ok(w.length === 4, 'tüm adaylar ok olur', w.length);
  ok(w.every((x, i) => i === 0 || x.weight <= w[i - 1].weight), 'kuvvetler azalan',
    w.map((x) => x.weight.toFixed(2)).join(' '));
  ok(Math.abs(w[0].weight - 1) < 1e-9, 'en iyi hamle tam kuvvette', w[0].weight);
  ok(w.every((x) => x.weight > 0 && x.weight <= 1), 'kuvvetler 0-1 aralığında', w.map((x) => x.weight.toFixed(2)).join(' '));
  ok(w.every((x, i) => x.rank === i), 'sıra numaraları doğru', w.map((x) => x.rank).join(''));
  ok(w[0].from === 'e2' && w[0].to === 'e4', 'kare bilgileri taşınır', `${w[0].from}${w[0].to}`);

  // sayı sınırı
  const many = Array.from({ length: 12 }, (_, i) => withSquares('a2a3', 50 - i * 5));
  ok(Variety.arrowWeights(many, { count: 5 }).length === 5, 'ok sayısı sınırı uygulanır', '');

  // skorlar neredeyse eşitse oklar birbirine yakın kalmalı (minSpan tabanı)
  const close = [withSquares('e2e4', 20), withSquares('d2d4', 18), withSquares('g1f3', 17)];
  const cw = Variety.arrowWeights(close, { count: 3 });
  ok(cw[cw.length - 1].weight > 0.5, 'eşdeğer hamlelerin okları benzer kuvvette',
    cw.map((x) => x.weight.toFixed(2)).join(' '));

  // mat varsa tek ok baskın olmalı
  const mate = [withSquares('f3f7', 29998, 1), withSquares('e1g1', 30), withSquares('d2d4', 20)];
  const mw = Variety.arrowWeights(mate, { count: 3 });
  ok(mw[0].weight === 1 && mw[1].weight < 0.35, 'mat oku baskın, diğerleri sönük',
    mw.map((x) => x.weight.toFixed(2)).join(' '));

  // tek aday
  const single = Variety.arrowWeights([withSquares('e2e4', 15)], {});
  ok(single.length === 1 && single[0].weight === 1, 'tek aday tam kuvvet', single[0] && single[0].weight);
  ok(Variety.arrowWeights([], {}).length === 0, 'boş listede ok yok', '');
}

console.log(fails ? `\n${fails} test başarısız` : '\nTüm çeşitlilik testleri geçti');
process.exit(fails ? 1 : 0);
