/*
 * Otomatik oynatma döngüsünün testi: panel açılır, otomatik mod açılır ve
 * kimse müdahale etmeden hamle üstüne hamle oynanmaya devam eder mi?
 */
const { bootPanel, wait } = require('./panel-harness.js');

let fails = 0;
const ok = (cond, name, extra) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  → ' + extra}`); };

function seededRng(seed) {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

(async function run() {
  /* 1) Kesintisiz oynama: tek bir düğmeyle başlayıp birden çok hamle oynar */
  {
    const { elements, page } = bootPanel({ rng: seededRng(11) });
    await wait(150);

    elements.autoPlay.checked = true;
    await elements.autoPlay.fire('change');
    await wait(2500);

    ok(page.played.length >= 4, 'otomatik mod art arda hamle oynar', `${page.played.length} hamle: ${page.played.join(' ')}`);
    ok(page.opponentMoves >= 3, 'rakip cevapları da işlenir', page.opponentMoves);
    ok(!page.log.some((l) => l.startsWith('geçersiz')), 'oynanan hamlelerin tümü kurallı', page.log.filter((l) => l.startsWith('geçersiz')).join(','));
    ok(page.pos.history.length === page.played.length + page.opponentMoves, 'tahta ile panel senkron', `${page.pos.history.length} / ${page.played.length}+${page.opponentMoves}`);

    // her hamleden sonra analiz sürüyor mu: son sonuç güncel konumu göstermeli
    ok(elements.bestMove.textContent && elements.bestMove.textContent !== '—', 'panel güncel en iyi hamleyi gösterir', elements.bestMove.textContent);
    ok(/oynandı|sıra|bekleniyor/.test(elements.loopState.textContent), 'döngü durumu bildirilir', elements.loopState.textContent);

    elements.autoPlay.checked = false;
    await elements.autoPlay.fire('change');
    const after = page.played.length;
    await wait(600);
    ok(page.played.length === after, 'otomatik mod kapanınca oynamayı bırakır', `${after} → ${page.played.length}`);
  }

  /* 2) Yalnızca canlı analiz: hamle oynamadan analiz etmeyi sürdürür */
  {
    const { elements, page } = bootPanel({ settings: { liveAnalysis: true }, rng: seededRng(5) });
    await wait(900);
    ok(page.played.length === 0, 'canlı analiz kendiliğinden hamle oynamaz', page.played.join(' '));
    ok(elements.bestMove.textContent && elements.bestMove.textContent !== '—', 'canlı analiz sonuç üretir', elements.bestMove.textContent);
    ok(elements.evalText.textContent !== '0.00' || elements.depthText.textContent !== 'd0', 'değerlendirme güncellenir',
      `${elements.evalText.textContent} ${elements.depthText.textContent}`);
  }

  /* 3) Sıra rakipteyken hamle oynanmaz */
  {
    const { elements, page } = bootPanel({
      page: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', replyDelay: 100000 },
      rng: seededRng(3)
    });
    await wait(120);
    elements.myColor.value = 'w';
    await elements.myColor.fire('change');
    elements.autoPlay.checked = true;
    await elements.autoPlay.fire('change');
    await wait(700);
    ok(page.played.length === 0, 'sıra rakipteyken oynanmaz', page.played.join(' '));
    ok(elements.loopState.textContent === 'rakip bekleniyor', 'durum: rakip bekleniyor', elements.loopState.textContent);
  }

  /* 4) Siyah oynarken de çalışır */
  {
    const { elements, page } = bootPanel({
      page: { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', orientation: 'black' },
      rng: seededRng(21)
    });
    await wait(150);
    elements.autoPlay.checked = true;
    await elements.autoPlay.fire('change');
    await wait(2000);
    ok(page.played.length >= 3, 'siyah tarafta da art arda oynar', `${page.played.length}: ${page.played.join(' ')}`);
    ok(!page.log.some((l) => l.startsWith('geçersiz')), 'siyah hamleleri kurallı', page.log.join(' | '));
  }

  /* 5) Oyun bitince döngü hamle uydurmaz */
  {
    const { elements, page } = bootPanel({
      page: { fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3' },   // beyaz mat
      rng: seededRng(9)
    });
    await wait(150);
    elements.autoPlay.checked = true;
    await elements.autoPlay.fire('change');
    await wait(900);
    ok(page.played.length === 0, 'mat konumunda hamle oynanmaz', page.played.join(' '));
    ok(/Mat/.test(elements.statusText.textContent), 'mat durumu bildirilir', elements.statusText.textContent);
  }

  /* 6) Hamle tahtaya geçmezse döngü kilitlenmeden yeniden dener */
  {
    const { elements, page } = bootPanel({ page: { swallowMoves: true }, rng: seededRng(4) });
    await wait(150);
    elements.autoPlay.checked = true;
    await elements.autoPlay.fire('change');
    await wait(3200);
    ok((page.attempts || 0) >= 2, 'geçmeyen hamle yeniden denenir', `${page.attempts || 0} deneme`);
    ok(/yeniden|bekleniyor|oynandı/.test(elements.loopState.textContent), 'durum bildirilir', elements.loopState.textContent);
  }

  /* 7) Hamle çeşitliliği: aynı konumda hep aynı hamle oynanmaz, ama mat kaçmaz */
  {
    const firstMoves = async (variety, boots) => {
      const out = [];
      for (let i = 0; i < boots; i++) {
        const { elements, page } = bootPanel({
          settings: { variety, movetime: 120, maxDepth: 5, varietyGap: 60, varietyMaxLoss: 150 },
          page: { replyDelay: 100000 },          // rakip oynamasın, ilk hamlede kalalım
          rng: seededRng(7)
        });
        await wait(120);
        elements.autoPlay.checked = true;
        await elements.autoPlay.fire('change');
        await wait(900);
        out.push(page.played[0] || '-');
      }
      return out;
    };

    const fixed = await firstMoves(false, 4);
    ok(new Set(fixed).size === 1 && fixed[0] !== '-', 'çeşitlilik kapalıyken hep aynı hamle', fixed.join(' '));

    const varied = await firstMoves(true, 8);
    ok(!varied.includes('-'), 'çeşitlilik açıkken de hamle oynanır', varied.join(' '));
    ok(new Set(varied).size >= 2, 'çeşitlilik açıkken hamleler değişiyor', varied.join(' '));
  }

  /* 8) Çeşitlilik açıkken mat konumunda mat oynanır */
  {
    const { elements, page } = bootPanel({
      page: { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4', replyDelay: 100000 },
      settings: { variety: true, movetime: 200, maxDepth: 6 },
      rng: seededRng(2)
    });
    await wait(120);
    elements.autoPlay.checked = true;
    await elements.autoPlay.fire('change');
    await wait(1200);
    ok(page.played[0] === 'f3f7', 'çeşitlilik açıkken mat kaçırılmaz', page.played.join(' '));
  }

  console.log(fails ? `\n${fails} test başarısız` : '\nTüm döngü testleri geçti');
  process.exit(fails ? 1 : 0);
})();
