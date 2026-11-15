const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function boot({ width = 1280, height = 900, reduced = false } = {}) {
  const root = path.resolve(__dirname, '..');
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'landing.html'), 'utf8'), {
    url: 'https://branch.example', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  const frames = new Map(), observers = [], media = new Map();
  let id = 0, now = 0;
  Object.defineProperties(w, {
    innerWidth: { value: width, configurable: true, writable: true },
    innerHeight: { value: height, configurable: true, writable: true },
    scrollY: { value: 0, configurable: true, writable: true },
  });
  w.matchMedia = query => {
    const listeners = new Set();
    const entry = {
      media: query,
      matches: query.includes('reduced-motion') ? reduced : query.includes('max-width') ? width <= 800 : query.includes('min-width') ? width > 800 : false,
      addEventListener(_, fn) { listeners.add(fn); },
      removeEventListener(_, fn) { listeners.delete(fn); },
      change(value) { this.matches = value; listeners.forEach(fn => fn({ matches: value })); },
    };
    media.set(query, entry); return entry;
  };
  w.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  w.cancelAnimationFrame = id => frames.delete(id);
  w.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  };
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.document.fonts = { ready: Promise.resolve() };
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const demo = this.matches('.flow-demo,.demo-scroll-track,.demo-scroll-stage');
    const top = demo ? 400 - w.scrollY : this.matches('.hero') ? 74 - w.scrollY : 1100 - w.scrollY;
    const boxHeight = demo ? 480 : 150;
    return { x: 80, y: top, left: 80, top, width: 1120, height: boxHeight, right: 1200, bottom: top + boxHeight };
  };
  Object.defineProperties(w.HTMLElement.prototype, {
    offsetWidth: { configurable: true, get() { return 1120; } },
    offsetHeight: { configurable: true, get() { return this.matches('.flow-demo,.demo-scroll-stage') ? 480 : 150; } },
    offsetTop: { configurable: true, get() { return this.matches('.flow-demo,.demo-scroll-track') ? 400 : 0; } },
  });
  const flush = () => {
    now += 16;
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now));
  };
  w.eval(fs.readFileSync(path.join(root, 'landing-scroll.js'), 'utf8'));
  return { dom, w, d: w.document, frames, observers, media, flush };
}

test('reduced motion and narrow layouts leave all content visible without scroll animation', () => {
  for (const options of [{ reduced: true }, { width: 390 }]) {
    const { dom, d, frames } = boot(options);
    try {
      assert.equal(d.documentElement.dataset.scrollDesign, 'static');
      assert.equal(d.querySelectorAll('.scroll-arrival').length, 0);
      assert.equal(d.querySelectorAll('[inert]').length, 0);
      assert.equal(d.querySelector('.flow-demo').getAttribute('aria-hidden'), null);
      assert.equal(frames.size, 0);
    } finally { dom.window.close(); }
  }
});

test('demo expansion is bounded and reverses with native scroll position', () => {
  const { dom, w, d, flush } = boot();
  try {
    flush();
    assert.equal(d.documentElement.dataset.scrollDesign, 'enhanced');
    const stage = d.querySelector('.demo-scroll-stage');
    const scale = () => Number(stage.style.getPropertyValue('--demo-scale'));
    const start = scale(); assert.ok(start >= .96 && start <= 1);
    w.scrollY = 600; w.dispatchEvent(new w.Event('scroll')); flush();
    const expanded = scale(); assert.equal(expanded, 1);
    w.scrollY = -30; w.dispatchEvent(new w.Event('scroll')); flush();
    assert.equal(scale(), start);
    w.scrollY = 10000; w.dispatchEvent(new w.Event('scroll')); flush();
    assert.equal(scale(), 1);
  } finally { dom.window.close(); }
});

test('keyboard focus reveals a section immediately, independently of observer delivery', () => {
  const { dom, d } = boot();
  try {
    const arrival = d.querySelector('.scroll-arrival:not(.is-arrived)');
    assert.ok(arrival, 'a below-fold section is waiting to arrive');
    const button = d.createElement('button'); button.textContent = 'Focus target'; arrival.append(button);
    button.focus();
    assert.equal(arrival.classList.contains('is-arrived'), true);
    assert.equal(d.activeElement, button);
  } finally { dom.window.close(); }
});

test('a burst of scroll events schedules only one frame and does not sustain an idle loop', () => {
  const { dom, w, frames, flush } = boot();
  try {
    flush();
    for (let i = 0; i < 20; i++) { w.scrollY = i * 10; w.dispatchEvent(new w.Event('scroll')); }
    assert.equal(frames.size, 1);
    flush(); assert.equal(frames.size, 0);
  } finally { dom.window.close(); }
});

test('completed arrivals stay visible when scrolling back', () => {
  const { dom, d, observers } = boot();
  try {
    const arrival = d.querySelector('.scroll-arrival:not(.is-arrived)');
    const observer = observers.find(item => item.targets.has(arrival));
    assert.ok(observer);
    observer.callback([{ target: arrival, isIntersecting: true }]);
    assert.equal(arrival.classList.contains('is-arrived'), true);
    observer.callback([{ target: arrival, isIntersecting: false }]);
    assert.equal(arrival.classList.contains('is-arrived'), true);
  } finally { dom.window.close(); }
});

test('switching to reduced motion clears motion and pending work immediately', () => {
  const { dom, w, d, media, frames } = boot();
  try {
    w.scrollY = 200; w.dispatchEvent(new w.Event('scroll')); assert.equal(frames.size, 1);
    media.get('(prefers-reduced-motion: reduce)').change(true);
    assert.equal(d.documentElement.dataset.scrollDesign, 'static');
    assert.equal(frames.size, 0);
    assert.equal(d.querySelectorAll('.scroll-arrival').length, 0);
    assert.equal(d.querySelector('.demo-scroll-stage').style.getPropertyValue('--demo-scale'), '');
    assert.equal(d.querySelector('.hero-copy').style.getPropertyValue('--hero-drift'), '');
    assert.equal(d.querySelector('.demo-scroll-track').classList.contains('can-pin'), false);
  } finally { dom.window.close(); }
});

test('the demo only pins when its full content fits below the navigation', () => {
  for (const [height, expected] of [[900, true], [520, false]]) {
    const { dom, d } = boot({ height });
    try { assert.equal(d.querySelector('.demo-scroll-track').classList.contains('can-pin'), expected); }
    finally { dom.window.close(); }
  }
});

test('remeasuring during a queued scroll frame cancels stale work before rescheduling', () => {
  const { dom, w, frames, flush } = boot();
  try {
    w.scrollY = 100; w.dispatchEvent(new w.Event('scroll')); assert.equal(frames.size, 1);
    w.dispatchEvent(new w.Event('resize')); assert.equal(frames.size, 0);
    w.scrollY = 120; w.dispatchEvent(new w.Event('scroll')); assert.equal(frames.size, 1);
    flush(); assert.equal(frames.size, 0);
  } finally { dom.window.close(); }
});
