'use strict';

// The SVG remains the static grid. Only this 224px patch is rasterized while
// nearby dots move; work and backing-store size are independent of board size.
window.createReactiveGrid = function createReactiveGrid(board) {
  const size = 224, radius = 68;
  const canvas = document.createElement('canvas');
  canvas.id = 'reactive-grid';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  board.querySelector('#board-grid').after(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { setCamera() {} };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  let camera = { x: 0, y: 0, z: 1 }, bounds = board.getBoundingClientRect();
  let pointer = null, origin = { x: 0, y: 0 }, dots = new Map();
  let frame = 0, last = 0, dpr = 0;
  let background, dotColor, dotOpacity;
  function readPalette() {
    background = getComputedStyle(board).backgroundColor;
    const style = getComputedStyle(board.querySelector('#grid-dot'));
    dotColor = style.fill;
    dotOpacity = Number(style.fillOpacity);
  }
  readPalette();
  window.addEventListener('branch-appearance', () => {
    readPalette();
    if (!canvas.hidden) wake();
  });

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0; last = 0; pointer = null; dots.clear(); canvas.hidden = true;
  }
  function wake() {
    if (!frame && !document.hidden && !reduce.matches && fine.matches) {
      last = 0;
      frame = requestAnimationFrame(draw);
    }
  }
  function draw(now) {
    frame = 0;
    const scale = Math.min(devicePixelRatio || 1, 2);
    if (dpr !== scale) {
      dpr = scale; canvas.width = canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
    last = now;
    const step = 24 * camera.z;
    const ox = camera.x % step + step / 2, oy = camera.y % step + step / 2;
    const next = new Map();
    let moving = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = background; ctx.fillRect(0, 0, size, size);
    ctx.beginPath();
    // Include edge dots, so the patch meets the underlying SVG without seams.
    for (let col = Math.floor((origin.x - ox - 8) / step); col <= Math.ceil((origin.x + size - ox + 8) / step); col++) {
      for (let row = Math.floor((origin.y - oy - 8) / step); row <= Math.ceil((origin.y + size - oy + 8) / step); row++) {
        const x = ox + col * step, y = oy + row * step, key = `${col}:${row}`;
        const dot = dots.get(key) || { x: 0, y: 0, vx: 0, vy: 0 };
        let tx = 0, ty = 0;
        if (pointer) {
          const dx = x - pointer.x, dy = y - pointer.y, distance = Math.hypot(dx, dy);
          if (distance < radius) {
            const push = Math.min(5, step * .3) * (1 - distance / radius) ** 2;
            tx = distance > .01 ? dx / distance * push : push;
            ty = distance > .01 ? dy / distance * push : 0;
          }
        }
        // Small substeps keep the lightly damped spring stable on slow frames.
        for (let i = 0; i < 2; i++) {
          const h = dt / 2;
          dot.vx += ((tx - dot.x) * 380 - dot.vx * 29) * h;
          dot.vy += ((ty - dot.y) * 380 - dot.vy * 29) * h;
          dot.x += dot.vx * h; dot.y += dot.vy * h;
        }
        const unsettled = Math.abs(dot.x - tx) + Math.abs(dot.y - ty) > .015 || Math.abs(dot.vx) + Math.abs(dot.vy) > .04;
        if (unsettled) moving = true;
        else { dot.x = tx; dot.y = ty; dot.vx = dot.vy = 0; }
        next.set(key, dot);
        const px = x - origin.x + dot.x, py = y - origin.y + dot.y;
        ctx.moveTo(px + .7, py); ctx.arc(px, py, .7, 0, Math.PI * 2);
      }
    }
    dots = next;
    ctx.globalAlpha = dotOpacity;
    ctx.fillStyle = dotColor; ctx.fill();
    canvas.hidden = false;
    if (moving) frame = requestAnimationFrame(draw);
    else if (!pointer) reset();
  }
  function leave() { if (pointer) { pointer = null; wake(); } }
  board.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || event.buttons || reduce.matches || !fine.matches || document.hidden) return leave();
    // Cards and their controls keep their own interactions. Only empty canvas reacts.
    if (event.target.closest('.card,button,input,textarea,[contenteditable]')) return leave();
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    origin = { x: Math.round(pointer.x - size / 2), y: Math.round(pointer.y - size / 2) };
    canvas.style.transform = `translate(${origin.x}px,${origin.y}px)`;
    wake();
  }, { passive: true });
  board.addEventListener('pointerleave', leave, { passive: true });
  board.addEventListener('pointerdown', leave, { passive: true });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  reduce.addEventListener('change', reset); fine.addEventListener('change', reset);
  new ResizeObserver(() => { bounds = board.getBoundingClientRect(); reset(); }).observe(board);
  return { setCamera(value) { camera = { ...value }; reset(); } };
};
