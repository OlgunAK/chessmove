/*
 * openings.js — açılış repertuarı.
 *
 * Hatlar insan okuyabilir SAN dizileri olarak yazılır; kitap, baştan oynanarak
 * konum → hamle eşlemesine çevrilir. Bu sayede her hattın kurallı olduğu
 * kurulum anında (ve testlerde) doğrulanır: yazım hatası sessizce geçmez.
 *
 * color alanı hattın hangi tarafa hamle öğrettiğini söyler; yalnızca o tarafın
 * hamleleri kitaba girer, rakibin hamleleri hattı takip etmek için oynanır.
 * 'wb' her iki tarafı da katar: hem o açılışı oynamak hem de karşısında kalınca
 * hazır olmak istediğimiz hatlar için (örneğin Trompowsky).
 */
(function (root) {
  'use strict';

  const LINES = [
    /* ---------------- BEYAZ · keskin ---------------- */
    { name: 'Kral Gambiti — Kieseritzky', color: 'w', tags: ['keskin', 'gambit'], weight: 3,
      moves: 'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5' },
    { name: 'Kral Gambiti — Fil Gambiti', color: 'w', tags: ['keskin', 'gambit'], weight: 2,
      moves: 'e4 e5 f4 exf4 Bc4 Qh4+ Kf1 d6 Nc3' },
    { name: 'Kral Gambiti — reddedilen', color: 'w', tags: ['keskin', 'gambit'], weight: 2,
      moves: 'e4 e5 f4 Bc5 Nf3 d6 Nc3 Nf6 Bc4' },
    { name: 'Falkbeer Karşı Gambiti', color: 'w', tags: ['keskin', 'gambit'], weight: 2,
      moves: 'e4 e5 f4 d5 exd5 e4 d3 Nf6 Nd2' },
    { name: 'Viyana Gambiti', color: 'w', tags: ['keskin', 'gambit'], weight: 3,
      moves: 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3' },
    { name: 'Viyana — Hamppe', color: 'w', tags: ['keskin', 'gambit'], weight: 2,
      moves: 'e4 e5 Nc3 Nc6 f4 exf4 Nf3 g5 d4' },
    { name: 'Danimarka Gambiti', color: 'w', tags: ['keskin', 'gambit'], weight: 3,
      moves: 'e4 e5 d4 exd4 c3 dxc3 Bc4 cxb2 Bxb2' },
    { name: 'Evans Gambiti', color: 'w', tags: ['keskin', 'gambit'], weight: 3,
      moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4' },
    { name: 'Smith-Morra Gambiti', color: 'w', tags: ['keskin', 'gambit'], weight: 3,
      moves: 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4 e6 O-O' },
    { name: 'Grand Prix Atağı', color: 'w', tags: ['keskin'], weight: 2,
      moves: 'e4 c5 Nc3 Nc6 f4 g6 Nf3 Bg7 Bc4' },
    { name: 'Fransız — Steinitz Atağı', color: 'w', tags: ['keskin'], weight: 3,
      moves: 'e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3' },
    { name: 'Caro-Kann — Fantezi', color: 'w', tags: ['keskin'], weight: 3,
      moves: 'e4 c6 d4 d5 f3 dxe4 fxe4 e5 Nf3' },
    { name: 'İskandinav — Klasik', color: 'w', tags: ['keskin'], weight: 2,
      moves: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4' },
    { name: 'Pirc — Avusturya Atağı', color: 'w', tags: ['keskin'], weight: 3,
      moves: 'e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 c5' },
    { name: 'Modern — Avusturya', color: 'w', tags: ['keskin'], weight: 2,
      moves: 'e4 g6 d4 Bg7 Nc3 d6 f4 Nf6 Nf3' },
    { name: 'Alekhine — Dört Piyon', color: 'w', tags: ['keskin'], weight: 2,
      moves: 'e4 Nf6 e5 Nd5 d4 d6 c4 Nb6 f4' },

    { name: 'Blackmar-Diemer Gambiti', color: 'w', tags: ['keskin', 'gambit'], weight: 3,
      moves: 'd4 d5 e4 dxe4 Nc3 Nf6 f3 exf3 Nxf3' },
    { name: 'Trompowsky', color: 'wb', tags: ['keskin'], weight: 2,
      moves: 'd4 Nf6 Bg5 e6 e4 h6 Bxf6 Qxf6 Nc3 Qd8 Nf3 d6' },
    { name: 'Benoni — Taimanov', color: 'w', tags: ['keskin'], weight: 2,
      moves: 'd4 c5 d5 Nf6 c4 e6 Nc3 exd5 cxd5 d6 e4 g6 Bb5+' },

    /* ---------------- SİYAH · keskin ---------------- */
    { name: 'Sicilya — Ejder', color: 'b', tags: ['keskin'], weight: 3,
      moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3 O-O Qd2 Nc6' },
    { name: 'Sicilya — Najdorf', color: 'b', tags: ['keskin'], weight: 3,
      moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5' },
    { name: 'Sicilya — Kapalı', color: 'b', tags: ['keskin', 'klasik'], weight: 2,
      moves: 'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6' },
    { name: 'Sicilya — Alapin', color: 'b', tags: ['keskin', 'klasik'], weight: 2,
      moves: 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6' },
    { name: 'Smith-Morra karşısında', color: 'b', tags: ['keskin'], weight: 2,
      moves: 'e4 c5 d4 cxd4 c3 dxc3 Nxc3 Nc6 Nf3 d6 Bc4 e6' },
    { name: 'Fransız — Winawer', color: 'b', tags: ['keskin'], weight: 3,
      moves: 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7' },
    { name: 'Alekhine Savunması', color: 'b', tags: ['keskin'], weight: 2,
      moves: 'e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6 O-O Be7' },
    { name: 'Benkö Gambiti', color: 'b', tags: ['keskin', 'gambit'], weight: 3,
      moves: 'd4 Nf6 c4 c5 d5 b5 cxb5 a6 bxa6 Bxa6' },
    { name: 'Budapeşte Gambiti', color: 'b', tags: ['keskin', 'gambit'], weight: 3,
      moves: 'd4 Nf6 c4 e5 dxe5 Ng4 Bf4 Nc6 Nf3 Bb4+' },
    { name: 'Kral Hint — Mar del Plata', color: 'b', tags: ['keskin'], weight: 3,
      moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7' },
    { name: 'Kral Hint — 2.Nf3', color: 'b', tags: ['keskin', 'klasik'], weight: 2,
      moves: 'd4 Nf6 Nf3 g6 c4 Bg7 Nc3 d6 e4 O-O' },
    { name: 'Grünfeld — Değişim', color: 'b', tags: ['keskin'], weight: 2,
      moves: 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7' },
    { name: 'İngiliz — Ters Sicilya', color: 'b', tags: ['keskin', 'klasik'], weight: 2,
      moves: 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5' },
    { name: '1.Nf3 — Hint düzeni', color: 'b', tags: ['keskin', 'klasik'], weight: 2,
      moves: 'Nf3 Nf6 c4 g6 Nc3 Bg7 e4 d6' },

    /* ---------------- klasik (sakin ana hatlar) ---------------- */
    { name: 'İtalyan — Giuoco Piano', color: 'w', tags: ['klasik'], weight: 3,
      moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O' },
    { name: 'İspanyol — Kapalı', color: 'w', tags: ['klasik'], weight: 3,
      moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O' },
    { name: 'Vezir Gambiti — Ortodoks', color: 'w', tags: ['klasik'], weight: 3,
      moves: 'd4 d5 c4 e6 Nc3 Nf6 Nf3 Be7 Bf4 O-O e3' },
    { name: 'Londra Sistemi', color: 'w', tags: ['klasik'], weight: 2,
      moves: 'd4 Nf6 Nf3 d5 Bf4 e6 e3 Be7 Nbd2 O-O Bd3' },
    { name: 'Nimzo-Hint', color: 'b', tags: ['klasik'], weight: 3,
      moves: 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5' },
    { name: 'Fransız — Klasik', color: 'b', tags: ['klasik'], weight: 2,
      moves: 'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7' },
    { name: 'Caro-Kann — Klasik', color: 'b', tags: ['klasik'], weight: 2,
      moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6' }
  ];

  /** SAN karşılaştırmasında şah/mat ve ünlem işaretleri önemsiz. */
  function normalizeSan(san) { return String(san).replace(/[+#!?]/g, ''); }

  /** Konum anahtarı: taş dizilimi + sıra. Açılışta bu ayrım yeterli ve
   *  rok hakkı / geçerken alma tahminlerindeki belirsizliğe dayanıklıdır. */
  function keyFromFen(fen) {
    const parts = String(fen).trim().split(/\s+/);
    return parts[0] + ' ' + (parts[1] === 'b' ? 'b' : 'w');
  }

  function addEntry(book, key, entry) {
    const list = book.get(key) || [];
    const same = list.find((e) => e.uci === entry.uci);
    if (same) {
      same.weight += entry.weight;
      if (!same.names.includes(entry.name)) same.names.push(entry.name);
    } else {
      list.push({ uci: entry.uci, san: entry.san, weight: entry.weight, names: [entry.name], tags: entry.tags });
    }
    book.set(key, list);
  }

  /**
   * Hatları oynayarak kitabı kurar.
   * @param {Object} C ChessCore
   * @param {{styles?:string[], colors?:string[]}} [opts]
   * @returns {{book:Map, errors:string[], positions:number, used:number}}
   */
  function buildBook(C, opts) {
    const o = opts || {};
    const styles = o.styles && o.styles.length ? o.styles : null;
    const book = new Map();
    const errors = [];
    let used = 0;

    for (const line of LINES) {
      if (styles && !line.tags.some((t) => styles.includes(t))) continue;
      if (o.colors && o.colors.length && !o.colors.some((c) => line.color.includes(c))) continue;
      used++;
      const pos = new C.Position();
      for (const token of line.moves.trim().split(/\s+/)) {
        const legal = pos.legalMoves();
        let match = 0, matchSan = '';
        for (const m of legal) {
          const san = pos.moveToSan(m);
          if (normalizeSan(san) === normalizeSan(token)) { match = m; matchSan = san; break; }
        }
        if (!match) {
          errors.push(`${line.name}: "${token}" bu konumda oynanamıyor (${pos.fen()})`);
          break;
        }
        const sideToMove = pos.turn === C.WHITE ? 'w' : 'b';
        if (line.color.includes(sideToMove)) {
          addEntry(book, keyFromFen(pos.fen()), {
            uci: C.moveToUci(match), san: matchSan,
            weight: line.weight || 1, name: line.name, tags: line.tags
          });
        }
        pos.makeMove(match);
      }
    }
    return { book, errors, positions: book.size, used };
  }

  /** Konumdaki kitap hamlelerini döndürür (ağırlığa göre azalan). */
  function lookup(built, fen) {
    if (!built || !built.book) return null;
    const list = built.book.get(keyFromFen(fen));
    if (!list || !list.length) return null;
    return list.slice().sort((a, b) => b.weight - a.weight);
  }

  /** Ağırlıklı rastgele seçim. */
  function pick(entries, rng) {
    if (!entries || !entries.length) return null;
    const random = rng || Math.random;
    const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
    if (total <= 0) return entries[0];
    let r = random() * total;
    for (const e of entries) {
      r -= Math.max(0, e.weight);
      if (r <= 0) return e;
    }
    return entries[entries.length - 1];
  }

  /** Repertuarda tanımlı üslup etiketleri. */
  function styles() {
    const set = new Set();
    for (const line of LINES) for (const t of line.tags) set.add(t);
    return [...set];
  }

  const API = { LINES, buildBook, lookup, pick, styles, keyFromFen, normalizeSan };
  root.ChessOpenings = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : globalThis);
