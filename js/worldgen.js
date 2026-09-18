/* worldgen.js — deterministic cave generation (cellular automata) + floor tables. */
'use strict';

const WorldGen = (() => {
  const TILE = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, WATER: 4, LAVA: 5 };

  // Floor theme pool — one of these is deterministically picked per floor by
  // the run seed, so every run visits them in a different (but reproducible)
  // order across the ~100 floors.
  const FLOORS = [
    { name: 'Тёмные катакомбы', hint: 'Первые крики эха в коридорах', theme: { floor: ['#3a3a52', '#34344a'], wall: '#23233a', glow: '#7c5cff' } },
    { name: 'Затопленные склепы', hint: 'Вода просачивается сквозь камни', theme: { floor: ['#2f3a4a', '#283240'], wall: '#1b2636', glow: '#5ce1e6' } },
    { name: 'Огненные недра', hint: 'Жар обжигает лёгкие', theme: { floor: ['#5a2f22', '#4a2418'], wall: '#33140c', glow: '#ff7a3c' } },
    { name: 'Зал пустоты', hint: 'Здесь заканчивается свет', theme: { floor: ['#2a2342', '#221c38'], wall: '#150f28', glow: '#c09bff' } },
    { name: 'Трон Веков', hint: 'Последний страж смотрит на тебя', theme: { floor: ['#3a2a33', '#2e2129'], wall: '#1e1116', glow: '#ff3b5c' } },
    { name: 'Забытая библиотека', hint: 'Шёпот страниц не умолкает', theme: { floor: ['#3a3a2c', '#32322a'], wall: '#22221b', glow: '#ffe08a' } },
    { name: 'Костяное поле', hint: 'Под ногами — целый мир костей', theme: { floor: ['#4a4640', '#403c38'], wall: '#2c2926', glow: '#dfe0e8' } },
    { name: 'Изумрудные гроты', hint: 'Кристаллы светятся изнутри', theme: { floor: ['#1f3a2c', '#1a3126'], wall: '#0f2218', glow: '#5ce1a0' } },
    { name: 'Морозные залы', hint: 'Дыхание превращается в лёд', theme: { floor: ['#2c3a4a', '#253240'], wall: '#16202e', glow: '#9be8ff' } },
    { name: 'Бездна', hint: 'Пустота больше не скрывается', theme: { floor: ['#33203a', '#2a1a30'], wall: '#1b0f20', glow: '#ff7ad5' } },
  ];

  // Deterministic per-(floor, seed) theme so render and worldgen agree on the
  // look of a saved/reloaded floor without storing extra state.
  function floorTheme(floor, seed) {
    const rng = Util.mulberry32((((seed >>> 0) ^ (floor * 9941)) >>> 0) || 1);
    return FLOORS[Math.floor(rng() * FLOORS.length)];
  }
  function floorName(floor, seed) { return floorTheme(floor, seed).name; }

  // Build a purely random cave map from a seed (cellular automata smoothing),
  // then guarantee connectivity by carving corridors to the largest room.
  // All randomness flows from one seeded stream (no global Math.random).
  function makeFloorData(floorIndex, seed, opts) {
    const w = 60, h = 40;
    const tiles = new Uint8Array(w * h).fill(TILE.WALL);
    const walkable = new Uint8Array(w * h);
    const rng = Util.mulberry32((((seed >>> 0) ^ (floorIndex * 7919)) >>> 0) || 1);

    caveSmooth(tiles, w, h, rng);
    connectCaves(tiles, w, h, rng);
    ensureFloor(tiles, w, h);
    applyHazards(tiles, w, h, floorIndex, rng);
    // Hazards can re-seal a freshly carved corridor; reconnect after them.
    connectCaves(tiles, w, h, rng);

    // Merchant floors get a cosy room at the bottom of the map, connected to
    // the cave by a short tunnel. The player spawns there with the merchant;
    // the dungeon is one corridor-trek above.
    let shopRoom = null;
    if (opts && opts.shop) shopRoom = carveShopRoom(tiles, w, h, rng);

    // Recompute the walkable grid after hazards/shop room. Water and lava are
    // crossable hazard tiles (slow water / burning lava) rather than pure walls.
    for (let i = 0; i < tiles.length; i++) {
      walkable[i] = (tiles[i] === TILE.FLOOR || tiles[i] === TILE.DOOR ||
                     tiles[i] === TILE.WATER || tiles[i] === TILE.LAVA) ? 1 : 0;
    }

    // Safe zones: rectangles no enemies or wandering hazards may enter. The
    // merchant den is always a safe haven on its floors.
    const safeRects = [];
    if (shopRoom) safeRects.push(shopRoom.safeRect);

    return { w, h, tiles, walkable, floorIndex, shopRoom, safeRects };
  }

  // Carve a private merchant den: a walled rectangle at the bottom of the map
  // (so it never bleeds into the cave), entered by one short vertical corridor
  // three cells above the room ceiling. connectCaves later bridges that stub
  // to the open cave, keeping the merchant den snug and enclosed otherwise.
  function carveShopRoom(tiles, w, h, rng) {
    const rw = 23, rh = 8;
    const cx = (w / 2) | 0;                       // tunnel column
    const topY = h - rh - 1;                      // first room row (h-9 for 40 rows)
    const x0 = cx - ((rw / 2) | 0), x1 = cx + ((rw / 2) | 0);

    // Room floor.
    for (let y = topY; y < h - 1; y++) {
      for (let x = x0; x <= x1; x++) tiles[y * w + x] = TILE.FLOOR;
    }
    // Solid walls frame the room (sides + ceiling); bottom is the map's rock.
    for (let y = topY; y < h - 1; y++) { tiles[y * w + (x0 - 1)] = TILE.WALL; tiles[y * w + (x1 + 1)] = TILE.WALL; }
    for (let x = x0 - 1; x <= x1 + 1; x++) tiles[(topY - 1) * w + x] = TILE.WALL;

    // Short vertical stub: exactly three cells above the room ceiling. It is
    // left enclosed; connectCaves opens a corridor from it into the cave.
    for (let y = topY - 1; y >= topY - 3; y--) {
      for (let dx = -1; dx <= 1; dx++) tiles[y * w + (cx + dx)] = TILE.FLOOR;
    }

    // Carving can split newly opened regions; reconnect once more.
    connectCaves(tiles, w, h, rng);

    // Cosy den dressing around the merchant's spot: stacked crates/barrels on
    // both sides of the room so the shop feels lived-in, plus a warm lantern.
    const midY = (topY + topY + rh) / 2;
    const furniture = [
      { kind: 'crate', x: (x0 + 1) * 24 + 12, y: (midY - 1) * 24 },
      { kind: 'crate', x: (x0 + 1) * 24 + 12, y: (midY + 1) * 24 },
      { kind: 'crate', x: (x1 - 1) * 24 + 12, y: (midY - 1) * 24 },
      { kind: 'fire', x: (x1 - 2) * 24, y: (topY + 2) * 24 },
      { kind: 'sign', x: (x0 + 4) * 24, y: (topY + 1) * 24, label: 'Лавка' },
    ];

    return { cx, topY, rw, rh, spawnCol: cx, furniture,
             safeRect: { x0: x0 - 1, y0: topY - 2, x1: x1 + 1, y1: h - 2 } };
  }

  // BuildHub: a cozy standalone home base that sits apart from the dungeon.
  // It is a solidly walled room (no CA noise) furnished with door, sofa,
  // fridge, bookshelf, plant, lamp, rug and three class NPCs seated in
  // different corners, plus the lore keeper, difficulty totem and board.
  // The door at the top is the single way down into the dungeon (floor 1).
  function buildHub() {
    const w = 44, h = 30;
    const tiles = new Uint8Array(w * h).fill(TILE.WALL);
    const walkable = new Uint8Array(w * h);
    // Carve the whole interior as one open floor (border stays rock).
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) tiles[y * w + x] = TILE.FLOOR;
    }
    for (let i = 0; i < tiles.length; i++) {
      walkable[i] = (tiles[i] === TILE.FLOOR) ? 1 : 0;
    }

    // Furniture, expressed in world pixels (tile * 24). Positions are fixed —
    // the hub never varies per run, it is the player's home.
    const P = (tx, ty) => ({ x: tx * 24 + 12, y: ty * 24 + 12 });
    const furniture = [
      // doorway at the very top; stepping onto it descends to floor 1.
      { kind: 'door', ...P(22, 1) },
      { kind: 'sign', ...P(18, 3), label: 'Вниз' },
      // left corner: bookshelf wall with an armchair lamp and the mage.
      { kind: 'bookshelf', ...P(3, 3) },
      { kind: 'bookshelf', ...P(3, 8) },
      { kind: 'lamp', ...P(6, 4) },
      { kind: 'npc', ...P(6, 8), color: '#5ca2ff', label: 'Маг', role: 'class', cls: 'mage', npcKey: 'kb_mage', art: 'hero_mage' },
      // center-right: sofa where the warrior rests.
      { kind: 'sofa', ...P(30, 8) },
      { kind: 'npc', ...P(30, 10), color: '#ffcf6a', label: 'Рубака', role: 'class', cls: 'warrior', npcKey: 'kb_warrior', art: 'hero_warrior' },
      // right corner: fridge, plant, lamp, and the rogue crouching on a crate.
      { kind: 'fridge', ...P(38, 3) },
      { kind: 'plant', ...P(41, 8) },
      { kind: 'crate', ...P(38, 10) },
      { kind: 'npc', ...P(39, 12), color: '#b18cff', label: 'Тень', role: 'class', cls: 'rogue', npcKey: 'kb_rogue', art: 'hero_rogue' },
      // bottom band: notice board, difficulty totem, hearth, rug, crates.
      { kind: 'board', ...P(4, 24) },
      { kind: 'totem', ...P(12, 24) },
      { kind: 'fire', ...P(22, 24) },
      { kind: 'rug', ...P(22, 19) },
      { kind: 'crate', ...P(34, 25) },
      { kind: 'crate', ...P(36, 25) },
      // lore keeper greets you on the right near the dead center.
      { kind: 'npc', ...P(33, 20), color: '#5ce1a0', label: 'Хранитель историй', role: 'lore', npcKey: 'keeper_lore', art: 'merchant' },
    ];

    // A couple of tall-burning torches so the hub never feels pitch dark.
    const torches = [
      { x: (2 * 24) + 12, y: 2 * 24 + 12, r: 6 },
      { x: (41 * 24) + 12, y: 2 * 24 + 12, r: 6 },
      { x: (2 * 24) + 12, y: (h - 2) * 24 + 12, r: 6 },
      { x: (41 * 24) + 12, y: (h - 2) * 24 + 12, r: 6 },
    ];

    return {
      w, h, tiles, walkable, furniture, torches,
      // The whole hub is a safe zone (no enemies ever spawn here).
      safeRects: [{ x0: 1, y0: 1, x1: w - 2, y1: h - 2 }],
      // Player spawns near the centre, facing the door.
      spawn: P(22, 14),
      // The top door tile: standing on it triggers the descent.
      door: P(22, 1),
    };
  }

  function rnd(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  // Cellular automata: random rock fill, then smooth rounds grow organic
  // cavernous blobs. The whole map participates — no pre-placed blocks.
  function caveSmooth(tiles, w, h, rng) {
    for (let i = 0; i < tiles.length; i++) {
      tiles[i] = rng() < 0.44 ? TILE.FLOOR : TILE.WALL;
    }
    // Border ring stays solid rock.
    for (let x = 0; x < w; x++) { tiles[x] = TILE.WALL; tiles[(h - 1) * w + x] = TILE.WALL; }
    for (let y = 0; y < h; y++) { tiles[y * w] = TILE.WALL; tiles[y * w + (w - 1)] = TILE.WALL; }

    for (let round = 0; round < 5; round++) {
      const next = Uint8Array.from(tiles);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          let open = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (tiles[(y + dy) * w + (x + dx)] === TILE.FLOOR) open++;
            }
          }
          if (open >= 5) next[i] = TILE.FLOOR;
          else if (open <= 3) next[i] = TILE.WALL;
        }
      }
      tiles.set(next);
    }
  }

  // Flood-fill every distinct open region and merge them into one connected
  // cave via 3-wide corridors, so every corner of the floor is reachable.
  function connectCaves(tiles, w, h, rng) {
    const seen = new Uint8Array(w * h);
    const comps = [];
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== TILE.FLOOR || seen[i]) continue;
      const comp = [];
      const queue = [i];
      seen[i] = 1;
      while (queue.length) {
        const idx = queue.pop();
        comp.push(idx);
        const cx = idx % w, cy = (idx / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (tiles[ni] === TILE.FLOOR && !seen[ni]) { seen[ni] = 1; queue.push(ni); }
          }
        }
      }
      if (comp.length) comps.push(comp);
    }
    // Largest first; every smaller pocket gets bridged to the main cave.
    comps.sort((a, b) => b.length - a.length);
    for (let c = 1; c < comps.length; c++) {
      const a = comps[0][rnd(rng, 0, comps[0].length - 1)];
      const b = comps[c][rnd(rng, 0, comps[c].length - 1)];
      carveCorridor(tiles, w, h, a % w, (a / w) | 0, b % w, (b / w) | 0);
    }
  }

  // L-shaped passage that cuts through solid rock (used to join cave pockets).
  function carveCorridor(tiles, w, h, x0, y0, x1, y1) {
    let x = x0, y = y0;
    while (x !== x1) { dig(tiles, w, h, x, y); x += Math.sign(x1 - x); }
    while (y !== y1) { dig(tiles, w, h, x, y); y += Math.sign(y1 - y); }
    dig(tiles, w, h, x, y);
  }

  function dig(tiles, w, h, x, y) {
    const r = 1; // 3x3 chisel keeps paths comfortably wide (≥3 tiles).
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        tiles[ny * w + nx] = TILE.FLOOR;
      }
    }
  }

  // Safety net: caller always needs some open floor (even a degenerate CA run).
  function ensureFloor(tiles, w, h) {
    let floors = 0;
    for (let i = 0; i < tiles.length; i++) if (tiles[i] === TILE.FLOOR) floors++;
    if (floors >= 120) return;
    const cx = (w / 2) | 0, cy = (h / 2) | 0;
    for (let y = cy - 4; y <= cy + 4; y++) {
      for (let x = cx - 5; x <= cx + 5; x++) {
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) tiles[y * w + x] = TILE.FLOOR;
      }
    }
  }

  // Scatter a few contiguous hazard pools (water / lava) instead of random
  // per-tile sprinkling, so paths read clearly and don't get pinched randomly.
  // Floors 1-2 (tutorial) get a single kind; deeper floors mix both.
  function applyHazards(tiles, w, h, floorIndex, rng) {
    const kinds = [];
    if (floorIndex === 1) kinds.push(TILE.WATER);
    else if (floorIndex === 2) kinds.push(TILE.LAVA);
    else {
      if (rng() < 0.55) kinds.push(TILE.WATER);
      if (rng() < 0.55) kinds.push(TILE.LAVA);
      if (!kinds.length) kinds.push(TILE.WATER);
    }
    for (const kind of kinds) {
      const pools = rnd(rng, 3, 5);
      for (let p = 0; p < pools; p++) {
      // Start on a random open cell, then blob outward like a random walk.
        const seeds = [];
        for (let i = 0; i < tiles.length; i++) {
          if (tiles[i] === TILE.FLOOR) seeds.push(i);
        }
        if (!seeds.length) break;
        let x = seeds[rnd(rng, 0, seeds.length - 1)] % w;
        let y = (seeds[rnd(rng, 0, seeds.length - 1)] / w) | 0;
        const steps = rnd(rng, 8, 16);
        for (let s = 0; s < steps; s++) {
          const i = y * w + x;
          if (tiles[i] === TILE.FLOOR) tiles[i] = kind;
          else break; // pool ran into a wall and stops growing this direction
          const d = rnd(rng, 0, 3);
          if (d === 0) x = Math.min(w - 2, x + 1);
          else if (d === 1) x = Math.max(1, x - 1);
          else if (d === 2) y = Math.min(h - 2, y + 1);
          else y = Math.max(1, y - 1);
        }
      }
    }
  }

  // Pick a random open floor cell (not hazard) for POI placement.
  function randomFloorSpot(tiles, w, h, rng, margin) {
    const m = margin || 1;
    const cells = [];
    for (let y = m; y < h - 1; y++) {
      for (let x = m; x < w - 1; x++) {
        if (tiles[y * w + x] === TILE.FLOOR) cells.push([x, y]);
      }
    }
    if (cells.length === 0) return [5, 5];
    const rr = rng || Math.random;
    return cells[Math.floor(rr() * cells.length)];
  }

  // A nice open pocket (≥13 open tiles around) for the player start/respawn.
  function spawnRoom(tiles, walkable, w, h, rng) {
    const candidates = [];
    for (let y = 3; y < h - 3; y++) {
      for (let x = 3; x < w - 3; x++) {
        const t = tiles[y * w + x];
        if (t !== TILE.FLOOR) continue;
        let open = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (tiles[(y + dy) * w + (x + dx)] === TILE.FLOOR) open++;
        }
        if (open >= 13) candidates.push([x, y]);
      }
    }
    if (candidates.length) {
      const rr = rng || Math.random;
      return candidates[Math.floor(rr() * candidates.length)];
    }
    // Fallback: any walkable floor cell rather than an arbitrary spot.
    const any = [];
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      if (tiles[y * w + x] === TILE.FLOOR) any.push([x, y]);
    }
    if (any.length) {
      const rr = rng || Math.random;
      return any[Math.floor(rr() * any.length)];
    }
    return [8, 8];
  }

  return { TILE, FLOORS, floorTheme, floorName, makeFloorData, randomFloorSpot, spawnRoom, buildHub };
})();