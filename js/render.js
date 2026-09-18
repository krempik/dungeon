/* render.js — camera, tile/entity rendering, fog-of-war + dynamic lighting. */
'use strict';

const Render = (() => {
  let canvas, ctx;

  const TILE = WorldGen.TILE;
  let dpr = 1;

  // Map class key → sprite name so the player art varies per class.
  const HERO_ART = { void: 'hero', warrior: 'hero_warrior', mage: 'hero_mage', rogue: 'hero_rogue' };

  // Blend two hex colours by a fraction (0 = c1, 1 = c2).
  function blendHex(c1, c2, t) {
    const h = (s) => parseInt(s, 16);
    const r1 = h(c1.slice(1, 3)), g1 = h(c1.slice(3, 5)), b1 = h(c1.slice(5, 7));
    const r2 = h(c2.slice(1, 3)), g2 = h(c2.slice(3, 5)), b2 = h(c2.slice(5, 7));
    const lerp = (a, b) => Math.round(a + (b - a) * t);
    return `#${[lerp(r1, r2), lerp(g1, g2), lerp(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // Tile cache: pre-render each floor's wall tile once to an offscreen canvas.
  const cache = {};

  function init(c, cctx) {
    canvas = c;
    ctx = cctx;
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    // Map the CSS-pixel coordinate space we draw in onto the full backing
    // store, otherwise the world renders tiny/blurry on HiDPI displays.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Build a small offscreen canvas holding a decorative wall tile for a theme.
  // The tile grid is 24 world px per cell; the cache is built at that size and
  // the render zoom (K = tileScale/24) scales it up with everything else.
  function buildWallTile(theme) {
    const c = document.createElement('canvas');
    c.width = 24 * dpr; c.height = 24 * dpr;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Base brick-ish pattern.
    g.fillStyle = theme.wall;
    g.fillRect(0, 0, 24, 24);
    // Brick joints.
    g.strokeStyle = 'rgba(255,255,255,0.04)';
    g.lineWidth = 1;
    for (let y = 6; y < 24; y += 6) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(24, y); g.stroke();
    }
    for (let y = 0; y < 24; y += 12) {
      for (let x = 0; x < 24; x += 12) {
        g.beginPath(); g.moveTo(x + (y === 0 ? 6 : 0), y);
        g.lineTo(x + (y === 0 ? 6 : 0), y + 6); g.stroke();
      }
    }
    // Slight top shading for depth.
    const grad = g.createLinearGradient(0, 0, 0, 24);
    grad.addColorStop(0, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 24, 24);
    return c;
  }

  function getFloorCache(floor, seed) {
    const theme = WorldGen.floorTheme(floor, seed).theme;
    const key = floor + '@' + seed + '@' + dpr;
    if (!cache[key]) cache[key] = buildWallTile(theme);
    return cache[key];
  }

  // ---- Floyd-like light map: multiply "darkness" onto the world.
  // We compute per-tile darkness from light sources (player torch + torches),
  // store in an offscreen canvas the size of the tile grid, then draw it
  // scaled to screen.
  function render() {
    const g = Game;
    if (!g || !g.world) return;

    const w = g.world.w, h = g.world.h;
    const floorIndex = g.floor;
    const theme = WorldGen.floorTheme(floorIndex, g.seed).theme;

    // One world unit = 1 px at tileScale 24 (original camera). The zoom is
    // applied as a UNIFORM scale K to tiles, sprites, particles and lighting
    // alike, so the drawn walls always sit exactly on the walkability grid and
    // the hero never appears to walk over rock or stop on empty floor.
    const TS = g.tileScale || 24;
    const K = TS / 24;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const camX = g.player.x + (g.camShake ? (Math.random() - 0.5) * g.camShake : 0);
    const camY = g.player.y + (g.camShake ? (Math.random() - 0.5) * g.camShake : 0);

    // Screen-space background.
    ctx.fillStyle = '#05030c';
    ctx.fillRect(0, 0, cw, ch);

    // World camera transform: everything below draws in WORLD coordinates
    // (24 px per tile) and is zoomed by K consistently.
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(K, K);
    ctx.translate(-camX, -camY);

    const wallTile = getFloorCache(floorIndex, g.seed);

    // Visible tile range in world units.
    const viewW = cw / K, viewH = ch / K;
    const x0 = Math.floor((camX - viewW / 2) / 24) - 1;
    const x1 = Math.ceil((camX + viewW / 2) / 24) + 1;
    const y0 = Math.floor((camY - viewH / 2) / 24) - 1;
    const y1 = Math.ceil((camY + viewH / 2) / 24) + 1;

    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        const t = g.world.tiles[y * w + x];
        const px = x * 24, py = y * 24;
        if (t === TILE.FLOOR) {
          // Alternate subtle floor shades by parity for checkerboard texture.
          const shade = ((x + y) & 1) ? theme.floor[0] : theme.floor[1];
          ctx.fillStyle = shade;
          ctx.fillRect(px, py, 24 + 0.5, 24 + 0.5);
        } else if (t === TILE.WALL) {
          // Show wall tiles only if adjacent to a floor (visible wall faces).
          if (hasVisibleNeighbor(g, x, y)) {
            ctx.drawImage(wallTile, px, py, 24, 24);
          }
        } else if (t === TILE.WATER) {
          // Animated water: drifting tide bands plus sparkle highlights that
          // shimmer with the game clock (not frame time — deterministic).
          const rip = 0.5 + 0.5 * Math.sin(G.clock * 2.2 + x * 1.3 + y * 0.7);
          ctx.fillStyle = '#1c3a56';
          ctx.fillRect(px, py, 24, 24);
          ctx.fillStyle = `rgba(120,190,255,${0.08 + rip * 0.14})`;
          ctx.fillRect(px, py, 24, Math.max(2, 24 * (0.2 + rip * 0.25)));
          const spark = Math.sin(G.clock * 4 + x * 2.9 - y * 1.1);
          if (spark > 0.82) {
            ctx.fillStyle = 'rgba(200,235,255,0.5)';
            ctx.fillRect(px + 8, py + 5, 2, 2);
          }
        } else if (t === TILE.LAVA) {
          ctx.fillStyle = '#a02c10';
          ctx.fillRect(px, py, 24, 24);
          const flick = 0.5 + 0.5 * Math.sin(G.clock * 3 + x * 1.7 + y);
          ctx.fillStyle = `rgba(255,${120 + flick * 100},40,${0.25 + flick * 0.3})`;
          ctx.fillRect(px, py, 24, 24);
        }
      }
    }

    // Draw items (they sit on floor).
    for (const it of g.world.items) {
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(G.clock * 4 + it.x);
      const bob = Math.sin(G.clock * 3 + it.x) * 1.5;
      // Unique per-item pixel sprite (swords, staves, armor); glyph fallback.
      const drew = it.sprite ? Art.draw(ctx, it.sprite, it.color || null, it.x, it.y + bob, 13.2, 1) : false;
      if (!drew) {
        ctx.font = '14px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.glyph, it.x, it.y + bob);
      }
      // glow
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = it.glow || '#7c5cff';
      ctx.beginPath(); ctx.arc(it.x, it.y + bob, 12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Cozy hub furniture on the start floor (board, crates, fire, totem, npcs).
    if (g.world.furniture) {
      for (const f of g.world.furniture) {
        drawFurniture(f);
      }
    }

    // Draw projectiles.
    for (const p of g.world.projectiles) {
      ctx.fillStyle = p.color || '#ff7a3c';
      ctx.shadowColor = p.color || '#ff7a3c';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius || 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Draw exit stairs/portal (pulsing).
    for (const ex of g.world.exits) {
      const pulse = 0.6 + 0.4 * Math.sin(G.clock * 3 + ex.x);
      ctx.globalAlpha = 0.5 + 0.3 * pulse;
      ctx.fillStyle = ex.boss ? '#ff3b5c' : '#5ce1e6';
      ctx.shadowColor = ex.boss ? '#ff3b5c' : '#5ce1e6';
      ctx.shadowBlur = 18 * pulse;
      ctx.fillRect(ex.x - 12, ex.y - 12, 24, 24);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.font = '17px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ex.boss ? '👁' : '⬇', ex.x, ex.y);
    }

    // Draw enemies + the player.
    for (const e of g.world.enemies) {
      drawUnit(g, e, 0, 0, 24);
    }
    drawUnit(g, g.player, 0, 0, 24);

    // Merchant NPC on shop intermission floors.
    if (g.world.shop) {
      const m = g.world.shop.merchant;
      const mpx = m.x, mpy = m.y + Math.sin(g.clock * 2) * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(mpx, mpy + m.radius * 0.7, m.radius * 0.8, m.radius * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      Art.draw(ctx, 'merchant', m.bodyColor, mpx, mpy, m.radius, m.facing || 1);
      const near = Util.dist(g.player.x, g.player.y, m.x, m.y) < 80;
      ctx.font = (near ? 'bold ' : '') + '12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = near ? '#ffd76a' : 'rgba(255,255,255,0.55)';
      ctx.fillText(near ? 'Нажми F' : 'Торговец', mpx, mpy - m.radius - 12);
    }

    // Particles live in world space under the same camera.
    Particles.render(0, 0);

    // Restore the world transform before any screen-space overlays.
    ctx.restore();

    // --- Lighting overlay (fog of war + dynamic torch light) ---
    drawLighting(g, cw, ch, camX, camY, K);

    // Store transform for DOM float text.
    Particles.updateFloatDom(camX, camY, K);

    // Red hit-flash vignette: pulses up when the hero takes damage, then
    // fades out over a few frames via Game.dmgFlash (~0.55s decay).
    if (g.dmgFlash > 0) {
      const a = Math.min(0.35, g.dmgFlash * 0.62);
      const grad = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.25, cw / 2, ch / 2, ch * 0.72);
      grad.addColorStop(0, 'rgba(255,40,60,0)');
      grad.addColorStop(1, `rgba(255,30,50,${a})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cw, ch);
    }

    // Aim line toward mouse when a ranged/projectile allowed.
    if (!Game.overlayOpen && !g.player.dead) {
      drawAimLine(g, 0, 0, TS);
    }
  }

  function hasVisibleNeighbor(g, x, y) {
    const t = g.world.tiles, w = g.world.w, h = g.world.h;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const tt = t[ny * w + nx];
      if (tt === TILE.FLOOR || tt === TILE.WATER) return true;
    }
    return false;
  }

  // Cozy hub props: drawn in world space under the same camera.
  function drawFurniture(f) {
    const x = f.x, y = f.y;
    ctx.save();

    if (f.kind === 'board') {
      // Notice board on two posts.
      ctx.fillStyle = '#5a3d24';
      ctx.fillRect(x - 2, y - 14, 3, 14);
      ctx.fillRect(x + 14, y - 14, 3, 14);
      ctx.fillStyle = '#c9995c';
      ctx.fillRect(x - 10, y - 18, 28, 10);
      ctx.strokeStyle = '#8a6134';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 9.5, y - 17.5, 27, 9);
      // Papers pinned.
      ctx.fillStyle = '#f4e3c0';
      ctx.fillRect(x - 7, y - 16, 6, 6);
      ctx.fillRect(x + 1, y - 16, 6, 6);
      ctx.fillRect(x - 7, y - 16, 1.4, 1.2);
      ctx.fillStyle = '#8a6134';
      ctx.fillRect(x + 4, y - 15.5, 1.2, 1.2);
    } else if (f.kind === 'crate') {
      ctx.fillStyle = '#7a5330';
      ctx.fillRect(x - 7, y - 7, 14, 14);
      ctx.strokeStyle = '#5c3d22';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 7, y - 7, 14, 14);
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7);
      ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7);
      ctx.stroke();
    } else if (f.kind === 'fire') {
      // Campfire: rock ring + animated flame (deterministic, uses G.clock).
      ctx.fillStyle = '#4a443d';
      ctx.beginPath(); ctx.arc(x, y + 3, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6a5f52';
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI * 2) / 6 + 0.4;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 8, y + 3 + Math.sin(a) * 8, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      const fl = 0.5 + 0.5 * Math.sin(G.clock * 11 + x);
      const f2 = 0.4 + 0.4 * Math.sin(G.clock * 7.7 + x + 2);
      ctx.fillStyle = `rgba(255,${130 + Math.round(fl * 90)},60,0.9)`;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.quadraticCurveTo(x - 2, y - 9 - fl * 5, x, y);
      ctx.quadraticCurveTo(x + 2, y - 9 - f2 * 5, x + 5, y);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,235,150,0.85)';
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.quadraticCurveTo(x - 1, y - 5 - fl * 3, x, y);
      ctx.quadraticCurveTo(x + 1, y - 5 - f2 * 3, x + 3, y);
      ctx.fill();
    } else if (f.kind === 'sign') {
      // Small signpost.
      ctx.fillStyle = '#5a3d24';
      ctx.fillRect(x - 1.5, y - 10, 3, 10);
      ctx.fillStyle = '#c9995c';
      ctx.fillRect(x - 9, y - 16, 18, 8);
      ctx.fillStyle = '#f4e3c0';
      ctx.font = '7px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Lang.t(f.label || '…'), x, y - 12);
    } else if (f.kind === 'totem') {
      // Stone guardian totem — marks the difficulty board.
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(x - 6, y - 14, 12, 18);
      ctx.fillStyle = '#4b5563';
      ctx.beginPath(); ctx.arc(x, y - 16, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e5c46a';
      ctx.beginPath(); ctx.arc(x - 2, y - 17, 1.4, 0, Math.PI * 2); ctx.arc(x + 2, y - 17, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#374151';
      ctx.beginPath(); ctx.moveTo(x - 4, y - 13); ctx.lineTo(x + 4, y - 13); ctx.stroke();
    } else if (f.kind === 'door') {
      // The way down: a heavy wood-cased portal near the top wall. It pulses
      // faintly so the player always finds it, and a small rune round the
      // frame marks it as the staircase.
      const pulse = 0.5 + 0.5 * Math.sin(G.clock * 2.2);
      ctx.fillStyle = '#4a3320';
      ctx.fillRect(x - 10, y - 16, 20, 21);
      ctx.fillStyle = '#7a5330';
      ctx.fillRect(x - 8, y - 14, 16, 17);
      ctx.fillStyle = '#5c3d22';
      ctx.fillRect(x - 8, y - 14, 16, 17);
      const edge = Math.round(pulse * 3) * 2;
      for (let dy = -12; dy < 12; dy += 4) {
        ctx.fillStyle = `rgba(120,200,255,${0.25 + pulse * 0.2})`;
        ctx.fillRect(x - 6, y - 12 + dy, 12, 2);
      }
      ctx.fillStyle = '#5c3d22';
      ctx.fillRect(x - 6 + edge, y - 12, 2, 14); // swing door
      ctx.fillStyle = '#c9995c';
      ctx.beginPath(); ctx.arc(x - 4 + edge, y - 3, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,180,0.8)';
      ctx.font = '8px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↓', x, y - 24);
    } else if (f.kind === 'sofa') {
      // Plush two-seater: dark leather back, cushions, armrests.
      ctx.fillStyle = '#8a5a3a';
      ctx.fillRect(x - 12, y - 6, 24, 6);
      ctx.fillStyle = '#6b4528';
      ctx.fillRect(x - 12, y - 11, 24, 5);
      ctx.fillStyle = '#5c3d22';
      ctx.fillRect(x - 14, y - 8, 3, 8);
      ctx.fillRect(x + 11, y - 8, 3, 8);
      ctx.fillStyle = '#a06a45';
      ctx.fillRect(x - 8, y - 5, 7, 4);
      ctx.fillRect(x + 1, y - 5, 7, 4);
    } else if (f.kind === 'fridge') {
      // Tall adventurer's icebox with two doors and a handle.
      ctx.fillStyle = '#8fa8b8';
      ctx.fillRect(x - 8, y - 18, 16, 22);
      ctx.strokeStyle = '#5c7280';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 8, y - 18, 16, 22);
      ctx.fillStyle = '#aec6d1';
      ctx.fillRect(x - 8, y - 18, 16, 21);
      ctx.strokeRect(x - 8, y - 5, 16, 9);
      ctx.fillStyle = '#5c7280';
      ctx.fillRect(x - 6, y - 12, 1.4, 4);
      ctx.fillRect(x - 6, y  , 1.4, 4);
      ctx.fillStyle = '#e8f2f5';
      ctx.font = '8px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('❄', x, y - 13);
    } else if (f.kind === 'bookshelf') {
      // Tall shelf packed with books and one candle-ish glow.
      ctx.fillStyle = '#5a3d24';
      ctx.fillRect(x - 8, y - 18, 16, 22);
      ctx.fillStyle = '#6b4528';
      ctx.fillRect(x - 7, y - 17, 14, 21);
      const palette = ['#c9995c', '#e6c458', '#7c5cff', '#5ce1a0', '#ff8c66', '#8fa8b8'];
      for (let s = 0; s < 3; s++) {
        for (let b = 0; b < 4; b++) {
          ctx.fillStyle = palette[(b + s * 3) % palette.length];
          ctx.fillRect(x - 6 + b * 3.4, y - 14 + s * 6, 2.4, 5.5);
        }
      }
      ctx.strokeStyle = '#3f2a16';
      ctx.lineWidth = 1;
      for (let s = 0; s < 3; s++) ctx.strokeRect(x - 8, y - 8 + s * 6, 16, 6);
    } else if (f.kind === 'plant') {
      // Potted fern: terracotta pot with layered green leaves.
      ctx.fillStyle = '#c97753';
      ctx.fillRect(x - 5, y - 4, 10, 7);
      ctx.fillStyle = '#a8602f';
      ctx.fillRect(x - 5, y - 8, 2, 4);
      ctx.fillRect(x + 3, y - 8, 2, 4);
      ctx.fillStyle = '#3f8f3f';
      for (let i = 0; i < 5; i++) {
        const a = -1.5 + i * 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.quadraticCurveTo(x + Math.cos(a) * 7, y - 12, x + Math.cos(a) * 10, y - 20 + (i % 2) * 2);
        ctx.lineTo(x + Math.cos(a) * 6, y - 10);
        ctx.fill();
      }
      ctx.fillStyle = '#5ab35a';
      ctx.beginPath(); ctx.arc(x, y - 10, 3, 0, Math.PI * 2); ctx.fill();
    } else if (f.kind === 'lamp') {
      // Standing lantern: slim pole with a warm glowing bulb overhead.
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(x - 1.5, y - 14, 3, 14);
      ctx.fillStyle = '#374151';
      ctx.beginPath(); ctx.arc(x, y - 14, 4, 0, Math.PI * 2); ctx.fill();
      const l = 0.55 + 0.45 * Math.sin(G.clock * 3 + x);
      ctx.fillStyle = `rgba(255,220,140,${0.35 + l * 0.35})`;
      ctx.beginPath(); ctx.arc(x, y - 14, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f2d27a';
      ctx.beginPath(); ctx.arc(x, y - 14, 2.4, 0, Math.PI * 2); ctx.fill();
    } else if (f.kind === 'rug') {
      // Oval woven rug under the centre: rings of thread.
      ctx.strokeStyle = '#b98a5a';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(x, y + 2, 22, 13, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#9a6a3e';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x, y + 2, 17, 9.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#c9a06a';
      ctx.beginPath(); ctx.ellipse(x, y + 2, 12, 6.5, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (f.kind === 'npc') {
      // Interactable NPC (class keeper / lore keeper): draw under a soft ring.
      const bob = Math.sin(G.clock * 2 + x) * 1.5;
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = f.color || '#7c5cff';
      ctx.beginPath(); ctx.arc(x, y + 4, 13, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      Art.draw(ctx, f.art || 'merchant', f.color || '#b9a6e0', x, y + bob, 13, 1);
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(Lang.t(f.label || ''), x, y - 16);
    }

    ctx.restore();
  }

  function drawUnit(g, u, ox, oy, scale) {
    const r = u.radius;
    const isPlayer = u === g.player;
    const phase = u.phase || 5;

    // Animation offsets (world px, applied BEFORE the camera translation).
    let sx = 0, sy = 0;
    let scalex = 1, scaley = 1;

    // Walk bob ramps in with recent movement (u.walkT ~ 0..1) and eases out
    // when idle; idle gives a slow breathing drift instead. Moving also rocks
    // the body a touch so the step reads as real momentum.
    const move = Math.min(1, (u.walkT || 0) * 3);
    let rock = 0;
    if (move > 0.01) {
      const wb = Math.sin(g.clock * 10 + phase);
      sy -= Math.abs(wb) * 2.6 * move;
      sx += wb * 1.3 * move;
      rock = Math.sin(g.clock * 10 + phase) * 0.07 * move;
    } else {
      sy -= (Math.sin(g.clock * 2.6 + phase) * 0.6 + 0.6);
    }

    // Attack body language: melee leans back on windup, lunges on the active
    // swing (with a quick squash), then eases back; ranged recoils on cast.
    if (u.attacking) {
      const a = u.attacking;
      if (a.kind === 'melee') {
        if (a.t < a.windup) {
          const pt = a.t / Math.max(0.01, a.windup);
          sx -= a.dirx * 3.5 * pt; sy -= a.diry * 3.5 * pt;
        } else if (a.t < a.windup + a.active) {
          const pt = (a.t - a.windup) / Math.max(0.01, a.active);
          sx += a.dirx * 8 * pt; sy += a.diry * 8 * pt;
          scalex = 1 + 0.12 * pt; scaley = 1 - 0.12 * pt;
        } else {
          const rt = Math.min(1, (a.t - a.windup - a.active) / Math.max(0.01, a.recover));
          sx += a.dirx * 8 * (1 - rt); sy += a.diry * 8 * (1 - rt);
        }
      } else if (a.kind === 'ranged' && a.t >= a.windup && a.t < a.windup + a.active) {
        sx -= a.dirx * 2.5; sy -= a.diry * 2.5;
      }
    }

    const px = ox + u.x + sx, py = oy + u.y + sy;

    // Body shadow (tracks the sprite gently).
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(px, py + r * 0.7, r * 0.8, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hit flash / ghost translucency + idle flicker.
    ctx.save();
    if (u.hitFlash > 0) ctx.globalAlpha = 0.6 + 0.3 * Math.sin(u.hitFlash * 40);
    if (u.type === 'ghost') ctx.globalAlpha *= 0.62 + 0.25 * Math.sin(g.clock * 9 + phase);
    const baseAlpha = ctx.globalAlpha;

    // Pixel-art body; fall back to a circle + emoji glyph if no sprite.
    const baseColor = u.bodyColor || (isPlayer ? '#5ca2ff' : (u.color || '#999'));
    const artKey = isPlayer ? (HERO_ART[Entities.classKey(u)] || 'hero') : (u.key || (u.isMerchant ? 'merchant' : null));
    const flip = u.facing || 1;

    // Armor tint: blend the base colour with the equipped armor colour so the
    // hero sprite visually reflects the armour the player is wearing.
    let bodyColor = baseColor;
    if (isPlayer && u.armor && u.armor.color) {
      bodyColor = blendHex(baseColor, u.armor.color, 0.45);
    }

    if (artKey) {
      ctx.save();
      ctx.translate(px, py);
      if (u.dashing && (u.dashing.dirx || u.dashing.diry)) {
        const ang = Math.atan2(u.dashing.diry, u.dashing.dirx);
        ctx.rotate(ang);
        ctx.scale(1.3, 0.82);
      } else {
        ctx.rotate(rock);
        ctx.scale(scalex * flip, scaley);
      }
      const drawn = Art.draw(ctx, artKey, bodyColor, 0, 0, r, 1);
      ctx.restore();
      if (drawn === false) {
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${Math.round(r * 1.3)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(u.glyph || '👾', px, py);
      }

      // Weapon skin: draw the equipped weapon sprite near the hand, facing-
      // dependent, after the body so it layers on top.
      if (isPlayer && u.weapon && u.weapon.sprite) {
        const handX = flip > 0 ? r * 0.55 : -r * 0.55;
        const handY = -r * 0.35;
        const wAng = flip > 0 ? -0.6 : Math.PI + 0.6;
        ctx.save();
        ctx.translate(px + handX, py + handY);
        ctx.rotate(wAng);
        Art.draw(ctx, u.weapon.sprite, u.weapon.color || '#e0d8b8', 0, 0, r * 0.55, 1);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${Math.round(r * 1.3)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.glyph || '👾', px, py);
    }
    ctx.globalAlpha = baseAlpha;

    // HP bar above enemy that is damaged.
    if (!isPlayer && u.maxHp && u.hp < u.maxHp) {
      const bw = r * 2;
      const pct = u.hp / u.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(ox + u.x - bw / 2, oy + u.y - r - 10, bw, 4);
      ctx.fillStyle = '#ff3b5c';
      ctx.fillRect(ox + u.x - bw / 2, oy + u.y - r - 10, bw * pct, 4);
    }

    // Melee attack windup/active telegraph (arc while swinging).
    if (u.attacking && u.attacking.kind === 'melee') {
      const a = u.attacking;
      if (a.t >= 0 && a.t < a.windup + a.active) {
        drawAttackArc(g, u, ox, oy, scale, a);
      }
    }

    ctx.restore();
  }

  function drawAttackArc(g, u, ox, oy, scale, a) {
    const px = ox + u.x, py = oy + u.y;
    const angle = Math.atan2(a.diry, a.dirx);
    const arcLen = 1.2;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(px, py, a.range + 4, angle - arcLen / 2, angle + arcLen / 2);
    ctx.arc(px, py, a.range - 6, angle + arcLen / 2, angle - arcLen / 2, true);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawAimLine(g, ox, oy, scale) {
    const cx = canvas.width / dpr / 2, cy = canvas.height / dpr / 2;
    const dx = Input.mouseX - cx, dy = Input.mouseY - cy;
    const len = Math.hypot(dx, dy);
    if (len < 8) return;
    const nx = dx / len, ny = dy / len;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,122,60,0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(cx + nx * 16, cy + ny * 16);
    ctx.lineTo(cx + nx * 60, cy + ny * 60);
    ctx.stroke();
    ctx.restore();
  }

  // Lighting: draw a darkness overlay, then carve (via destination-out) soft
  // light "windows" around the player/torches/enemies in screen space. Drawing
  // the world first and overlaying this atop guarantees the dungeon is always
  // visible around the player, regardless of tile/pixel scale.
  let overlayCanvas = null;
  let overlayW = 0, overlayH = 0;

  function getOverlayCanvas(cw, ch) {
    const dw = Math.max(1, Math.round(cw * dpr));
    const dh = Math.max(1, Math.round(ch * dpr));
    if (!overlayCanvas || overlayW !== dw || overlayH !== dh) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = dw;
      overlayCanvas.height = dh;
      overlayW = dw; overlayH = dh;
    }
    return overlayCanvas;
  }

  // Soft circular hole in the darkness (radial gradient, brightest at center).
  function lightHole(oc, x, y, r) {
    if (!(r > 0)) return;
    const grad = oc.createRadialGradient(x, y, r * 0.15, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    oc.fillStyle = grad;
    oc.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function drawLighting(g, cw, ch, camX, camY, K) {
    const ts = g.tileScale || 24;
    const oc = getOverlayCanvas(cw, ch).getContext('2d');
    oc.setTransform(dpr, 0, 0, dpr, 0, 0);
    oc.globalCompositeOperation = 'source-over';
    oc.clearRect(0, 0, cw, ch);

    // Base darkness.
    oc.fillStyle = 'rgba(0,0,0,0.42)';
    oc.fillRect(0, 0, cw, ch);

    // World→screen under the same zoom K as the world pass, so light circles
    // sit exactly on the tiles/units they belong to.
    const ox = cw / 2 - camX * K, oy = ch / 2 - camY * K;

    // Carve light windows (screen space). Player sits at screen center.
    oc.globalCompositeOperation = 'destination-out';
    lightHole(oc, cw / 2, ch / 2, (g.playerLight || 7) * ts);
    for (const torch of g.world.torches) {
      lightHole(oc, ox + torch.x * K, oy + torch.y * K, Math.max(1, torch.r * ts));
    }
    for (const e of g.world.enemies) {
      lightHole(oc, ox + e.x * K, oy + e.y * K, Math.max(1, (e.isBoss || e.isGuardian ? 11 : 3) * ts));
    }
    oc.globalCompositeOperation = 'source-over';

    // Composite the darkness overlay on top of the world at CSS size; the main
    // context's dpr transform maps it 1:1 onto the full backing store.
    ctx.drawImage(overlayCanvas, 0, 0, cw, ch);
  }

  return { init, resize, render, get dpr() { return dpr; } };
})();
