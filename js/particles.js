/* particles.js — pooled particle effects + floating combat text. */
'use strict';

const Particles = (() => {
  const MAX = 400;
  let particles;
  let floatTexts;

  let canvas;
  let ctx;
  let floatLayer;

  function init(c, ctxRef, floatEl) {
    canvas = c;
    ctx = ctxRef;
    floatLayer = floatEl;
    particles = [];
    floatTexts = [];
  }

  function reset() {
    if (particles) particles.length = 0;
    if (floatTexts) floatTexts.length = 0;
  }

  function spawn(x, y, vx, vy, life, size, color, drag, gravity, fade) {
    if (particles.length >= MAX) return;
    particles.push({
      x, y, vx, vy, life, maxLife: life, size,
      color, drag: drag || 0.9, gravity: gravity || 0, fade: fade !== false,
    });
  }

  function burst(x, y, color, count, speed, size, life) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.7) * speed;
      spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        life || 0.5 + Math.random() * 0.4, size || 2 + Math.random() * 3, color, 0.9);
    }
  }

  function blood(x, y) {
    burst(x, y, '#b0202f', 10, 90, 2.5, 0.5);
  }

  function magicSparks(x, y, color) {
    burst(x, y, color || '#7c5cff', 12, 110, 2.2, 0.6);
  }

  function dust(x, y) {
    burst(x, y, '#6a6a80', 5, 40, 1.5, 0.7);
  }

  function ring(x, y, color, size) {
    if (particles.length >= MAX) return;
    particles.push({
      x, y, vx: 0, vy: 0, life: 0.4, maxLife: 0.4,
      size: size || 20, color, drag: 1, gravity: 0, fade: true, ring: true,
    });
  }

  function doubleRing(x, y, color, size) {
    ring(x, y, color, size);
    if (particles.length >= MAX) return;
    particles.push({
      x, y, vx: 0, vy: 0, life: 0.6, maxLife: 0.6,
      size: (size || 20) * 0.55, color, drag: 1, gravity: 0, fade: true, ring: true,
    });
  }

  // Sparks thrown out along a sword arc: they fan across `spread` radians
  // around `ang`, up to `len` px away (weapon edge, not the hand).
  function slash(x, y, ang, color, len, spread) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = ang + (Math.random() - 0.5) * (spread || 1.0);
      const d = (Math.random() * 0.35 + 0.65) * (len || 22);
      const speed = 20 + Math.random() * 90;
      spawn(x + Math.cos(a) * d, y + Math.sin(a) * d,
        Math.cos(a) * speed, Math.sin(a) * speed,
        0.18 + Math.random() * 0.22, 1.6 + Math.random() * 2, color, 0.85);
    }
  }

  // Directional impact cone — sparks fly back along the hit direction.
  function impact(x, y, dirx, diry, color) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 0.9;
      const ca = Math.cos(spread), sa = Math.sin(spread);
      const ox = dirx * ca - diry * sa;
      const oy = dirx * sa + diry * ca;
      const speed = 40 + Math.random() * 110;
      spawn(x, y, -ox * speed, -oy * speed,
        0.2 + Math.random() * 0.25, 1.5 + Math.random() * 2.2, color, 0.85);
    }
  }

  // Dust kicked back while charging/running (roughly opposite to motion).
  function dustTrail(x, y, vx, vy, color) {
    const speed = 15 + Math.random() * 25;
    spawn(x, y, -vx * 0.2 + (Math.random() - 0.5) * 30, -vy * 0.2 + (Math.random() - 0.5) * 30,
      0.3 + Math.random() * 0.25, 1.4 + Math.random() * 2, color || '#7a6a52', 0.9);
  }

  // Magical swirl used around a teleport/blink.
  function swirl(x, y, color) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      spawn(x, y, Math.cos(a) * 30, Math.sin(a) * 30,
        0.4 + Math.random() * 0.3, 1.6 + Math.random() * 2, color, 0.8);
    }
    ring(x, y, color, 6);
  }

  // Small tracer puff left behind a flying projectile.
  function tracer(x, y, vx, vy, color) {
    if (particles.length >= MAX) return;
    spawn(x, y, -vx * 0.02, -vy * 0.02,
      0.25 + Math.random() * 0.2, 1.5 + Math.random() * 1.6, color, 0.9);
  }

  function addFloat(x, y, text, cls) {
    if (!floatLayer) return;
    const span = document.createElement('div');
    span.className = 'float-msg ' + (cls || 'info');
    span.textContent = text;
    const f = { x, y, text, cls: cls || 'info', t: 0, _el: span };
    floatTexts.push(f);
    floatLayer.appendChild(span);
  }

  // Update float DOM positions each frame from the world→screen transform.
  // (f.x, f.y) are world px, camX is the world point at screen center and
  // `zoom` (K = tileScale/24) scales world px up to the tile-zoom factor so
  // floating text lands exactly on the same sprites it annotates.
  function updateFloatDom(camX, camY, zoom) {
    if (!floatLayer) return;
    const K = zoom || 1;
    const rect = canvas.getBoundingClientRect();
    for (const f of floatTexts) {
      if (!f._el) continue;
      f._el.style.left = (rect.width / 2 + (f.x - camX) * K) + 'px';
      f._el.style.top = (rect.height / 2 + (f.y - camY) * K) + 'px';
    }
  }

  function update(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    // Manage float text DOM lifecycle.
    if (floatLayer) {
      for (let i = floatTexts.length - 1; i >= 0; i--) {
        const f = floatTexts[i];
        f.t += dt;
        if (f.t > 0.9 && f._el) { f._el.remove(); floatTexts.splice(i, 1); }
      }
    }
  }

  // Particles live in world px; render applies the camera offset just like
  // tiles/units, otherwise they'd appear at raw world coords (far off-target).
  function render(ox, oy) {
    for (const p of particles) {
      const x = p.x + ox, y = p.y + oy;
      const a = p.fade ? Math.max(0, p.life / p.maxLife) : 1;
      if (p.ring) {
        const r = p.size + (1 - a) * 40;
        ctx.globalAlpha = a * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  return {
    init, reset, spawn, burst, blood, magicSparks, dust, ring, doubleRing,
    slash, impact, dustTrail, swirl, tracer, addFloat,
    updateFloatDom, update, render,
  };
})();
