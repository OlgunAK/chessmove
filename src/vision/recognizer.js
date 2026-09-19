/*
 * recognizer.js — ekran görüntüsünden taş tanıma.
 *
 * Akış: kare kırpma → zemin rengi kestirimi → ön plan maskesi (Otsu) →
 *       siluet betimleyicisi → öğrenilmiş şablonlarla en yakın komşu eşleme.
 *
 * Saf JavaScript; girdi olarak {data:Uint8ClampedArray, width, height} (RGBA) alır,
 * böylece tarayıcıda ImageData ile, testlerde sentetik görüntülerle çalışır.
 */
(function (root) {
  'use strict';

  const GRID = 16;                 // betimleyici ızgarası (GRID x GRID)
  const GRID_LEN = GRID * GRID;
  const EXTRA = 5;                       // ızgaralardan sonraki sayısal öznitelikler
  const DESC_LEN = GRID_LEN * 2 + EXTRA; // [kare ızgarası | kutu ızgarası | öznitelikler]
  const FILES = 'abcdefgh';
  const TEMPLATE_VERSION = 3;
  const MAX_EXEMPLARS = 6;

  /* ----------------------------- yardımcılar ----------------------------- */

  function median(arr) {
    if (!arr.length) return 0;
    const a = Float64Array.from(arr).sort();
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function medianColor(samples) {
    return [
      median(samples.map((s) => s[0])),
      median(samples.map((s) => s[1])),
      median(samples.map((s) => s[2]))
    ];
  }

  function colorDist(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }

  function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

  function squareName(file, rank) { return FILES[file] + (rank + 1); }

  /** Ekran ızgarasındaki (sütun, satır) konumunu tahta yönüne göre kare adına çevirir. */
  function gridToSquare(col, row, orientation) {
    const file = orientation === 'white' ? col : 7 - col;
    const rank = orientation === 'white' ? 7 - row : row;
    return squareName(file, rank);
  }

  /* ------------------------- zemin rengi kestirimi ------------------------ */

  /** Karenin dört köşesinden renk örnekleyip ortancasını döndürür. */
  function cornerSamples(img, x0, y0, size) {
    const patch = Math.max(2, Math.round(size * 0.09));
    const corners = [[0, 0], [size - patch, 0], [0, size - patch], [size - patch, size - patch]];
    const out = [];
    for (const [cx, cy] of corners) {
      const px = [];
      for (let y = 0; y < patch; y++) {
        for (let x = 0; x < patch; x++) {
          const ix = x0 + cx + x, iy = y0 + cy + y;
          if (ix < 0 || iy < 0 || ix >= img.width || iy >= img.height) continue;
          const o = (iy * img.width + ix) * 4;
          px.push([img.data[o], img.data[o + 1], img.data[o + 2]]);
        }
      }
      if (px.length) out.push(medianColor(px));
    }
    return out;
  }

  /* --------------------------- eşikleme (Otsu) --------------------------- */

  function otsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < hist.length; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, threshold = 0;
    for (let t = 0; t < hist.length; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = t; }
    }
    return threshold;
  }

  /* --------------------------- kare çözümlemesi --------------------------- */

  /**
   * Tek bir kareyi çözümler.
   * @returns {{occupied:boolean, fill:number, desc:Float32Array|null, luma:number, bg:number[]}}
   */
  function analyzeSquare(img, x0, y0, size, parityBg) {
    const inset = Math.round(size * 0.05);
    const x = x0 + inset, y = y0 + inset;
    const s = Math.max(4, size - inset * 2);

    // zemin: kendi köşeleri tutarlıysa onlar, değilse aynı renkteki karelerin ortancası
    const corners = cornerSamples(img, x, y, s);
    let bg = parityBg;
    if (corners.length === 4) {
      let maxPair = 0;
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) maxPair = Math.max(maxPair, colorDist(corners[i], corners[j]));
      if (maxPair < 90) bg = medianColor(corners);
    }

    // zemine uzaklık haritası
    const n = s * s;
    const dist = new Uint8Array(n);
    const hist = new Uint32Array(256);
    let k = 0;
    for (let yy = 0; yy < s; yy++) {
      for (let xx = 0; xx < s; xx++) {
        const o = ((y + yy) * img.width + (x + xx)) * 4;
        const d = Math.min(255, Math.round((
          Math.abs(img.data[o] - bg[0]) + Math.abs(img.data[o + 1] - bg[1]) + Math.abs(img.data[o + 2] - bg[2])
        ) / 3));
        dist[k++] = d;
        hist[d]++;
      }
    }

    let t = otsu(hist, n);
    if (t < 14) t = 14;                       // gürültüyü taş sanmayalım

    const mask = new Uint8Array(n);
    let fgCount = 0, distSum = 0;
    for (let i = 0; i < n; i++) {
      if (dist[i] > t) { mask[i] = 1; fgCount++; distSum += dist[i]; }
    }

    const fill = fgCount / n;
    const meanDist = fgCount ? distSum / fgCount : 0;
    if (fill < 0.05 || fill > 0.97 || meanDist < 22) {
      return { occupied: false, fill, desc: null, luma: 0, bg };
    }

    // en büyük bağlantılı bileşeni tut (gölge/kenar artıklarını at)
    keepLargestComponent(mask, s, s);

    // Histerezis: güçlü eşiği geçen pikseller tohum, komşuluktan zayıf eşiği geçenler
    // maskeye katılır. Koyu temalarda taşın koyu dış çizgisi zemine yakın kaldığı için
    // tek eşikle siluet küçülüyordu; büyütme bunu geri kazandırır.
    grow(mask, dist, s, s, Math.max(7, Math.round(t * 0.35)));

    // Açık zeminde duran açık renkli taşta yalnızca koyu dış çizgi eşiği geçer;
    // maskenin içini doldurunca hem siluet hem de gerçek taş rengi geri gelir.
    fillHoles(mask, s, s);

    fgCount = 0;
    for (let i = 0; i < n; i++) if (mask[i]) fgCount++;
    const fill2 = fgCount / n;
    if (fill2 < 0.05 || fill2 > 0.97) return { occupied: false, fill: fill2, desc: null, luma: 0, bg };

    // taş rengi: silueti aşındırıp iç piksellerin parlaklık ortancası
    const core = erodeTimes(mask, s, s, Math.max(1, Math.round(s * 0.06)));
    const lumas = [];
    for (let yy = 0; yy < s; yy++) {
      for (let xx = 0; xx < s; xx++) {
        if (!core[yy * s + xx]) continue;
        const o = ((y + yy) * img.width + (x + xx)) * 4;
        lumas.push(luma(img.data[o], img.data[o + 1], img.data[o + 2]));
      }
    }
    const pieceLuma = lumas.length ? median(lumas) : 128;

    return { occupied: true, fill: fill2, desc: describe(mask, s, s), luma: pieceLuma, bg };
  }

  function keepLargestComponent(mask, w, h) {
    const labels = new Int32Array(w * h).fill(-1);
    const stack = new Int32Array(w * h);
    let bestLabel = -1, bestSize = 0, label = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || labels[i] >= 0) continue;
      let sp = 0, size = 0;
      stack[sp++] = i;
      labels[i] = label;
      while (sp) {
        const p = stack[--sp];
        size++;
        const px = p % w, py = (p / w) | 0;
        if (px > 0 && mask[p - 1] && labels[p - 1] < 0) { labels[p - 1] = label; stack[sp++] = p - 1; }
        if (px < w - 1 && mask[p + 1] && labels[p + 1] < 0) { labels[p + 1] = label; stack[sp++] = p + 1; }
        if (py > 0 && mask[p - w] && labels[p - w] < 0) { labels[p - w] = label; stack[sp++] = p - w; }
        if (py < h - 1 && mask[p + w] && labels[p + w] < 0) { labels[p + w] = label; stack[sp++] = p + w; }
      }
      if (size > bestSize) { bestSize = size; bestLabel = label; }
      label++;
    }
    for (let i = 0; i < mask.length; i++) if (mask[i] && labels[i] !== bestLabel) mask[i] = 0;
  }

  /** Tohum maskesini, zayıf eşiği geçen komşu piksellere doğru büyütür. */
  function grow(mask, dist, w, h, weak) {
    const stack = new Int32Array(w * h);
    let sp = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) stack[sp++] = i;
    const push = (i) => { if (!mask[i] && dist[i] > weak) { mask[i] = 1; stack[sp++] = i; } };
    while (sp) {
      const p = stack[--sp];
      const px = p % w, py = (p / w) | 0;
      if (px > 0) push(p - 1);
      if (px < w - 1) push(p + 1);
      if (py > 0) push(p - w);
      if (py < h - 1) push(p + w);
    }
  }

  /** Maskenin kapalı boşluklarını doldurur (kenardan erişilemeyen pikseller iç sayılır). */
  function fillHoles(mask, w, h) {
    const outside = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;
    const seed = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (sp) {
      const p = stack[--sp];
      const px = p % w, py = (p / w) | 0;
      if (px > 0) seed(p - 1);
      if (px < w - 1) seed(p + 1);
      if (py > 0) seed(p - w);
      if (py < h - 1) seed(p + w);
    }
    let added = 0, before = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) before++;
    for (let i = 0; i < mask.length; i++) if (!mask[i] && !outside[i]) added++;
    // Taş kare kenarına değip siluet açık kalmışsa doldurma taşar; böyle durumda vazgeç.
    if (before + added > mask.length * 0.95) return;
    for (let i = 0; i < mask.length; i++) if (!mask[i] && !outside[i]) mask[i] = 1;
  }

  function erodeTimes(mask, w, h, times) {
    let cur = mask;
    for (let i = 0; i < times; i++) {
      const next = erode(cur, w, h);
      if (next === cur) break;
      cur = next;
    }
    return cur;
  }

  function erode(mask, w, h) {
    const out = new Uint8Array(mask.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w]) out[i] = 1;
      }
    }
    let any = false;
    for (let i = 0; i < out.length; i++) if (out[i]) { any = true; break; }
    return any ? out : mask;   // tamamen erimişse önceki maske
  }

  /**
   * Maskeden siluet betimleyicisi üretir. İki ızgara birlikte tutulur:
   *  - KARE çerçevesine göre: taşın kare içindeki gerçek boyunu ve konumunu korur
   *    (şah piyondan uzundur), ama maske biraz taşarsa kayar.
   *  - SINIRLAYICI KUTUya göre: ölçekten bağımsız saf biçim; boy bilgisini atar.
   * Tek başına her biri bazı karışmalar üretiyor, ikisinin toplamı ikisini de düzeltir.
   * Sonda kutu ölçüleri, doluluk ve ağırlık merkezi yer alır.
   */
  function describe(mask, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    let count = 0, sumX = 0, sumY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++; sumX += x; sumY += y;
      }
    }
    if (maxX < 0) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;

    const desc = new Float32Array(DESC_LEN);
    sampleGrid(mask, w, h, 0, 0, w, h, desc, 0);
    sampleGrid(mask, w, h, minX, minY, bw, bh, desc, GRID_LEN);

    const o = GRID_LEN * 2;
    desc[o] = bw / w;                 // genişlik
    desc[o + 1] = bh / h;             // yükseklik
    desc[o + 2] = count / (w * h);    // doluluk
    desc[o + 3] = (sumY / count) / h; // dikey ağırlık merkezi
    desc[o + 4] = (sumX / count) / w; // yatay ağırlık merkezi
    return desc;
  }

  /** Maskenin (x0,y0,rw,rh) bölgesini GRID x GRID doluluk oranlarına indirger. */
  function sampleGrid(mask, w, h, x0, y0, rw, rh, out, offset) {
    const counts = new Float32Array(GRID_LEN);
    const totals = new Float32Array(GRID_LEN);
    for (let y = 0; y < rh; y++) {
      const gy = Math.min(GRID - 1, Math.floor(y * GRID / rh));
      const sy = y0 + y;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < rw; x++) {
        const sx = x0 + x;
        if (sx < 0 || sx >= w) continue;
        const gi = gy * GRID + Math.min(GRID - 1, Math.floor(x * GRID / rw));
        totals[gi]++;
        if (mask[sy * w + sx]) counts[gi]++;
      }
    }
    for (let i = 0; i < GRID_LEN; i++) out[offset + i] = totals[i] ? counts[i] / totals[i] : 0;
  }

  const SCALAR_WEIGHT = [0.30, 0.45, 0.30, 0.40, 0.15];

  function descriptorDistance(a, b) {
    let sqSum = 0, bbSum = 0;
    for (let i = 0; i < GRID_LEN; i++) {
      const d1 = a[i] - b[i]; sqSum += d1 * d1;
      const d2 = a[GRID_LEN + i] - b[GRID_LEN + i]; bbSum += d2 * d2;
    }
    let dist = Math.sqrt(sqSum / GRID_LEN) + Math.sqrt(bbSum / GRID_LEN);
    const o = GRID_LEN * 2;
    for (let i = 0; i < EXTRA; i++) dist += Math.abs(a[o + i] - b[o + i]) * SCALAR_WEIGHT[i];
    return dist;
  }

  /* ---------------------------- tahta çözümleme --------------------------- */

  /**
   * @param {{data:Uint8ClampedArray,width:number,height:number}} img  kare kırpılmış tahta
   * @param {string} orientation 'white' | 'black'
   */
  function analyzeBoard(img, orientation) {
    const size = Math.min(img.width, img.height);
    const q = size / 8;

    // önce her karenin köşe rengini topla, aynı renkteki kareler için ortanca al
    const byParity = [[], []];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const x0 = Math.round(col * q), y0 = Math.round(row * q);
        const s = Math.round(q);
        const inset = Math.round(s * 0.05);
        const samples = cornerSamples(img, x0 + inset, y0 + inset, Math.max(4, s - inset * 2));
        if (samples.length) byParity[(col + row) % 2].push(medianColor(samples));
      }
    }
    const parityBg = [
      byParity[0].length ? medianColor(byParity[0]) : [235, 236, 208],
      byParity[1].length ? medianColor(byParity[1]) : [119, 149, 86]
    ];

    const squares = {};
    const lumas = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const x0 = Math.round(col * q), y0 = Math.round(row * q);
        const s = Math.round(q);
        const res = analyzeSquare(img, x0, y0, s, parityBg[(col + row) % 2]);
        const name = gridToSquare(col, row, orientation);
        squares[name] = res;
        if (res.occupied) lumas.push(res.luma);
      }
    }

    // taş rengi eşiği: parlaklıkları iki kümeye ayır
    const split = splitLuma(lumas);
    for (const name in squares) {
      const sq = squares[name];
      sq.color = sq.occupied ? (sq.luma >= split ? 'w' : 'b') : null;
    }

    return { squares, parityBg, lumaSplit: split, occupied: lumas.length };
  }

  /** Parlaklık dizisini iki kümeye ayıran eşik (1B k-ortalama). */
  function splitLuma(lumas) {
    if (lumas.length < 2) return 128;
    const sorted = Float64Array.from(lumas).sort();
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    if (hi - lo < 45) return lo < 128 ? 255 : -1;   // tek renk var: hepsi aynı tarafta
    let c1 = lo, c2 = hi;
    for (let it = 0; it < 24; it++) {
      let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
      for (const v of sorted) {
        if (Math.abs(v - c1) <= Math.abs(v - c2)) { s1 += v; n1++; } else { s2 += v; n2++; }
      }
      const nc1 = n1 ? s1 / n1 : c1, nc2 = n2 ? s2 / n2 : c2;
      if (Math.abs(nc1 - c1) < 0.5 && Math.abs(nc2 - c2) < 0.5) { c1 = nc1; c2 = nc2; break; }
      c1 = nc1; c2 = nc2;
    }
    return (c1 + c2) / 2;
  }

  /* ------------------------------ şablonlar ------------------------------ */

  function emptyTemplates() {
    return { version: TEMPLATE_VERSION, byPiece: {}, trainedAt: 0, samples: 0 };
  }

  function packDesc(desc) {
    const out = new Array(DESC_LEN);
    for (let i = 0; i < GRID_LEN * 2; i++) out[i] = Math.round(desc[i] * 255);
    for (let i = 0; i < EXTRA; i++) out[GRID_LEN * 2 + i] = Math.round(desc[GRID_LEN * 2 + i] * 1000);
    return out;
  }

  function unpackDesc(arr) {
    const out = new Float32Array(DESC_LEN);
    for (let i = 0; i < GRID_LEN * 2; i++) out[i] = arr[i] / 255;
    for (let i = 0; i < EXTRA; i++) out[GRID_LEN * 2 + i] = arr[GRID_LEN * 2 + i] / 1000;
    return out;
  }

  /** FEN'deki doğru konumu kullanarak şablon dağarcığını günceller. */
  function learn(analysis, pieces, templates) {
    const tpl = templates && templates.version === TEMPLATE_VERSION ? templates : emptyTemplates();
    let learned = 0, mismatched = 0;
    for (const name in pieces) {
      const piece = pieces[name];
      const sq = analysis.squares[name];
      if (!sq || !sq.occupied || !sq.desc) { mismatched++; continue; }
      const list = (tpl.byPiece[piece] = tpl.byPiece[piece] || []);
      list.push(packDesc(sq.desc));
      if (list.length > MAX_EXEMPLARS) list.shift();
      learned++;
    }
    // FEN'de boş olup dolu görünen kareler de uyumsuzluk sayılır
    for (const name in analysis.squares) {
      if (analysis.squares[name].occupied && !pieces[name]) mismatched++;
    }
    tpl.trainedAt = Date.now();
    tpl.samples = Object.values(tpl.byPiece).reduce((a, l) => a + l.length, 0);
    return { templates: tpl, learned, mismatched };
  }

  /**
   * Çözümlenmiş tahtayı şablonlarla eşleyip taş sözlüğü üretir.
   *
   * Saf en-yakın-komşu eşlemeye satranç kısıtları eklenir: piyon 1. ve 8. yatayda
   * olamaz, her renkte tam olarak bir şah bulunur, piyon sayısı sekizi geçemez.
   * Bu kısıtlar hem tanıma hatalarını düzeltir hem de motorun kabul edeceği bir
   * konum üretilmesini garantiler (şahsız konum aranamaz).
   *
   * @param {Object} analysis analyzeBoard çıktısı
   * @param {Object} templates öğrenilmiş şablonlar
   * @param {{assumeKings?:boolean}} [opts]
   */
  function classify(analysis, templates, opts) {
    const assumeKings = !opts || opts.assumeKings !== false;
    const cache = {};
    const exemplars = (piece) => {
      if (!cache[piece]) {
        const raw = (templates && templates.byPiece && templates.byPiece[piece]) || [];
        cache[piece] = raw.map(unpackDesc);
      }
      return cache[piece];
    };

    // 1) her dolu kare için aday uzaklıkları
    const cells = [];
    for (const name in analysis.squares) {
      const sq = analysis.squares[name];
      if (!sq.occupied || !sq.desc) continue;
      const white = sq.color === 'w';
      const rank = +name[1];
      const dist = {};
      let any = false;
      for (const type of ['K', 'Q', 'R', 'B', 'N', 'P']) {
        const piece = white ? type : type.toLowerCase();
        if (type === 'P' && (rank === 1 || rank === 8)) { dist[piece] = Infinity; continue; }
        let d = Infinity;
        for (const ex of exemplars(piece)) d = Math.min(d, descriptorDistance(sq.desc, ex));
        dist[piece] = d;
        if (d < Infinity) any = true;
      }
      cells.push({ name, white, dist, any, banned: new Set() });
    }

    const bestOf = (cell) => {
      let best = null, bestD = Infinity, secondD = Infinity;
      for (const piece in cell.dist) {
        if (cell.banned.has(piece)) continue;
        const d = cell.dist[piece];
        if (d < bestD) { secondD = bestD; bestD = d; best = piece; }
        else if (d < secondD) secondD = d;
      }
      return { piece: best, d: bestD, second: secondD };
    };

    // 2) her renk için tam bir şah
    if (assumeKings) {
      for (const white of [true, false]) {
        const king = white ? 'K' : 'k';
        const group = cells.filter((c) => c.white === white && c.any);
        if (!group.length) continue;
        let chosen = null, bestDelta = Infinity;
        for (const c of group) {
          const kd = c.dist[king];
          if (!(kd < Infinity)) continue;
          let other = Infinity;
          for (const piece in c.dist) if (piece !== king) other = Math.min(other, c.dist[piece]);
          const delta = kd - other;               // şaha ne kadar "daha yakın"
          if (delta < bestDelta) { bestDelta = delta; chosen = c; }
        }
        for (const c of group) if (c !== chosen) c.banned.add(king);
        if (chosen) chosen.forced = king;
      }
    }

    // 3) renk başına en çok sekiz piyon
    for (const white of [true, false]) {
      const pawn = white ? 'P' : 'p';
      const claiming = cells.filter((c) => !c.forced && c.white === white && bestOf(c).piece === pawn);
      if (claiming.length <= 8) continue;
      claiming
        .map((c) => ({ c, margin: bestOf(c).second - c.dist[pawn] }))
        .sort((a, b) => b.margin - a.margin)      // en zayıf gerekçeliler vazgeçer
        .slice(8)
        .forEach(({ c }) => c.banned.add(pawn));
    }

    // 4) son atama
    const pieces = {};
    const perSquare = {};
    let worst = 1, unknown = 0;
    for (const cell of cells) {
      if (!cell.any) {
        unknown++;
        perSquare[cell.name] = { piece: null, confidence: 0 };
        continue;
      }
      let piece, d, second;
      if (cell.forced) {
        piece = cell.forced;
        d = cell.dist[piece];
        second = bestOf({ dist: cell.dist, banned: new Set([piece]) }).d;
      } else {
        const b = bestOf(cell);
        piece = b.piece; d = b.d; second = b.second;
      }
      if (!piece || !(d < Infinity)) {
        unknown++;
        perSquare[cell.name] = { piece: null, confidence: 0 };
        continue;
      }
      const conf = second === Infinity ? 0.5 : Math.max(0, Math.min(1, 1 - d / (second + 1e-6)));
      pieces[cell.name] = piece;
      perSquare[cell.name] = { piece, confidence: conf, distance: d };
      if (conf < worst) worst = conf;
    }

    return { pieces, perSquare, confidence: unknown ? 0 : worst, unknown };
  }

  function piecesToFenBoard(pieces) {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = pieces[squareName(file, rank)];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
      if (empty) out += empty;
      if (rank) out += '/';
    }
    return out;
  }

  function fenToPieces(fen) {
    const rows = String(fen).trim().split(/\s+/)[0].split('/');
    const pieces = {};
    for (let i = 0; i < rows.length && i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (ch >= '1' && ch <= '8') { file += +ch; continue; }
        pieces[squareName(file, rank)] = ch;
        file++;
      }
    }
    return pieces;
  }

  const API = {
    GRID, GRID_LEN, DESC_LEN, EXTRA, TEMPLATE_VERSION,
    analyzeBoard, analyzeSquare, classify, learn, emptyTemplates,
    describe, descriptorDistance, packDesc, unpackDesc,
    piecesToFenBoard, fenToPieces, gridToSquare, splitLuma
  };
  root.ChessVision = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : globalThis);
