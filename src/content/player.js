/*
 * player.js — hesaplanan hamleyi sayfadaki tahtada gerçek fare olaylarıyla oynar.
 */
(function () {
  'use strict';
  const NS = (window.__chessmove = window.__chessmove || {});
  if (NS.player) return;

  const ROLE_NAMES = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (n) => n + (Math.random() - 0.5) * n * 0.4;

  function topElement(x, y) {
    return document.elementFromPoint(Math.round(x), Math.round(y)) || document.body;
  }

  function fire(el, type, x, y, extra) {
    const init = Object.assign({
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x + window.screenX, screenY: y + window.screenY,
      button: 0, buttons: type === 'pointerup' || type === 'mouseup' || type === 'click' ? 0 : 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: type.includes('up') ? 0 : 0.5
    }, extra || {});
    const Ctor = type.startsWith('pointer') ? (window.PointerEvent || MouseEvent) : MouseEvent;
    el.dispatchEvent(new Ctor(type, init));
  }

  async function pressAt(x, y) {
    const el = topElement(x, y);
    fire(el, 'pointerover', x, y, { buttons: 0 });
    fire(el, 'pointerenter', x, y, { buttons: 0 });
    fire(el, 'pointermove', x, y, { buttons: 0 });
    fire(el, 'mousemove', x, y, { buttons: 0 });
    fire(el, 'pointerdown', x, y);
    fire(el, 'mousedown', x, y);
    return el;
  }

  async function releaseAt(x, y, downEl) {
    const el = topElement(x, y);
    fire(el, 'pointerup', x, y);
    fire(el, 'mouseup', x, y);
    // click olayı ortak ataya gider; hedef eleman üzerinde tetiklemek yeterli
    fire(el, 'click', x, y);
    return el;
  }

  async function clickAt(x, y) {
    const el = await pressAt(x, y);
    await sleep(jitter(45));
    await releaseAt(x, y, el);
  }

  async function dragBetween(a, b, duration) {
    const el = await pressAt(a.x, a.y);
    const steps = 12;
    const total = duration || 180;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;   // yumuşak geçiş
      const x = a.x + (b.x - a.x) * ease;
      const y = a.y + (b.y - a.y) * ease;
      const target = topElement(x, y);
      fire(target, 'pointermove', x, y);
      fire(target, 'mousemove', x, y);
      await sleep(total / steps);
    }
    await releaseAt(b.x, b.y, el);
  }

  const PROMO_SELECTORS = [
    // lichess
    (role) => document.querySelector(`#promotion-choice piece.${role}, #promotion-choice .${role}`),
    (role) => {
      const box = document.querySelector('#promotion-choice');
      if (!box) return null;
      return box.querySelector(`square piece.${role}`) || null;
    },
    // chess.com
    (role, letter) => document.querySelector(`.promotion-window .promotion-piece.w${letter}, .promotion-window .promotion-piece.b${letter}`),
    (role, letter) => document.querySelector(`.promotion-window [class*="${letter}"]`),
    (role) => document.querySelector(`[data-promotion="${role}"]`)
  ];

  async function choosePromotion(promo) {
    const letter = (promo || 'q').toLowerCase();
    const role = ROLE_NAMES[letter] || 'queen';
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      for (const find of PROMO_SELECTORS) {
        let el = null;
        try { el = find(role, letter); } catch (e) { /* yoksay */ }
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 4) {
            await clickAt(r.left + r.width / 2, r.top + r.height / 2);
            return true;
          }
        }
      }
      await sleep(80);
    }
    return false;
  }

  /**
   * @param {{from:string,to:string,promo?:string,method?:'click'|'drag',
   *          rect:Object, orientation:string, speed?:number}} opts
   */
  async function playMove(opts) {
    const R = NS.readers;
    const a = R.squareCenter(opts.rect, opts.orientation, opts.from);
    const b = R.squareCenter(opts.rect, opts.orientation, opts.to);
    if (!a || !b) return { ok: false, error: 'Kare koordinatı hesaplanamadı' };

    const speed = opts.speed == null ? 1 : opts.speed;
    if (opts.method === 'drag') {
      await dragBetween(a, b, 180 / speed);
    } else {
      await clickAt(a.x, a.y);
      await sleep(jitter(110 / speed));
      await clickAt(b.x, b.y);
    }

    let promoted = null;
    if (opts.promo) promoted = await choosePromotion(opts.promo);

    return { ok: true, promoted };
  }

  NS.player = { playMove, clickAt, dragBetween, choosePromotion };
})();
