const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(dark = false) {
  const listeners = {}, frames = new Map(), media = new Map();
  let next = 0, time = 0, arcs = [];
  const paints = [], windowListeners = {};
  const ctx = { setTransform() {}, fillRect() { arcs = []; paints.push([this.fillStyle, this.globalAlpha]); }, beginPath() {}, moveTo() {}, arc(x,y) { arcs.push([x,y]); }, fill() { paints.push([this.fillStyle, this.globalAlpha]); } };
  const canvas = { style: {}, setAttribute() {}, getContext: () => ctx };
  const board = { querySelector: () => ({ after() {} }), getBoundingClientRect: () => ({ left: 0, top: 65 }), addEventListener: (name, fn) => listeners[name] = fn };
  const sandbox = { getComputedStyle: () => ({ backgroundColor: dark ? '#17191d' : '#f8f9fa', fill: dark ? '#a1aabb' : '#989b9f', fillOpacity: dark ? '.35' : '.5' }), window: { addEventListener(name, fn) { windowListeners[name] = fn; } }, document: { hidden: false, createElement: () => canvas, addEventListener() {} }, devicePixelRatio: 3,
    matchMedia(query) { const m = { matches: query.includes('any-hover'), addEventListener(_, fn) { this.change = fn; } }; media.set(query,m); return m; },
    ResizeObserver: class { observe() {} }, requestAnimationFrame(fn) { frames.set(++next,fn); return next; }, cancelAnimationFrame(id) { frames.delete(id); } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../reactive-grid.js'),'utf8'),sandbox);
  const grid = sandbox.window.createReactiveGrid(board);
  return { canvas, grid, frames, media, paints, setDark(value) { dark = value; windowListeners['branch-appearance'](); }, get arcs() { return arcs; },
    move(x=300,y=300, extra={}) { listeners.pointermove({ pointerType:'mouse', buttons:0, clientX:x, clientY:y+65, target:{ closest:()=>null }, ...extra }); },
    leave() { listeners.pointerleave(); },
    tick() { time+=1000/60; const jobs=[...frames.values()]; frames.clear(); jobs.forEach(fn=>fn(time)); },
    settle() { let count=0; while(frames.size && count++<180)this.tick(); assert.equal(frames.size,0,'animation must sleep once settled'); return count; }
  };
}

test('nearby dots repel, settle without an idle loop, and restore on exit', () => {
  const s=setup(); s.move(); s.settle();
  assert.ok(s.arcs.some(([x,y]) => x>116 && x<118 && Math.abs(y-112)<.01), 'dot directly under pointer moves about 5px');
  assert.equal(s.canvas.hidden,false);
  s.leave(); s.settle(); assert.equal(s.canvas.hidden,true);
});

test('work stays bounded at minimum zoom, pointer events coalesce, and pan clears patch', () => {
  const s=setup(); s.grid.setCamera({x:-123.4,y:98.2,z:.35});
  for(let i=0;i<100;i++)s.move(300+i,300);
  assert.equal(s.frames.size,1); s.tick();
  assert.ok(s.arcs.length<1024); assert.equal(s.canvas.width,448);
  s.grid.setCamera({x:0,y:0,z:2});
  assert.equal(s.frames.size,0); assert.equal(s.canvas.hidden,true);
});

test('reduced motion and touch keep the static grid', () => {
  const s=setup(); s.move(300,300,{pointerType:'touch'}); assert.equal(s.frames.size,0);
  s.move(); s.tick();
  const reduced=s.media.get('(prefers-reduced-motion: reduce)'); reduced.matches=true; reduced.change();
  s.move(); assert.equal(s.frames.size,0); assert.equal(s.canvas.hidden,true);
});

 test('cursor patch matches the grid palette and repaints a settled patch on theme changes', () => {
  const s = setup(true); s.move(); s.settle();
  assert.deepEqual(s.paints.slice(-2), [['#17191d', 1], ['#a1aabb', .35]]);
  s.setDark(false); assert.equal(s.frames.size, 1); s.settle();
  assert.deepEqual(s.paints.slice(-2), [['#f8f9fa', 1], ['#989b9f', .5]]);
  s.leave(); s.settle(); s.setDark(true);
  assert.equal(s.canvas.hidden, true); assert.equal(s.frames.size, 0);
});
