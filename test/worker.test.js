/*
 * Motor worker'ının testi: dilimlenmiş sürekli analiz, canlı aday akışı ve
 * en önemlisi — arama sürerken gelen "dur" mesajının işlenebilmesi.
 */
const { createWorkerSandbox } = require('./worker-sandbox.js');

let fails = 0;
const ok = (cond, name, extra) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  → ' + extra}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function bootWorker() {
  const messages = [];
  const sandbox = createWorkerSandbox((m) => messages.push(m));
  return {
    messages,
    send: (msg) => sandbox.self.onmessage({ data: msg }),
    infos: () => messages.filter((m) => m.type === 'info'),
    bestmoves: () => messages.filter((m) => m.type === 'bestmove'),
    errors: () => messages.filter((m) => m.type === 'error')
  };
}

const MIDDLE = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

(async function run() {
  /* 1) Hazır mesajı */
  {
    const w = bootWorker();
    await wait(10);
    ok(w.messages.some((m) => m.type === 'ready'), 'worker hazır bildirir', JSON.stringify(w.messages[0]));
  }

  /* 2) Derinlik sınırına kadar derinleşir, her derinlikte aday yayınlar */
  {
    const w = bootWorker();
    w.send({ id: 1, cmd: 'analyze', fen: MIDDLE, depth: 6, multiPv: 5, multiPvMargin: 300, slice: 60 });
    await wait(4000);
    const infos = w.infos();
    const depths = infos.map((i) => i.depth);
    ok(depths.length >= 5 && depths[depths.length - 1] === 6, 'derinlik sınırına kadar ilerler', depths.join(','));
    ok(depths.every((d, i) => i === 0 || d === depths[i - 1] + 1), 'derinlikler sırayla gelir', depths.join(','));
    ok(infos.every((i) => i.candidates && i.candidates.length >= 2), 'her derinlikte aday listesi yayınlanır',
      infos.map((i) => i.candidates.length).join(','));
    const final = w.bestmoves();
    ok(final.length === 1 && final[0].complete === true, 'bitişte tek sonuç ve tamamlandı işareti',
      `${final.length} / ${final[0] && final[0].complete}`);
    ok(final[0].id === 1, 'sonuç istek kimliğini taşır', final[0].id);
  }

  /* 3) ASIL SINAV: arama sürerken gelen "dur" işlenebiliyor mu */
  {
    const w = bootWorker();
    w.send({ id: 7, cmd: 'analyze', fen: MIDDLE, depth: 30, multiPv: 5, multiPvMargin: 300, slice: 60 });
    await wait(500);
    const beforeStop = w.infos().length;

    // Gerçek worker'da "dur" mesajı kuyruğa girer ve ancak arama denetimi olay
    // döngüsüne bıraktığında işlenir. Burada da setTimeout ile kuyruğa sokuyoruz:
    // ölçtüğümüz şey, bloklayıcı aramanın mesajı ne kadar beklettiği.
    const t0 = Date.now();
    let handledAt = 0;
    setTimeout(() => { w.send({ cmd: 'stop' }); handledAt = Date.now(); }, 0);
    await wait(400);
    const latency = handledAt ? handledAt - t0 : Infinity;
    const finals = w.bestmoves();
    ok(finals.length === 1, 'durdurunca tek sonuç döner', finals.length);
    ok(latency < 200, 'kuyruğa giren dur mesajı bir dilim içinde işlenir', latency + 'ms');
    ok(finals[0] && finals[0].best, 'durdurulan analiz yine de hamle verir', finals[0] && finals[0].san);
    ok(finals[0] && finals[0].complete === false, 'yarıda kesildiği belirtilir', finals[0] && finals[0].complete);
    const after = w.infos().length;
    await wait(300);
    ok(w.infos().length === after, 'durdurduktan sonra yeni bilgi gelmez', `${after} → ${w.infos().length}`);
    ok(beforeStop >= 3, 'durdurmadan önce iş yapılmıştı', beforeStop);
  }

  /* 4) Yeni analiz öncekini kapatır, iki ayrı sonuç gelir */
  {
    const w = bootWorker();
    w.send({ id: 11, cmd: 'analyze', fen: MIDDLE, depth: 30, multiPv: 5, multiPvMargin: 300, slice: 60 });
    await wait(400);
    w.send({ id: 12, cmd: 'analyze', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 4, slice: 60 });
    await wait(1500);
    const ids = w.bestmoves().map((m) => m.id);
    ok(ids.includes(11) && ids.includes(12), 'her iki istek de sonuçlanır', ids.join(','));
    const lateInfos = w.infos().filter((i) => i.id === 11 && i.depth > 20);
    ok(lateInfos.length === 0, 'kapatılan analiz yayın yapmayı sürdürmez', lateInfos.length);
  }

  /* 5) Mat konumunda hemen biter, pat konumunda hamle yok der */
  {
    const w = bootWorker();
    w.send({ id: 21, cmd: 'analyze', fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', depth: 20, multiPv: 5, multiPvMargin: 300, slice: 60 });
    await wait(1500);
    const f = w.bestmoves()[0];
    ok(f && f.best && f.best.uci === 'a1a8' && f.mate === 1, 'mat bulununca durur', f && `${f.best && f.best.uci} M${f.mate}`);

    const w2 = bootWorker();
    w2.send({ id: 22, cmd: 'analyze', fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', depth: 8, slice: 60 });
    await wait(600);
    const f2 = w2.bestmoves()[0];
    ok(f2 && f2.gameOver === 'stalemate', 'pat konumu bildirilir', f2 && f2.gameOver);
  }

  /* 6) Bozuk FEN hata döndürür, worker ayakta kalır */
  {
    const w = bootWorker();
    w.send({ id: 31, cmd: 'analyze', fen: 'bu bir fen değil', depth: 4 });
    await wait(100);
    ok(w.errors().length === 1, 'bozuk FEN hata verir', w.errors().length);
    w.send({ id: 32, cmd: 'analyze', fen: MIDDLE, depth: 3, slice: 60 });
    await wait(1500);
    ok(w.bestmoves().some((m) => m.id === 32), 'hatadan sonra çalışmaya devam eder', w.bestmoves().length);
  }

  console.log(fails ? `\n${fails} test başarısız` : '\nTüm worker testleri geçti');
  process.exit(fails ? 1 : 0);
})();
