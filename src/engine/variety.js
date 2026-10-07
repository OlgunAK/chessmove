/*
 * variety.js — aday hamleler arasından seçim.
 *
 * Kural: en iyi N aday arasından rastgele biri seçilir; ancak sıralamada iki
 * aday arasında belirgin bir düşüş ("uçurum") varsa o düşüşten öncekilerle
 * yetinilir. Böylece eşdeğer hamleler arasında çeşitlilik olur ama konumu
 * bozan bir hamle asla seçilmez.
 */
(function (root) {
  'use strict';

  const MATE_THRESHOLD = 29000;

  const DEFAULTS = {
    count: 10,        // en fazla kaç aday değerlendirilsin
    gap: 50,          // iki aday arasındaki bu kadar santipiyonluk düşüş uçurum sayılır
    maxLoss: 120,     // en iyiden en fazla bu kadar geride bir hamle seçilebilir
    rng: Math.random
  };

  /**
   * @param {Array<{uci:string,san?:string,score:number,mate?:number|null}>} candidates
   *        skora göre azalan sırada aday listesi
   * @param {Object} [opts] {count, gap, maxLoss, rng}
   * @returns {{choice:Object, pool:Array, index:number, reason:string}|null}
   */
  function pickMove(candidates, opts) {
    if (!candidates || !candidates.length) return null;
    const o = Object.assign({}, DEFAULTS, opts || {});
    const sorted = candidates.slice().sort((a, b) => b.score - a.score);
    const best = sorted[0];

    let pool = sorted.slice(0, Math.max(1, o.count));
    let reason = 'aday havuzu';

    // Mat bulunduysa mat dışına çıkma; mat yiyorsak da en uzun direnci koru.
    if (best.score >= MATE_THRESHOLD) {
      pool = pool.filter((c) => c.score >= MATE_THRESHOLD);
      reason = 'mat varyantı';
    } else if (best.score <= -MATE_THRESHOLD) {
      pool = [best];
      reason = 'kaçış yok';
    } else {
      // en iyiden çok geride kalanları at
      pool = pool.filter((c) => best.score - c.score <= o.maxLoss);
      // ilk uçurumda kes
      for (let i = 1; i < pool.length; i++) {
        if (pool[i - 1].score - pool[i].score > o.gap) {
          pool = pool.slice(0, i);
          reason = 'uçurumdan önce kesildi';
          break;
        }
      }
    }

    if (!pool.length) pool = [best];
    const index = Math.min(pool.length - 1, Math.floor(o.rng() * pool.length));
    return { choice: pool[index], pool, index, reason };
  }

  const ARROW_DEFAULTS = {
    count: 6,        // kaç ok çizilsin
    scoreMix: 0.75,  // ağırlığın ne kadarı skordan, kalanı sıradan gelsin
    minSpan: 60,     // skorlar birbirine çok yakınsa bu fark varmış gibi ölçeklenir
    minWeight: 0.1   // en zayıf ok bile görünür kalsın
  };

  /**
   * Aday hamleleri tahtaya çizilecek oklara çevirir; her oka 0..1 arası bir
   * "kuvvet" verir. Ok bu kuvvete göre daha opak, daha kalın ve daha uzun çizilir.
   *
   * Kuvvet iki bileşenin karışımı: skor farkı (asıl ölçü) ve sıradaki yer
   * (skorlar neredeyse eşitken bile en iyiden en kötüye görsel bir düzen kalsın).
   */
  function arrowWeights(candidates, opts) {
    if (!candidates || !candidates.length) return [];
    const o = Object.assign({}, ARROW_DEFAULTS, opts || {});
    const list = candidates.slice().sort((a, b) => b.score - a.score).slice(0, Math.max(1, o.count));
    const best = list[0].score;
    const worst = list[list.length - 1].score;
    const span = Math.max(o.minSpan, best - worst);

    return list.map((c, i) => {
      const byScore = 1 - (best - c.score) / span;
      const byRank = list.length > 1 ? 1 - i / (list.length - 1) : 1;
      const mixed = o.scoreMix * byScore + (1 - o.scoreMix) * byRank;
      return {
        uci: c.uci, san: c.san, from: c.from, to: c.to,
        score: c.score, mate: c.mate == null ? null : c.mate,
        rank: i,
        weight: Math.max(o.minWeight, Math.min(1, mixed))
      };
    });
  }

  const API = { pickMove, arrowWeights, DEFAULTS, ARROW_DEFAULTS, MATE_THRESHOLD };
  root.ChessVariety = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : globalThis);
