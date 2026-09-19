/*
 * Testler için basit yazılımsal tahta çizici.
 * Gerçek taş setleri yerine birbirinden ayırt edilebilir altı siluet çizer;
 * amaç tanıma hattını (zemin kestirimi, maske, betimleyici, eşleme) doğrulamak.
 */
'use strict';

const SHAPES = {
  p: [
    { type: 'ellipse', cx: 0.50, cy: 0.30, rx: 0.16, ry: 0.16 },
    { type: 'poly', pts: [[0.32, 0.84], [0.68, 0.84], [0.60, 0.46], [0.40, 0.46]] },
    { type: 'rect', x0: 0.26, y0: 0.84, x1: 0.74, y1: 0.94 }
  ],
  r: [
    { type: 'rect', x0: 0.26, y0: 0.18, x1: 0.36, y1: 0.34 },
    { type: 'rect', x0: 0.45, y0: 0.18, x1: 0.55, y1: 0.34 },
    { type: 'rect', x0: 0.64, y0: 0.18, x1: 0.74, y1: 0.34 },
    { type: 'rect', x0: 0.28, y0: 0.30, x1: 0.72, y1: 0.80 },
    { type: 'rect', x0: 0.22, y0: 0.80, x1: 0.78, y1: 0.94 }
  ],
  n: [
    { type: 'poly', pts: [[0.32, 0.90], [0.28, 0.58], [0.36, 0.34], [0.50, 0.16], [0.70, 0.22], [0.74, 0.42], [0.58, 0.52], [0.70, 0.90]] },
    { type: 'rect', x0: 0.26, y0: 0.86, x1: 0.76, y1: 0.95 }
  ],
  b: [
    { type: 'ellipse', cx: 0.50, cy: 0.14, rx: 0.055, ry: 0.065 },
    { type: 'ellipse', cx: 0.50, cy: 0.38, rx: 0.17, ry: 0.24 },
    { type: 'poly', pts: [[0.34, 0.90], [0.66, 0.90], [0.60, 0.60], [0.40, 0.60]] },
    { type: 'rect', x0: 0.25, y0: 0.88, x1: 0.75, y1: 0.96 }
  ],
  q: [
    { type: 'poly', pts: [[0.20, 0.36], [0.27, 0.12], [0.36, 0.33], [0.50, 0.09], [0.64, 0.33], [0.73, 0.12], [0.80, 0.36], [0.70, 0.60], [0.30, 0.60]] },
    { type: 'poly', pts: [[0.32, 0.88], [0.68, 0.88], [0.66, 0.58], [0.34, 0.58]] },
    { type: 'rect', x0: 0.22, y0: 0.86, x1: 0.78, y1: 0.96 }
  ],
  k: [
    { type: 'rect', x0: 0.455, y0: 0.04, x1: 0.545, y1: 0.28 },
    { type: 'rect', x0: 0.36, y0: 0.115, x1: 0.64, y1: 0.205 },
    { type: 'ellipse', cx: 0.50, cy: 0.45, rx: 0.20, ry: 0.15 },
    { type: 'poly', pts: [[0.30, 0.88], [0.70, 0.88], [0.66, 0.42], [0.34, 0.42]] },
    { type: 'rect', x0: 0.23, y0: 0.86, x1: 0.77, y1: 0.96 }
  ]
};

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inShape(shape, x, y) {
  for (const s of shape) {
    if (s.type === 'rect') { if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) return true; }
    else if (s.type === 'ellipse') {
      const dx = (x - s.cx) / s.rx, dy = (y - s.cy) / s.ry;
      if (dx * dx + dy * dy <= 1) return true;
    } else if (s.type === 'poly') { if (inPoly(s.pts, x, y)) return true; }
  }
  return false;
}

/**
 * @param {Object} opts {size, pieces, orientation, light, dark, highlights, jitter, pieceScale}
 * @returns {{data:Uint8ClampedArray,width:number,height:number}}
 */
function renderBoard(opts) {
  const size = opts.size || 512;
  const SS = 2;                                    // kenar yumuşatma için üst örnekleme
  const W = size * SS;
  const acc = new Float32Array(W * W * 3);
  const light = opts.light || [235, 236, 208];
  const dark = opts.dark || [119, 149, 86];
  const highlight = opts.highlightColor || [246, 246, 105];
  const orientation = opts.orientation || 'white';
  const q = W / 8;
  const rnd = mulberry(opts.seed || 1);
  const FILES = 'abcdefgh';

  const squareOf = (col, row) => {
    const file = orientation === 'white' ? col : 7 - col;
    const rank = orientation === 'white' ? 7 - row : row;
    return FILES[file] + (rank + 1);
  };

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const name = squareOf(col, row);
      const isHl = opts.highlights && opts.highlights.includes(name);
      const bg = isHl ? highlight : ((col + row) % 2 === 0 ? light : dark);
      const x0 = Math.round(col * q), y0 = Math.round(row * q);
      const x1 = Math.round((col + 1) * q), y1 = Math.round((row + 1) * q);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * W + x) * 3;
          acc[o] = bg[0]; acc[o + 1] = bg[1]; acc[o + 2] = bg[2];
        }
      }

      const piece = opts.pieces[name];
      if (!piece) continue;
      const shape = SHAPES[piece.toLowerCase()];
      const isWhite = piece === piece.toUpperCase();
      const fill = isWhite ? [250, 250, 246] : [38, 36, 34];
      const edge = isWhite ? [26, 26, 26] : [140, 138, 134];

      const jit = opts.jitter || 0;
      const ox = (rnd() - 0.5) * 2 * jit * q;
      const oy = (rnd() - 0.5) * 2 * jit * q;
      const scale = (opts.pieceScale || 0.86) * (1 + (rnd() - 0.5) * (opts.scaleJitter || 0));
      const pad = (1 - scale) / 2;

      // iç/kenar ayrımı için maske
      const sw = x1 - x0, sh = y1 - y0;
      const mask = new Uint8Array(sw * sh);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const ux = (x - ox) / sw, uy = (y - oy) / sh;
          const px = (ux - pad) / scale, py = (uy - pad) / scale;
          if (px < 0 || px > 1 || py < 0 || py > 1) continue;
          if (inShape(shape, px, py)) mask[y * sw + x] = 1;
        }
      }
      const edgeW = Math.max(1, Math.round(q * 0.035));
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (!mask[y * sw + x]) continue;
          let isEdge = false;
          for (let dy = -edgeW; dy <= edgeW && !isEdge; dy++) {
            for (let dx = -edgeW; dx <= edgeW; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= sw || ny >= sh || !mask[ny * sw + nx]) { isEdge = true; break; }
            }
          }
          const c = isEdge ? edge : fill;
          const o = ((y0 + y) * W + (x0 + x)) * 3;
          acc[o] = c[0]; acc[o + 1] = c[1]; acc[o + 2] = c[2];
        }
      }
    }
  }

  // üst örneklemeden indir + hafif gürültü
  const data = new Uint8ClampedArray(size * size * 4);
  const noise = opts.noise || 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * W + (x * SS + sx)) * 3;
          r += acc[o]; g += acc[o + 1]; b += acc[o + 2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const nz = noise ? (rnd() - 0.5) * 2 * noise : 0;
      data[o] = r / n + nz; data[o + 1] = g / n + nz; data[o + 2] = b / n + nz; data[o + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { renderBoard, SHAPES };
