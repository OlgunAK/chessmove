/* Tarayıcısız ortamda içerik betiklerini çalıştırmak için asgari DOM taklidi. */
class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.className = attrs.className || '';
    this.style = { transform: attrs.transform || '' };
    this.children = [];
    this.parentElement = null;
    this._rect = attrs.rect || { left: 0, top: 0, width: 400, height: 400 };
  }
  append(...kids) { for (const k of kids) { k.parentElement = this; this.children.push(k); } return this; }
  get classList() {
    const cls = String(this.className).split(/\s+/);
    return { contains: (c) => cls.includes(c) };
  }
  getBoundingClientRect() {
    const r = this._rect;
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height };
  }
  closest(sel) {
    let n = this;
    while (n) { if (matches(n, sel)) return n; n = n.parentElement; }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (sel.split(',').some((s) => matches(c, s.trim()))) out.push(c); walk(c); } };
    walk(this);
    return { forEach: (fn) => out.forEach(fn), length: out.length, [Symbol.iterator]: out[Symbol.iterator].bind(out) };
  }
  querySelector(sel) { const all = [...this.querySelectorAll(sel)]; return all[0] || null; }
}

function matches(node, sel) {
  sel = sel.trim();
  if (!sel) return false;
  // "square.last-move" gibi etiket+sınıf birleşimleri
  const m = sel.match(/^([a-zA-Z-]*)((?:[.#][\w-]+)*)$/);
  if (!m) return false;
  const [, tag, rest] = m;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  const classes = String(node.className).split(/\s+/);
  for (const part of rest.match(/\.[\w-]+/g) || []) {
    if (!classes.includes(part.slice(1))) return false;
  }
  for (const part of rest.match(/#[\w-]+/g) || []) {
    if (node.id !== part.slice(1)) return false;
  }
  return true;
}

function makeWindow() {
  const root = new El('html');
  const body = new El('body');
  root.append(body);
  const doc = {
    documentElement: root, body,
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    createElement: (t) => new El(t),
    elementFromPoint: () => body
  };
  const win = {
    document: doc, El,
    addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} }
  };
  win.window = win;
  return win;
}

module.exports = { El, makeWindow };
