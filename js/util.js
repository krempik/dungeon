/* util.js — shared math helpers + seeded RNG. */
'use strict';

const Util = (() => {
  // Mulberry32 — small fast seeded PRNG for deterministic worldgen.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function dist(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return Math.hypot(dx, dy);
  }

  // Simple HTML escaping for all user/name strings inserted via innerHTML.
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { mulberry32, randInt, pick, clamp, dist, escapeHtml };
})();
