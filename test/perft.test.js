const C = require('../src/engine/chess.js');

const CASES = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];

let fail = 0;
for (const [fen, expected] of CASES) {
  const pos = new C.Position(fen);
  expected.forEach((exp, i) => {
    const got = C.perft(pos, i + 1);
    const ok = got === exp;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} d${i + 1} beklenen=${exp} gelen=${got}  ${fen.slice(0, 30)}`);
  });
}

// zobrist tutarlılığı: rastgele oyunlarda artımlı anahtar = sıfırdan hesap
const pos = new C.Position();
for (let g = 0; g < 200; g++) {
  const moves = pos.legalMoves();
  if (!moves.length || pos.history.length > 60) { while (pos.history.length) pos.undoMove(); continue; }
  pos.makeMove(moves[(Math.random() * moves.length) | 0]);
  const a = pos.keyA, b = pos.keyB;
  pos.recomputeKey();
  if (a !== pos.keyA || b !== pos.keyB) { console.log('FAIL zobrist', pos.fen()); fail++; break; }
}
// FEN gidiş-dönüş
const rt = new C.Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
if (rt.fen() !== 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1') { console.log('FAIL fen'); fail++; }

console.log(fail ? `\n${fail} test başarısız` : '\nTüm testler geçti');
process.exit(fail ? 1 : 0);
