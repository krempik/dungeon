/* game.js — authoritative state, fixed-timestep loop, and all update logic. */
'use strict';

// Module state declared up top.
let canvas, ctx;
let rafId = null;
let last = 0;
let acc = 0;
const STEP = 1000 / 30;   // 30 Hz fixed simulation step

let state = 'menu';       // menu | playing | dead | victory
let paused = false;       // game paused by menu/pause overlay (acc frozen)
let overlayOpen = false;  // a game-overlay panel is up (blocks action + aiming)
let running = false;      // raf loop active

// Surface any runtime exception as a visible banner instead of a silent freeze
// (an uncaught throw inside frame() kills the requestAnimationFrame chain).
let lastCrashMsg = '';
function reportCrash(err, phase) {
  const msg = String((err && err.stack) || err || 'unknown error');
  console.error('[crash]', phase || 'frame', err);
  if (msg === lastCrashMsg) return;
  lastCrashMsg = msg;
  try {
    UI.showBanner('ОШИБКА: ' + (phase || 'ошибка') + ' — ' + msg, '');
  } catch (e) { /* banner unavailable; console above is the trace */ }
}

const Tile = WorldGen.TILE;

// The climb ends here: floor 100 holds the final boss. A merchant visit awaits
// every 5th floor (5/10/15/.../95) and floors 10/20/.../90 host a "guardian"
// (junior boss) along the normal pack — so the 10th floors double as both the
// shopping stop AND the arena.
const FINAL_FLOOR = 100;
const GAME_VERSION = '1.0.1';

// Story beats surfaced as captions on set floors. They read as short diary
// entries — a few sentences each, shown for a long time so they can be read.
const LORE = {
  1: 'Говорят, этот колодец вёл в самое сердце мира.\nТеперь он ведёт вниз — и снизу кто-то отвечает эхом.\nНачни с ключа: лестница не откроется без него.',
  5: 'Рынок Пустоты — последнее место, где золото ещё что-то значит.\nТорговец ждёт в своей норе на нижнем краю этажа.\nОн видит глубже, чем говорит.',
  10: 'Стражи не охраняют сокровища. Они охраняют лестницу.\nКаждый десятый этаж — его дозорный пост.\nРазобьёшь стража — спускайся, не оглядываясь.',
  25: 'Стены узнали твоё имя. Это нехороший знак.\nГравировка на кости всё длиннее — кто-то ведёт счёт песчинок.',
  50: 'Половина пути. Свет сверху стал воспоминанием.\nВоздух тяжёлый и тёплый, как дыхание спящего.\nОн спит. Не буди раньше времени.',
  75: 'Глубины больше не скрывают то, что шевелится между этажами.\nЩитоносцы и тараны идут в бой без крика — они просто знают, где ты окажешься.',
  90: 'Он уже знает, что ты придёшь.\nПоследние десять этажей — его дворцы. Здесь камень помнит его шаги.',
  100: 'ВЛАДЫКА ПУСТОТЫ. Тот, кто съел всех своих стражей.\nНичего у него не осталось, кроме голода.\nКончи его — и лестница, наконец, кончится.',
};
const MERCHANT_LINES = [
  'Глубины жадные, путник. Не скупись.',
  'Серебро здесь обесценивается с каждым этажом. Трать сейчас.',
  'Видел Повелителя? Я — нет. И не хочу.',
  'Камень, сталь и зубы — надёжнее любой магии.',
  'Возвращайся с золотом — я не пошевелюсь без монеты.',
  'Это остриё выковано из костей твоего предшественника.',
  'Пока ты спускаешься, я торгую. Так каждый из нас идёт своим путём.',
];

// The current Game state object.
let G = null;

// One seeded rng shared by all placement decisions for a floor build, so a
// given (seed, floor) always produces the same layout (save/load stability).
function floorRng(floorIndex) {
  return Util.mulberry32((((G.seed >>> 0) ^ (floorIndex * 65537)) >>> 0) || 1);
}
function rndInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function rndPick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function newGame(clsKey) {
  UI.hidePanel();
  state = 'playing';
  overlayOpen = false;
  paused = false;
  startRun(clsKey);
}

function startRun(clsKey) {
  try {
    Particles.reset();
    G = {
      seed: Math.floor(Math.random() * 1e9),
      floor: 0,
      explored: null,
      clock: 0,
      camShake: 0,
      tileScale: 32,
      playerLight: 7,
      world: null,
      player: null,
    };
    buildHubWorld(null, clsKey);
    G.explored = new Uint8Array(G.world.w * G.world.h);
    revealAround(G.player.x, G.player.y);
    UI.updateHUD();
    AudioSystem.resume();
    UI.toast(Lang.t('Приют Пустоты'), 'dim');
    UI.toast('Собери ключи, открой выход и спускайся глубже!', 'info');
    UI.toast(Lang.t('Дверь наверху ведёт на этаж 1.'), 'info');
  } catch (err) {
    reportCrash(err, 'startRun');
  }
}

// ---------- Floor build ----------
function buildFloor(floorIndex, keepPlayer, clsKey) {
  const isBossFloor = floorIndex >= FINAL_FLOOR;
  // Merchant visit every 5th floor (incl. guardian floors, so 10/20/.../90
  // double as arena + shopping stop). F opens the shop when close enough.
  const isShop = floorIndex % 5 === 0 && !isBossFloor;
  const fd = WorldGen.makeFloorData(floorIndex, G.seed, { shop: isShop });
  const w = fd.w, h = fd.h;
  const rng = floorRng(floorIndex);

  const spawn = keepPlayer || { x: 0, y: 0 };
  if (!keepPlayer) {
    if (isShop && fd.shopRoom) {
      // Spawn inside the merchant's private room (bottom of the map).
      const sr = fd.shopRoom;
      spawn.x = sr.cx * 24 + 12;
      spawn.y = (sr.topY + (sr.rh >> 1) + 1) * 24 + 12;
    } else {
      const sp = WorldGen.spawnRoom(fd.tiles, fd.walkable, w, h, rng);
      spawn.x = sp[0] * 24 + 12;
      spawn.y = sp[1] * 24 + 12;
    }
  }

  const world = {
    w, h, tiles: fd.tiles, walkable: fd.walkable,
    enemies: [], items: [], torches: [], projectiles: [],
    exits: [],
    safeRects: fd.safeRects || [],
    furniture: [].concat(
      (fd.shopRoom && fd.shopRoom.furniture) || []
    ),
  };

  // Lore book for this floor (if any) sits on the floor waiting to be read.
  const book = Entities.bookForFloor(floorIndex);
  if (book && !isBossFloor) {
    const bSpot = randomWalkableSpawn(fd, w, h, spawn, 6, false, rng);
    world.items.push({
      key: book.key, kind: 'book', value: 0,
      titleR: book.titleR, titleEn: book.titleEn, textR: book.textR, textEn: book.textEn,
      glyph: ['📕', '📗', '📙', '📘'][Math.floor((floorIndex / 1) % 4)] || '📕',
      sprite: null, color: '#e6c458',
      x: bSpot.x, y: bSpot.y,
      glow: '#e6c458',
    });
  }

  const enemyPool = Entities.floorEnemyPool(floorIndex);
  const guardianFloor = !isBossFloor && floorIndex % 10 === 0;
  // Guardians grow their own identity: the warden (volley), the mystic (orb)
  // and the behemoth (slam) rotate every 30 floors so each arena fight reads
  // differently. The final boss stays the classic 'boss' entity.
  const guardianKey = (() => {
    const cycle = ['boss_warden', 'boss_mystic', 'boss_behemoth'];
    return cycle[Math.floor((floorIndex / 10) - 1) % cycle.length] || 'boss_warden';
  })();
  // Denser packs than the original climb so the early floors already bite; the
  // final floor hosts only the boss.
  const count = isBossFloor ? 1 : Math.min(8 + floorIndex * 2, floorIndex > 35 ? 30 : 26);

  for (let i = 0; i < count; i++) {
    const key = isBossFloor ? 'boss'
      : (guardianFloor && i === 0 ? guardianKey : rndPick(rng, enemyPool));
    const spot = randomWalkableSpawn(fd, w, h, spawn, 6, false, rng);
    world.enemies.push(makeEnemy(key, floorIndex, spot.x, spot.y));
  }

  // Items on floor (treasure) scattered.
  const itemCount = rndInt(rng, 2, 4);
  const pool = Entities.floorLootPool(floorIndex);
  for (let i = 0; i < itemCount; i++) {
    const spot = randomWalkableSpawn(fd, w, h, spawn, 3, false, rng);
    const it = makeItem(rndPick(rng, pool));
    it.x = spot.x; it.y = spot.y;
    world.items.push(it);
  }

  // Guarantee a runic key on every non-boss floor: it is required to descend
  // (checkExit) and the random loot pools don't reliably carry keys.
  if (!isBossFloor) {
    const keySpot = randomWalkableSpawn(fd, w, h, spawn, 12, true, rng);
    const keyItem = makeItem('key');
    keyItem.x = keySpot.x; keyItem.y = keySpot.y;
    world.items.push(keyItem);
  }

  // Torches for ambience.
  const torchCount = Math.min(14 + floorIndex * 2, 40);
  for (let i = 0; i < torchCount; i++) {
    const spot = randomAnyFloorSpawn(fd, w, h, rng);
    if (spot) world.torches.push({ x: spot.x, y: spot.y, r: 4.5 });
  }

  // Exit (stairs / door).
  const exitSpot = randomWalkableSpawn(fd, w, h, spawn, 8, true, rng);
  world.exits.push({ x: exitSpot.x, y: exitSpot.y, boss: isBossFloor });

  // Merchant visit every 5th floor (incl. guardian floors, so 10/20/.../90
  // double as arena + shopping stop). F opens the shop when close enough.
  if (isShop) {
    world.shop = buildShopStand(floorIndex, spawn, rng, fd);
    // Light the merchant den so his room reads as a safe haven.
    if (fd.shopRoom) {
      const sr = fd.shopRoom;
      world.torches.push({ x: (sr.cx - ((sr.rw / 2) | 0) + 2) * 24 + 12, y: (sr.topY + 2) * 24 + 12, r: 5.5 });
      world.torches.push({ x: (sr.cx + ((sr.rw / 2) | 0) - 2) * 24 + 12, y: (sr.topY + 2) * 24 + 12, r: 5.5 });
    }
  }
  G.shopGreeted = false;

  // Store.
  if (!G.player) {
    G.player = Entities.createPlayer(spawn.x, spawn.y, clsKey);
  } else if (!keepPlayer) {
    // Relocate an existing player to this floor's spawn room on a fresh build
    // (e.g. advancing floors or loading without a position), so they never end
    // up stuck inside a wall.
    G.player.x = spawn.x;
    G.player.y = spawn.y;
  } else if (keepPlayer.x || keepPlayer.y) {
    G.player.x = keepPlayer.x || G.player.x;
    G.player.y = keepPlayer.y || G.player.y;
  }
  G.world = world;
  G.floor = floorIndex;

  if (G.explored) { G.explored = new Uint8Array(w * h); revealAround(G.player.x, G.player.y); }
}

// ---------- Hub (sanctuary, floor 0) ----------
// The home base: a cozy walled room with the door at the top leading down to
// floor 1 and three class NPCs. Building it never spawns enemies or loot.
function buildHubWorld(keepPlayer, clsKey) {
  const hub = WorldGen.buildHub();
  const w = hub.w, h = hub.h;
  const spawn = keepPlayer || hub.spawn;

  const world = {
    w, h, tiles: hub.tiles, walkable: hub.walkable,
    enemies: [], items: [], torches: hub.torches, projectiles: [],
    // The only exit is the door: stepping onto it descends (no key needed),
    // checkExit short-circuits on its hub flag.
    exits: [{ x: hub.door.x, y: hub.door.y, hub: true }],
    safeRects: hub.safeRects,
    furniture: hub.furniture,
  };

  G.world = world;
  G.floor = 0;

  if (!G.player) {
    G.player = Entities.createPlayer(spawn.x, spawn.y, clsKey);
  } else {
    G.player.x = spawn.x;
    G.player.y = spawn.y;
  }
  if (G.explored) { G.explored = new Uint8Array(w * h); revealAround(G.player.x, G.player.y); }
  UI.updateHUD();
}

// ---------- Merchant stand (floors 5/10/15/.../95) ----------
// The merchant lives in his own room at the bottom of the floor, reached by a
// straight tunnel; the player spawns there too. He shuffles gently around his
// anchor point, reading the tattered ledger.
function buildShopStand(floorIndex, spawn, rng, fd) {
  const w = fd.w, h = fd.h;
  const cxs = Math.floor(spawn.x / 24), cys = Math.floor(spawn.y / 24);
  // Search area is clamped to the merchant room when one exists, so he never
  // wanders into the tunnel or the cave proper.
  let xMin = Math.max(1, cxs - 6), xMax = Math.min(w - 2, cxs + 6);
  let yMin = Math.max(1, cys - 6), yMax = Math.min(h - 2, cys + 6);
  if (fd.shopRoom) {
    const sr = fd.shopRoom, hw = (sr.rw / 2) | 0;
    xMin = Math.max(xMin, sr.cx - hw + 1);
    xMax = Math.min(xMax, sr.cx + hw - 1);
    yMin = Math.max(yMin, sr.topY + 1);
  }
  const cells = [];
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      if (fd.tiles[y * w + x] !== Tile.FLOOR) continue;
      const md = Math.abs(x - cxs) + Math.abs(y - cys);
      if (md < 3) continue; // keep a respectful distance from the spawn tile
      cells.push([x, y]);
    }
  }
  const spot = cells.length ? cells[Math.floor(rng() * cells.length)] : [Math.min(xMax, cxs + 4), Math.min(yMax, cys + 2)];
  const merchant = {
    key: 'merchant', name: 'Торговец', isMerchant: true, radius: 16, facing: 1,
    x: spot[0] * 24 + 12, y: spot[1] * 24 + 12,
    anchorX: spot[0] * 24 + 12, anchorY: spot[1] * 24 + 12,
    walkT: 1,
    bodyColor: '#7ac95c', glowColor: '#e6c458', glyph: '🧙',
  };

  // Deterministic stock from the shop tier derived from the floor number.
  const tier = Entities.shopTier(floorIndex);
  const stockKeys = [
    rndPick(rng, tier.weapons),
    rndPick(rng, tier.armors),
    rndPick(rng, tier.potions),
    rndPick(rng, [...tier.weapons, ...tier.armors, ...tier.potions]),
  ];
  const stock = stockKeys.map((k) => {
    const it = makeItem(k);
    it.price = Entities.shopPrice(k, floorIndex);
    return it;
  });
  // Second-life amulet for sale — a one-shot safety net held for the death
  // screen. Expensive enough to be a real choice, cheap enough to matter.
  stock.push({
    key: 'revive', kind: 'revive', name: 'Амулет второй жизни',
    glyph: '⚕️', glow: '#5ce1e6', sold: false,
    price: Math.round(220 + floorIndex * 24),
  });
  const line = MERCHANT_LINES[Math.floor(rng() * MERCHANT_LINES.length)] || MERCHANT_LINES[0];
  // Permanent mercantile upgrades — a home-brewed ledger of "old favours".
  const upgrades = [
    { key: 'hp',   name: 'Амулет здоровья', glyph: '❤️', desc: '+12 к макс. жизни навсегда', price: Math.round(90 + floorIndex * 9) },
    { key: 'atk',  name: 'Точильный камень', glyph: '⚔️', desc: '+1 к базовому урону навсегда', price: Math.round(140 + floorIndex * 16) },
    { key: 'mp',   name: 'Янтарный кристалл', glyph: '💧', desc: '+10 к мане навсегда', price: Math.round(110 + floorIndex * 12) },
    { key: 'gold', name: 'Золотой ключик', glyph: '💰', desc: '+8% к подбираемому золоту', price: Math.round(200 + floorIndex * 20) },
  ];
  return { merchant, stock, upgrades, line };
}

function tileAtWorld(x, y) {
  const cx = Math.floor(x / 24), cy = Math.floor(y / 24);
  if (!G.world || cx < 0 || cy < 0 || cx >= G.world.w || cy >= G.world.h) return Tile.WALL;
  return G.world.tiles[cy * G.world.w + cx];
}

// Safety net for loads: a saved position can land inside a wall when the map
// layout for the same seed changed between versions (e.g. the old floor-1
// start hall is gone). Relocate to a guaranteed walkable spawn room instead of
// leaving the hero embedded in rock (immovable — reads as a frozen game).
function snapPlayerToWalkable() {
  const p = G.player, w = G.world;
  if (!p || !w) return;
  const solid = tileAtWorld(p.x, p.y) === Tile.WALL;
  if (!solid) return;
  const rng = Util.mulberry32((((G.seed >>> 0) ^ (G.floor * 99991)) >>> 0) || 1);
  const sp = WorldGen.spawnRoom(w.tiles, w.walkable, w.w, w.h, rng);
  p.x = sp[0] * 24 + 12;
  p.y = sp[1] * 24 + 12;
  if (G.explored) revealAround(p.x, p.y);
  UI.toast('Сохранение перенесено в безопасное место', 'info');
}

// Buy / sell with the shopkeeper (gold sink so the currency matters).
function openShopCheck() {
  const p = G.player;
  const shop = G.world && G.world.shop;
  if (!shop) return;
  const m = shop.merchant;
  if (Util.dist(p.x, p.y, m.x, m.y) < 80) {
    if (!G.shopGreeted && shop.line) { G.shopGreeted = true; UI.toast('🧙 ' + shop.line, 'gold'); }
    UI.openShop();
  } else {
    UI.toast('Подойди ближе к торговцу', 'dim');
  }
}

// F dispatch: the merchant in his den outranks hub furniture, otherwise the
// nearest interactable (class NPC, lore keeper, totem, board, hub door).
function interactWithWorld() {
  const p = G.player;
  const shop = G.world && G.world.shop;
  if (shop && shop.merchant && Util.dist(p.x, p.y, shop.merchant.x, shop.merchant.y) < 80) {
    openShopCheck();
    return;
  }
  let best = null, bestD = 88;
  for (const f of G.world.furniture || []) {
    const d = Util.dist(p.x, p.y, f.x, f.y);
    if (d < bestD) { best = f; bestD = d; }
  }
  if (!best) { UI.toast('Рядом ничего интересного', 'dim'); return; }
  if (best.kind === 'npc' && best.role === 'class') {
    Game.setClass(best.cls);
  } else if (best.kind === 'npc' && best.role === 'lore') {
    const story = Lang.story(G.floor, LORE[G.floor] || 'Глубины молчат…');
    UI.toast(story, 'story');
  } else if (best.kind === 'totem') {
    UI.openDifficulty();
  } else if (best.kind === 'board') {
    UI.openBlackboard();
  } else if (best.kind === 'door') {
    advanceFloor();
  } else {
    UI.toast('Рядом ничего интересного', 'dim');
  }
}

// Class/difficulty setters (hub NPCs + totem).
function setClass(clsKey) {
  const p = G.player;
  if (p && Entities.CLASSES[clsKey]) p.cls = clsKey;
  UI.updateHUD();
  UI.toast('Класс: ' + Lang.t(Entities.CLASSES[clsKey].name), 'loot');
  UI.toast(Lang.t('Помни свои пассивки — они решают исход боя.'), 'info');
}
function setDifficulty(d) {
  const p = G.player;
  if (p && Entities.DIFFICULTY[d]) p.difficulty = d;
  UI.updateHUD();
  UI.toast('Сложность: ' + (d === 'easy' ? 'Лёгкая' : d === 'hard' ? 'Сложная' : 'Обычная'), 'info');
}

// The merchant shuffles around his den (a gentle lopsided stroll around the
// anchor), so the room feels alive without ever walking into the tunnel.
function updateMerchant(dt) {
  const shop = G.world && G.world.shop;
  if (!shop || !shop.merchant) return;
  const m = shop.merchant;
  if (m.anchorX === undefined) return;
  m.walkT = 1;
  m.x = m.anchorX + Math.sin(G.clock * 1.2) * 7;
  m.y = m.anchorY + Math.cos(G.clock * 0.8 + 1.3) * 5;
  m.facing = Math.sin(G.clock * 1.2 + 0.6) > 0 ? 1 : -1;
}

function buyItem(idx) {
  const p = G.player;
  const shop = G.world && G.world.shop;
  if (!shop || !shop.stock[idx]) return;
  const it = shop.stock[idx];
  if (it.sold) { UI.toast('Уже продано', 'dim'); return; }
  if (p.gold < it.price) { AudioSystem.sfx.error(); UI.toast('Не хватает золота!', 'warn'); return; }
  // Potions and key cards don't take bag space — they land directly in the
  // Q/E drinking sliders (or the key counter), so buying them is always safe.
  if (it.kind === 'potion') {
    p.gold -= it.price;
    p.potions[it.key] = (p.potions[it.key] || 0) + 1;
    it.sold = true;
    AudioSystem.sfx.gold();
    UI.toast('Куплено: ' + it.name + ' (+1 к слоту ' + (it.key === 'potion_big' ? 'E' : 'Q') + ')', 'gold');
    UI.updateHUD();
    return;
  }
  if (it.kind === 'key') {
    p.gold -= it.price;
    p.keys++;
    it.sold = true;
    AudioSystem.sfx.gold();
    UI.toast('Куплен рунический ключ!', 'gold');
    return;
  }
  // Second-life amulet: one charge, held until the death screen.
  if (it.kind === 'revive') {
    p.gold -= it.price;
    p.revives = (p.revives || 0) + 1;
    it.sold = true;
    AudioSystem.sfx.gold();
    UI.toast('Куплен амулет второй жизни!', 'gold');
    return;
  }
  if (p.inventory.length >= p.inventoryCap) { AudioSystem.sfx.error(); UI.toast('Сумка полна!', 'warn'); return; }
  p.gold -= it.price;
  const bought = { ...it };
  delete bought.price; delete bought.sold;
  p.inventory.push(bought);
  it.sold = true;
  AudioSystem.sfx.gold();
  UI.toast('Куплено: ' + it.name, 'gold');
  UI.updateHUD();
}

// Permanent upgrades from the merchant's ledger (a gold sink that deepens with
// depth, keeping coin meaningful late game).
function buyUpgrade(idx) {
  const p = G.player;
  const shop = G.world && G.world.shop;
  if (!shop || !shop.upgrades[idx]) return;
  const u = shop.upgrades[idx];
  if (u.bought) { UI.toast('Уже куплено', 'dim'); return; }
  if (p.gold < u.price) { AudioSystem.sfx.error(); UI.toast('Не хватает золота!', 'warn'); return; }
  p.gold -= u.price;
  u.bought = true;
  switch (u.key) {
    case 'hp': p.maxHp += 12; p.hp += 12; break;
    case 'atk': p.baseAtk += 1; break;
    case 'mp': p.maxMp += 10; p.mp += 10; break;
    case 'gold': p.goldMult = (p.goldMult || 1) + 0.08; break;
  }
  AudioSystem.sfx.gold();
  Particles.magicSparks(p.x, p.y, '#ffd76a');
  UI.toast('💰 ' + u.name + ': ' + u.desc, 'gold');
  UI.updateHUD();
}

// Build a scaled enemy of the given def key. `type` is the combat type from the
// def (melee/ranged/boss/ghost); `key` keeps the table key for save/color.
// `boss` on a guardian floor (10/20/.../90) becomes a weaker elite guardian;
// `boss` on the final floor is the true final boss (triggers victory).
function makeEnemy(key, floorIndex, x, y, hp) {
  const def = Entities.ENEMIES[key];
  if (!def) return null;
  const isBossVariant = key === 'boss_warden' || key === 'boss_mystic' || key === 'boss_behemoth';
  const isFinal = key === 'boss' && floorIndex >= FINAL_FLOOR;
  const isGuardian = isBossVariant || (key === 'boss' && !isFinal && floorIndex % 10 === 0);
  const scaled = Entities.scaleEnemy(def, isFinal ? floorIndex + 1 : floorIndex);
  // Difficulty presets scale enemy HP and damage on top of depth scaling.
  const diff = Entities.DIFFICULTY[(G.player && G.player.difficulty) || 'normal'] || Entities.DIFFICULTY.normal;
  scaled.hp = Math.max(1, Math.round(scaled.hp * diff.enmHp));
  scaled.atk = Math.max(1, Math.round(scaled.atk * diff.enmDmg));
  // Deterministic per-enemy RNG stream (seeded from run seed + floor + spot),
  // so wandering/tendency never depends on global Math.random.
  const rng = Util.mulberry32(((((G.seed >>> 0) ^ (floorIndex * 99991) ^
                                 ((Math.round(x) + Math.round(y) * 131) >>> 0)) >>> 0) || 1));
  const e = {
    ...scaled,
    key, x, y,
    type: def.type,
    isBoss: isFinal || isGuardian,
    isGuardian,
    isFinal,
    bodyColor: def.color,
    glowColor: def.color,
    glyph: def.glyph,
    special: def.special || null,
    maxHp: scaled.hp,
    dirx: 0, diry: 0,
    attacking: null,
    attackCd: 0,
    aggroRange: def.aggro,
    alert: false,
    hitFlash: 0,
    stroll: { dirx: 1, diry: 0, t: 0, timer: 0 },
    walkT: 0,
    facing: 1,
    phase: ((key.charCodeAt(0) || 0) * 13 + floorIndex * 7) % 7,
    rng,
  };
  if (isGuardian) {
    e.maxHp = Math.max(1, Math.round(e.maxHp * 0.6));
    e.atk = Math.max(1, Math.round(e.atk * 0.85));
  }
  // Restore a saved HP after scaling/penalty so load keeps the live value.
  e.hp = (typeof hp === 'number' && hp >= 0) ? hp : e.maxHp;
  return e;
}

// Rooms that are off-limits for random placement (enemies/keys/exits/torches):
// the merchant's den is a safe zone.
function spotInSafeRooms(fd, sx, sy) {
  const margin = 2 * 24;
  for (const room of [fd.shopRoom]) {
    if (!room) continue;
    const x0 = (room.cx - Math.floor(room.rw / 2)) * 24;
    const x1 = (room.cx + Math.ceil(room.rw / 2)) * 24;
    const y0 = room.topY * 24;
    const y1 = (room.topY + room.rh) * 24;
    if (sx > x0 - margin && sx < x1 + margin && sy > y0 - margin && sy < y1 + margin) return true;
  }
  return false;
}

function randomWalkableSpawn(fd, w, h, avoid, minDist, far, rng) {
  for (let tries = 0; tries < 400; tries++) {
    const spot = WorldGen.randomFloorSpot(fd.tiles, w, h, rng, 2);
    const sx = spot[0] * 24 + 12, sy = spot[1] * 24 + 12;
    if (spotInSafeRooms(fd, sx, sy)) continue;
    const d = Util.dist(sx, sy, avoid.x, avoid.y);
    if (far ? d > minDist * 24 : d > minDist) {
      return { x: sx, y: sy };
    }
  }
  const fallback = WorldGen.spawnRoom(fd.tiles, fd.walkable, w, h, rng);
  return { x: fallback[0] * 24 + 12, y: fallback[1] * 24 + 12 };
}

function randomAnyFloorSpawn(fd, w, h, rng) {
  const cells = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (fd.tiles[y * w + x] !== Tile.FLOOR) continue;
    const sx = x * 24 + 12, sy = y * 24 + 12;
    if (!spotInSafeRooms(fd, sx, sy)) cells.push([x, y]);
  }
  if (!cells.length) return null;
  const c = cells[Math.floor(rng() * cells.length)];
  return { x: c[0] * 24 + 12, y: c[1] * 24 + 12 };
}

function makeItem(key) {
  const d = Entities.ITEMS[key];
  if (!d) return null;
  return {
    key,
    name: d.name, kind: d.kind, glyph: d.glyph,
    sprite: d.sprite || null, color: d.color || null,
    min: d.min, max: d.max, def: d.def, hpBonus: d.hpBonus, mpBonus: d.mpBonus,
    heal: d.heal, value: d.value,
    glow: d.kind === 'weapon' ? '#7c5cff' : d.kind === 'armor' ? '#5ce1e6' : d.kind === 'potion' ? '#44e08a' : '#e6c458',
  };
}

// ---------- Save / load / respawn ----------
function saveGame() {
  if (!G) return false;
  return Save.store(G);
}
function loadGame() {
  const data = Save.load();
  if (!data) { UI.openMenu(); return; }
  Particles.reset();
  const p = data.player;
  const player = Entities.createPlayer(p.x, p.y, p.cls || 'void');
  Object.assign(player, {
    hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
    level: p.level, xp: p.xp, xpNext: p.xpNext,
    gold: p.gold, keys: p.keys, kills: p.kills,
    baseAtk: p.baseAtk, goldMult: p.goldMult || 1,
    revives: p.revives || 0,
    weapon: p.weapon, armor: p.armor,
    inventory: p.inventory || [],
    potions: p.potions || { potion: 0, potion_big: 0 },
    unlocked: p.unlocked || { whirl: false, fireball: false, dash: false, heal: false },
    difficulty: p.difficulty || 'normal',
    books: p.books || [],
  });
  G = {
    seed: data.seed,
    floor: data.floor,
    explored: null,
    clock: 0, camShake: 0, tileScale: 32, playerLight: 7,
    world: null, player,
  };
  unlockByLevel(player);
  // Rebuild the floor from the saved seed so the layout is identical. The hub
  // is floor 0 with its own static build (no seed-derived cave layout).
  if (data.floor === 0) {
    buildHubWorld({ x: p.x, y: p.y });
  } else {
    buildFloor(data.floor, { x: p.x, y: p.y });
  }
  G.explored = deserializeExplored(data.extra);
  if (!G.explored) { G.explored = new Uint8Array(G.world.w * G.world.h); revealAround(p.x, p.y); }
  restoreWorldState(data.extra);
  // Guard against a saved position that no longer maps to open floor (old
  // saves from before the hub rework can drop the hero inside solid rock).
  snapPlayerToWalkable();
  UI.hidePanel();
  state = 'playing';
  overlayOpen = false;
  paused = false;
  UI.updateHUD();
  UI.toast('Сохранение загружено', 'loot');
}

// Re-apply the saved dynamic world (enemies/hp, items, torches, explored) on
// top of the deterministically regenerated floor.
function restoreWorldState(extra) {
  const w = G.world;
  if (extra) {
    if (Array.isArray(extra.enemies)) {
      w.enemies = extra.enemies
        .map(([x, y, hp, key]) => makeEnemy(key, G.floor, x, y, hp))
        .filter(Boolean);
    }
    if (Array.isArray(extra.items)) {
      w.items = extra.items.map((rec) => {
        const [key, x, y, value] = rec;
        let it;
        if (key === 'gold') {
          it = { key, name: 'Золото', kind: 'gold', glyph: '💰', value: value || 0, glow: '#e6c458' };
        } else {
          it = makeItem(key);
          if (!it) return null;
        }
        it.x = x; it.y = y;
        return it;
      }).filter(Boolean);
    }
    if (Array.isArray(extra.torches)) {
      w.torches = extra.torches.map(([x, y, r]) => ({ x, y, r }));
    }
    if (Array.isArray(extra.shopSold) && w.shop) {
      w.shop.stock.forEach((s, i) => {
        if (extra.shopSold[i]) s.sold = true;
      });
    }
  }
}

function deserializeExplored(extra) {
  if (extra && Array.isArray(extra.explored) && extra.explored.length === G.world.w * G.world.h) {
    return Uint8Array.from(extra.explored);
  }
  return null;
}

// Second life: costs one revive charge, resurrects the hero ON THE SPOT at
// full health with a brief phase of invulnerability. There is no always-free
// floor respawn anymore — the charges come from the merchant's amulet and
// milestone levels.
function revive() {
  const p = G.player;
  if ((p.revives || 0) <= 0) return;
  p.revives--;
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  p.dead = false;
  p.dying = false;
  p.attacking = null;
  p.dashing = null;
  p.combo = 0; p.comboT = 0;
  p.invuln = 1.5;
  UI.hidePanel();
  state = 'playing';
  overlayOpen = false;
  paused = false;
  Particles.doubleRing(p.x, p.y, '#5ce1e6', 30);
  Particles.magicSparks(p.x, p.y, '#5ce1e6');
  AudioSystem.sfx.heal();
  UI.updateHUD();
  UI.toast('Вторая жизнь! Ты вернулся к бою.', 'gold');
}

// ---------- Abilities unlock by level ----------
function unlockByLevel(player) {
  if (player.level >= 3) player.unlocked.whirl = true;
  if (player.level >= 5) player.unlocked.fireball = true;
  if (player.level >= 4) player.unlocked.dash = true;
  if (player.level >= 6) player.unlocked.heal = true;
}

// ---------- Main loop ----------
let visClock = 0;   // monotonic clock for visuals (advances even when paused)
let prevNow = 0;
let lastHud = 0;

function frame(now) {
  if (!running) return;
  if (last === 0) { last = now; prevNow = now; rafId = requestAnimationFrame(frame); return; }
  try {
    const rawDt = now - last;
    acc = Math.min(acc + rawDt, 250);
    last = now;
    if (!paused && !overlayOpen && state === 'playing') {
      while (acc >= STEP) {
        update(STEP / 1000);
        acc -= STEP;
      }
    } else {
      acc = 0; // freeze simulation while paused/menu/dead/inventory
    }
    visClock += (now - prevNow) / 1000;
    prevNow = now;
    if (G) G.clock = visClock;
    Render.render();
    // HUD is throttled; event-driven paths (damage, pickups) call it directly.
    if (now - lastHud > 100) { lastHud = now; UI.updateHUD(); }
    handleUIControls();
  } catch (err) {
    reportCrash(err, 'frame');
  }
  Input.endFrame();
  rafId = requestAnimationFrame(frame);
}

function update(dt) {
  const p = G && G.player;
  if (!p || !G || !G.world) {
    console.warn('update() skipped: world/player not ready');
    return;
  }
  // The hub (floor 0) and the tutorial floor 1 share the calm soundtrack
  // (unless a boss is up).
  if (AudioSystem.setHubMode) {
    const inBoss = (G.world.enemies || []).some((e) => e.isGuardian || e.isFinal);
    AudioSystem.setHubMode((G.floor === 0 || G.floor === 1) && !inBoss);
  }
  // Timers expire globally (ability cooldowns, etc.)
  for (const k in p.abilityCd) p.abilityCd[k] = Math.max(0, p.abilityCd[k] - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  p.moveSlow = Math.max(0, p.moveSlow - dt);
  if (p.dying) { G.camShake = Math.max(0, G.camShake - dt * 8); Particles.update(dt); return; }

  // Mana regen (class multiplier: mages regenerate faster).
  p.manaRegenTimer -= dt;
  if (p.manaRegenTimer <= 0) {
    const s = Entities.equipmentStats(p);
    const regenRate = (2 + (p.manaRegenTimerBonus || 0)) * 0.3 * Entities.manaRegen(p);
    p.mp = Math.min(p.maxMp + s.mpBonus, p.mp + regenRate);
    p.manaRegenTimer = 0.5;
  }

  // Camera shake decay.
  G.camShake = Math.max(0, G.camShake - dt * 20);
  if (G.exitHintCd > 0) G.exitHintCd -= dt;
  if (G.bagHintCd > 0) G.bagHintCd -= dt;
  if (G.dmgFlash > 0) G.dmgFlash = Math.max(0, G.dmgFlash - dt * 1.8);

  // --- Player action ---
  updatePlayer(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updateItems(dt);
  updateMerchant(dt);
  checkExit();
  Particles.update(dt);
  revealAround(p.x, p.y);
}

// ---------- Player ----------
// Nearest enemy within `maxDist` px of (x, y) — used for keyboard-only aiming.
function nearestEnemy(x, y, maxDist) {
  let best = null, bestD = maxDist;
  for (const e of G.world.enemies) {
    if (e.dying) continue;
    const d = Util.dist(x, y, e.x, e.y);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// Aim an enemy projectile at the player plus a small lead on their movement,
// so shots connect instead of scattering to where the player used to be.
function enemyLeadAngle(e, target) {
  const dist = Util.dist(e.x, e.y, target.x, target.y);
  const projSpeed = 5 * Entities.SPEED_SCALE;
  const mv = Input.moveVector();
  const mvl = Math.hypot(mv.x, mv.y);
  let tx = target.x, ty = target.y;
  if (mvl > 0 && projSpeed > 0) {
    const slow = Input.isDown('shift') ? 0.4 : 1;
    const lead = Math.min(64, (dist / projSpeed) * (4.5 * Entities.SPEED_SCALE) * slow * 0.9);
    tx += (mv.x / mvl) * lead;
    ty += (mv.y / mvl) * lead;
  }
  return Math.atan2(ty - e.y, tx - e.x);
}

function updatePlayer(dt) {
  const p = G.player;
  const s = Entities.equipmentStats(p);
  const speedBase = (5.6 * Entities.SPEED_SCALE) * (1 + (p.speedBonus || 0)) * Entities.speedMult(p);

  // Aim toward the mouse when not blocked by overlay; with no mouse input aim
  // at the nearest enemy so abilities never fire at nothing (off-map).
  let aimX = 0, aimY = 0;
  if (!overlayOpen) {
    const rect = canvas.getBoundingClientRect();
    const mx = Input.mouseX - rect.width / 2;
    const my = Input.mouseY - rect.height / 2;
    const len = Math.hypot(mx, my);
    if (len > 8) {
      aimX = mx / len; aimY = my / len; p.attackDir = Math.atan2(aimY, aimX);
    } else {
      const target = nearestEnemy(p.x, p.y, 460);
      if (target) {
        p.attackDir = Math.atan2(target.y - p.y, target.x - p.x);
        aimX = Math.cos(p.attackDir); aimY = Math.sin(p.attackDir);
      }
    }
  }

  // Movement (not while attacking/dashing).
  const mv = Input.moveVector();
  p.walkT = Math.max(0, (p.walkT || 0) - dt * 4);
  if (p.curseT > 0) p.curseT = Math.max(0, p.curseT - dt);
  // Combo streak decays fast — keep hitting to keep the bonus alive.
  if (p.comboT > 0) {
    p.comboT -= dt;
    if (p.comboT <= 0) { p.combo = 0; UI.updateHUD(); }
  }
  if (!p.dashing) {
    let speed = speedBase;
    if (Input.isDown('shift')) speed *= 0.4; // blocking slows
    if (p.moveSlow > 0) speed *= 0.5;
    if (mv.x !== 0 || mv.y !== 0) {
      const len = Math.hypot(mv.x, mv.y);
      const nx = mv.x / len, ny = mv.y / len;
      tryMove(p, nx * speed * dt, ny * speed * dt);
      p.facing = nx !== 0 ? (nx > 0 ? 1 : -1) : p.facing;
      p.walkT = Math.min(1, p.walkT + dt * 3);
      p.animT += dt;
      if (p.animT > 0.25) { p.animT = 0; AudioSystem.sfx.step(); }
    }
  } else {
    p.walkT = 1;
  }

  // Abilities (hold LMB now auto-attacks while the strike is off cooldown).
  if (!overlayOpen && !p.dying) {
    if (Input.wasPressed('1')) useAbility('strike', aimX, aimY);
    if (Input.wasPressed('2') && p.unlocked.whirl) useAbility('whirl', aimX, aimY);
    if (Input.wasPressed('3') && p.unlocked.fireball) useAbility('fireball', aimX, aimY);
    if (Input.wasPressed('4') && p.unlocked.heal) useAbility('heal', aimX, aimY);
    if (Input.wasPressed('ctrl') && p.unlocked.dash) useAbility('dash', aimX, aimY);
    if (Input.wasPressed('q')) drinkPotion('potion');
    if (Input.wasPressed('e')) drinkPotion('potion_big');
    if (Input.mouseDown && aimX !== 0 && !p.attacking && p.abilityCd.strike <= 0) {
      // Default basic attack toward the mouse (repeat while held).
      useAbility('strike', aimX, aimY);
    }
  }

  // Resolve active attacks (windup/active/recover).
  if (p.attacking) {
    const a = p.attacking;
    a.t += dt;
    // Active window triggers damage once.
    if (a.kind === 'melee' && !a.done && a.t >= a.windup && a.t <= a.windup + a.active) {
      a.done = true;
      applyMeleeDamage(a);
    }
    if (a.kind === 'aoe' && !a.done && a.t >= a.windup) {
      a.done = true;
      applyAoEDamage(a);
    }
    if (a.t >= a.windup + a.active + a.recover) {
      p.attacking = null;
    }
  }

  // Dash resolution.
  if (p.dashing) {
    const d = p.dashing;
    d.dist += d.speed * dt;
    const move = d.speed * dt;
    const beforeX = p.x, beforeY = p.y;
    if (!trySlide(p, d.dirx * move, d.diry * move)) {
      // Hit a wall: end dash with a small screen shake.
      G.camShake = Math.max(G.camShake, 4);
      p.dashing = null;
    } else {
      const dx = p.x - beforeX, dy = p.y - beforeY;
      // Damage enemies passed through.
      for (const e of G.world.enemies) {
        if (Util.dist(p.x, p.y, e.x, e.y) < p.radius + e.radius + 6) {
          if (!d.hitSet.has(e)) { d.hitSet.add(e); damageEnemy(e, d.dmg, 0, p); Particles.impact(e.x, e.y, d.dirx, d.diry, '#ffd76a'); Particles.dust(e.x, e.y); }
        }
      }
    }
    if (d.dist >= d.range) p.dashing = null;
    if (p.dashing) Particles.dustTrail(p.x, p.y, d.dirx, d.diry, '#9adcff');
  }

  // Hazards: water slows, lava burns. (Enemies chase at full speed.)
  const tile = tileAtWorld(p.x, p.y);
  if (tile === Tile.WATER) {
    p.moveSlow = Math.max(p.moveSlow, 0.6);
  } else if (tile === Tile.LAVA) {
    if (p.lavaT > 0) p.lavaT -= dt;
    if (p.lavaT <= 0) {
      p.lavaT = 0.55;
      damagePlayer(Math.max(4, Math.round(p.maxHp * 0.05 + 2)), null);
      Particles.burst(p.x, p.y, '#ff7a3c', 8, 60, 2, 0.4);
      Particles.ring(p.x, p.y, '#ff5722', 12);
    }
  } else {
    p.lavaT = 0;
  }

  // Interact with the world around (F): merchant, hub NPCs, totem, board.
  if (Input.wasPressed('f')) interactWithWorld();

  // HP clamp.
  p.hp = Math.min(p.maxHp + s.hpBonus, p.hp);
  p.mp = Math.min(p.maxMp + s.mpBonus, p.mp);

  // Death.
  if (p.hp <= 0 && !p.dead) {
    p.hp = 0; p.dead = true; p.dying = true;
    state = 'dead';
    AudioSystem.sfx.death();
    Particles.blood(p.x, p.y);
    Particles.ring(p.x, p.y, '#ff3b5c', 30);
    UI.updateHUD();
    setTimeout(() => { if (state === 'dead') UI.openDeath(); }, 900);
  }
}

function tryMove(obj, dx, dy) {
  // Axis-separated AABB-ish circle-tile collision via walkability.
  let nx = obj.x + dx, ny = obj.y + dy;
  const r = obj.radius;
  // Check cells around for solid tiles; if would enter solid tile, block.
  const blockX = wouldCollide(nx, obj.y, r);
  const blockY = wouldCollide(obj.x, ny, r);
  if (!blockX) obj.x += dx;
  else G.camShake = Math.max(G.camShake, 0.5);
  if (!blockY) obj.y += dy;
  else G.camShake = Math.max(G.camShake, 0.5);
}

function trySlide(obj, dx, dy) {
  // Axis-separated slide (like tryMove) so a blocked axis never lets the other
  // axis push the object through a wall.
  const r = obj.radius;
  let moved = false;
  if (!wouldCollide(obj.x + dx, obj.y, r)) { obj.x += dx; moved = true; }
  if (!wouldCollide(obj.x, obj.y + dy, r)) { obj.y += dy; moved = true; }
  return moved;
}

function wouldCollide(x, y, r) {
  // Cap the collision radius so even big bodies (visual radius 14–16) squeeze
  // through 1-tile (24px) passages; the cap lives here so ALL bodies share it.
  r = Math.min(r, 10);
  const w = G.world.w, h = G.world.h;
  const cx = Math.floor(x / 24), cy = Math.floor(y / 24);
  const cs = Math.ceil(r / 24) + 1;
  for (let dy = -cs; dy <= cs; dy++) {
    for (let dx = -cs; dx <= cs; dx++) {
      const ny = cy + dy, nx2 = cx + dx;
      if (nx2 < 0 || ny < 0 || nx2 >= w || ny >= h) return true;
      if (!G.world.walkable[ny * w + nx2]) {
        // Check circle-rect overlap with tile.
        const tx = nx2 * 24, ty = ny * 24;
        const closestX = Util.clamp(x, tx, tx + 24);
        const closestY = Util.clamp(y, ty, ty + 24);
        const dd = (x - closestX) ** 2 + (y - closestY) ** 2;
        if (dd < r * r) return true;
      }
    }
  }
  return false;
}

// ---------- Abilities ----------
function useAbility(key, aimX, aimY) {
  const p = G.player;
  const def = Entities.ABILITIES[key];
  if (p.abilityCd[key] > 0) { AudioSystem.sfx.error(); return; }
  if (def.mp > p.mp) { AudioSystem.sfx.error(); UI.toast('Недостаточно маны', 'warn'); return; }
  // Class passive hooks: 'echo' shortens cooldowns, 'sorcery' makes fireball
  // hit harder but at extra mana cost.
  const cdScale = Entities.cdMult(p, key);
  const sorcery = ((Entities.passiveOf(p) || {}).kind) === 'sorcery';
  const mpCost = (key === 'fireball' && sorcery) ? Math.max(1, Math.round(def.mp * 0.8)) : def.mp;
  if (mpCost > p.mp) { AudioSystem.sfx.error(); UI.toast('Недостаточно маны', 'warn'); return; }
  p.mp -= mpCost;
  p.abilityCd[key] = def.cd * cdScale;

  switch (key) {
    case 'strike': {
      if (!aimX && !aimY) { aimX = Math.cos(p.attackDir); aimY = Math.sin(p.attackDir); }
      startMelee(p, aimX, aimY, def.range, def.dmg, 'strike');
      break;
    }
    case 'whirl': {
      AudioSystem.sfx.whoosh();
      Particles.ring(p.x, p.y, '#7c5cff', p.radius);
      startAoE(p, def.range, def.dmg);
      break;
    }
    case 'fireball': {
      if (!aimX && !aimY) { aimX = Math.cos(p.attackDir); aimY = Math.sin(p.attackDir); }
      AudioSystem.sfx.fireball();
      G.world.projectiles.push({
        x: p.x, y: p.y, vx: aimX * def.projSpeed, vy: aimY * def.projSpeed,
        damage: Math.round(Entities.playerDamageRoll(p, 'magic') * def.dmg * (sorcery ? 1.25 : 1)),
        r: 8, friendly: true,
        color: '#ff7a3c', kind: 'fireball', t: 0,
      });
      Particles.magicSparks(p.x, p.y, '#ff7a3c');
      break;
    }
    case 'dash': {
      let dx = aimX || Math.cos(p.attackDir), dy = aimY || Math.sin(p.attackDir);
      if (!dx && !dy) { dx = p.facing; dy = 0; }
      const len = Math.hypot(dx, dy) || 1;
      AudioSystem.sfx.dash();
      Particles.dustTrail(p.x, p.y, dx / len, dy / len, '#9adcff');
      p.dashing = {
        dirx: dx / len, diry: dy / len, dist: 0, speed: 10 * Entities.SPEED_SCALE,
        range: def.range, dmg: Entities.playerDamageRoll(p, 'melee') * def.dmg,
        hitSet: new Set(),
      };
      break;
    }
    case 'heal': {
      const s = Entities.equipmentStats(p);
      AudioSystem.sfx.heal();
      const healAmt = Math.round((p.maxHp + s.hpBonus) * 0.4 + 30);
      const actual = Math.min(healAmt, (p.maxHp + s.hpBonus) - p.hp);
      p.hp = Math.min(p.maxHp + s.hpBonus, p.hp + healAmt);
      Particles.magicSparks(p.x, p.y, '#44e08a');
      Particles.ring(p.x, p.y, '#44e08a', 20);
      addFloatNum(p.x, p.y - 20, '+' + actual, 'heal');
      break;
    }
  }
}

function startMelee(owner, dirx, diry, range, dmgMult, key) {
  const len = Math.hypot(dirx, diry) || 1;
  owner.attackDir = Math.atan2(diry, dirx);
  owner.attacking = {
    kind: 'melee', dirx: dirx / len, diry: diry / len,
    range, dmg: dmgMult, key,
    windup: 0.08, active: 0.12, recover: 0.2, t: 0, done: false,
  };
  owner.facing = dirx >= 0 ? 1 : -1;
  Particles.slash(owner.x + dirx * owner.radius, owner.y + diry * owner.radius,
                  Math.atan2(diry, dirx), '#ffffff', 26, 0.5);
  Particles.dust(owner.x + dirx * owner.radius, owner.y + diry * owner.radius);
  AudioSystem.sfx.whoosh();
}

function startAoE(owner, range, dmgMult) {
  owner.attacking = { kind: 'aoe', dirx: 0, diry: 0, range, dmg: dmgMult,
                      windup: 0.05, active: 0.1, recover: 0.3, t: 0, done: false };
}

function applyMeleeDamage(a) {
  const p = G.player;
  const dmg = Entities.playerDamageRoll(p, 'melee') * a.dmg;
  const enemy = damageEnemyAt(p.x + a.dirx * a.range * 0.6, p.y + a.diry * a.range * 0.6, a.range, dmg, p);
  Particles.impact(enemy ? enemy.x : p.x + a.dirx * a.range, enemy ? enemy.y : p.y + a.diry * a.range,
                   a.dirx, a.diry, '#ffd76a');
  // strike also adds forward push.
  if (enemy && a.key === 'strike') {
    pushEnemy(enemy, a.dirx * 40, a.diry * 40);
  }
}

function applyAoEDamage(a) {
  const p = G.player;
  const dmg = Entities.playerDamageRoll(p, 'melee') * a.dmg;
  for (const e of [...G.world.enemies]) {
    if (Util.dist(p.x, p.y, e.x, e.y) <= a.range + e.radius) {
      const dealt = damageEnemy(e, dmg, 0, p);
      if (dealt > 0) pushEnemy(e, (e.x - p.x), (e.y - p.y));
    }
  }
}

// Find enemy within range of a point and damage it; returns enemy or null.
function damageEnemyAt(px, py, range, dmg, source) {
  let best = null, bestD = range;
  for (const e of G.world.enemies) {
    const d = Util.dist(px, py, e.x, e.y);
    if (d <= range + e.radius && d < bestD) { best = e; bestD = d; }
  }
  if (best) {
    damageEnemy(best, dmg, 0, source);
    return best;
  }
  return null;
}

function pushEnemy(e, dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len * 20, ny = dy / len * 20;
  tryMove(e, nx, ny);
}

function damageEnemy(e, dmg, defenseMult, source) {
  const p = G.player;
  // Combo streak: every landed hit feeds it; it powers crit chance while up.
  const comboCrit = Math.min(0.30, (p.combo || 0) * 0.025);
  const crit = Math.random() < (Entities.critChance(p) + comboCrit);
  // A wraith's curse shrinks the hero's damage output while it lingers.
  const cursed = (p.curseT || 0) > 0;
  let final = Math.max(1, Math.round((dmg - e.def * 0.25) * (cursed ? 0.8 : 1)));
  let blocked = false;
  // Bulwark's shield: hits coming from the half of the arena he faces are
  // mostly turned away — flank the shield side to actually hurt him.
  if (e.special === 'shield' && source && !crit) {
    const angTo = Math.atan2(source.y - e.y, source.x - e.x);
    const facingAng = e.facing > 0 ? 0 : Math.PI;
    let diff = Math.abs(angTo - facingAng);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < Math.PI / 2 + 0.55) blocked = true;
  }
  if (blocked) {
    final = Math.max(1, Math.round(final * 0.22));
    e.hitFlash = Math.max(e.hitFlash, 0.08);
    addFloatNum(e.x, e.y - e.radius - 4, 'ЩИТ', 'dim');
    Particles.impact(e.x, e.y, source.x - e.x, source.y - e.y, '#cfe0f0');
    AudioSystem.sfx.hit();
  } else {
    if (crit) {
      final = Math.round(final * Entities.critMult(G.player));
      Particles.burst(e.x, e.y, '#ffd76a', 10, 150, 2.2, 0.45);
      Particles.ring(e.x, e.y, '#ffd76a', 10);
      addFloatNum(e.x, e.y - e.radius - 4, final, 'crit');
      AudioSystem.sfx.crit();
    } else {
      addFloatNum(e.x, e.y - e.radius - 4, final, 'dmg');
      AudioSystem.sfx.hit();
    }
    Particles.blood(e.x, e.y);
    e.hitFlash = 0.12;
  }
  e.hp -= final;
  e.alert = true;
  G.camShake = Math.max(G.camShake, blocked ? 1 : (crit ? 4 : 2));
  // Land a hit → feed the combo (resets its timer); the streak is shown via
  // floats at thresholds so the pace feels rewarded without any UI clutter.
  if (e.hp > 0) {
    const wasCombo = p.combo;
    p.combo = (p.combo || 0) + 1;
    p.comboT = 2.5;
    if (wasCombo < 5 && p.combo >= 5) addFloatNum(p.x, p.y - 34, 'КОМБО x5!', 'crit');
    else if (wasCombo < 10 && p.combo >= 10) addFloatNum(p.x, p.y - 34, 'КОМБО x10!', 'crit');
  }
  // Boss fights kick the music up a gear the moment the hero lands a blow.
  if ((e.key === 'boss' || e.isGuardian || e.isFinal) && AudioSystem.setBossMode) AudioSystem.setBossMode(true);
  // Deep cultists blink away when struck so they stay mobile and spooky.
  if (e.hp > 0 && e.key === 'cultist' && Math.random() < 0.4) blinkCultist(e);
  if (e.hp <= 0) killEnemy(e);
  return final;
}

function blinkCultist(e) {
  const p = G.player;
  let tx = e.x, ty = e.y, ok = false;
  for (let i = 0; i < 20 && !ok; i++) {
    const a = e.rng() * Math.PI * 2;
    const d = 90 + e.rng() * 120;
    tx = p.x + Math.cos(a) * d;
    ty = p.y + Math.sin(a) * d;
    ok = !wouldCollide(tx, ty, e.radius);
  }
  if (!ok) return;
  Particles.swirl(e.x, e.y, '#c09bff');
  AudioSystem.sfx.magic();
  e.x = Util.clamp(tx, e.radius, G.world.w * 24 - e.radius);
  e.y = Util.clamp(ty, e.radius, G.world.h * 24 - e.radius);
  e.hitFlash = 0; // blink animation reads as i-frames visually
  e.attackCd = Math.max(e.attackCd || 0, 0.35);
  Particles.swirl(e.x, e.y, '#c09bff');
}

function killEnemy(e) {
  const idx = G.world.enemies.indexOf(e);
  if (idx === -1) return;
  G.world.enemies.splice(idx, 1);
  const p = G.player;
  p.kills++;
  AudioSystem.sfx.kill();
  Particles.blood(e.x, e.y);
  Particles.ring(e.x, e.y, e.glowColor || '#aaa', 18);
  if (e.special === 'boom') boomlingExplode(e);
  // The boss is down — let the soundtrack calm back down.
  if ((e.key === 'boss' || e.isGuardian || e.isFinal) && AudioSystem.setBossMode) AudioSystem.setBossMode(false);
  // XP
  gainXP(e.xp);
  // Gold drop (scaled gently with depth so shops stay spendable).
  const gold = Math.round(Util.randInt(e.gold[0], e.gold[1]) * Entities.goldMul(G.floor));
  if (gold > 0) {
    G.world.items.push({ x: e.x, y: e.y, key: 'gold', name: 'Золото', kind: 'gold',
                         glyph: '💰', value: gold, glow: '#e6c458' });
  }
  // Item drop chance (rises slightly with depth; guardians always drop loot).
  const dropChance = Math.min(0.26, 0.14 + G.floor * 0.0008);
  if ((Math.random() < dropChance || e.isGuardian) && !e.isBoss) {
    const pool = Entities.floorLootPool(G.floor);
    const key = Util.pick(pool);
    const it = makeItem(key);
    it.x = e.x; it.y = e.y;
    G.world.items.push(it);
    addFloatNum(e.x, e.y - 10, '📦', 'loot');
  }
  // Guardian defeat: bonus goodies + fanfare.
  if (e.isGuardian) {
    AudioSystem.sfx.boss();
    UI.toast('СТРАЖ ПУСТОТЫ ПОВЕРЖЕН!', 'gold');
    for (let i = 0; i < 2; i++) {
      const pool = Entities.floorLootPool(G.floor);
      const it = makeItem(Util.pick(pool));
      it.x = e.x + (i === 0 ? 12 : -12); it.y = e.y;
      G.world.items.push(it);
    }
  }
  // Final boss drop: guaranteed key + victory.
  if (e.isFinal) {
    const it = makeItem('key');
    it.x = e.x; it.y = e.y;
    G.world.items.push(it);
    triggerVictory();
  }
}

// Boomlings detonate on death: a violent green blast that can hurt the player
// and even friendly-fire nearby enemies, so they should be popped at range.
function boomlingExplode(e) {
  AudioSystem.sfx.explosion();
  G.camShake = Math.max(G.camShake, 9);
  Particles.doubleRing(e.x, e.y, '#7ac95c', 28);
  Particles.burst(e.x, e.y, '#b0df8a', 18, 170, 3, 0.45);
  Particles.burst(e.x, e.y, '#4caf50', 12, 110, 2.5, 0.4);
  Particles.ring(e.x, e.y, '#ffd76a', 10);
  const radius = 46;
  const p = G.player;
  if (Util.dist(p.x, p.y, e.x, e.y) <= radius + p.radius) {
    damagePlayer(Math.max(2, Math.round(e.atk * 1.6)), e);
  }
  for (const o of [...G.world.enemies]) {
    if (Util.dist(e.x, e.y, o.x, o.y) <= radius + o.radius) {
      damageEnemy(o, Math.max(1, Math.round(e.atk * 1.4)), 0, e);
    }
  }
}

function gainXP(amt) {
  const p = G.player;
  p.xp += amt;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = Math.round(p.xpNext * 1.45);
    p.maxHp += 8; p.hp += 8;
    p.maxMp += 6; p.mp += 6;
    unlockByLevel(p);
    AudioSystem.sfx.levelup();
    UI.toast(`Уровень ${p.level}!`, 'loot');
    // Milestone levels grant a free second life charge (a subtle safety that
    // replaces the old always-free floor respawn).
    if (p.level % 15 === 0) {
      p.revives = (p.revives || 0) + 1;
      UI.toast('❤️‍🔥 Божественная искра: +1 второй жизни!', 'loot');
    }
    // Do NOT block play; offer perks via banner instead to keep flow simple.
  }
}

// ---------- Enemy AI ----------
// Move an enemy by (dx, dy): ghosts pass through walls, everyone else uses
// tile collision. Updates facing + walk amplitude for the render animation.
// Enemies never wander into the safe zones (start hall, merchant den).
function moveEnemy(e, dx, dy, dt) {
  const bx = e.x, by = e.y;
  // Global pace-up + terrain drag (water/lava slow monsters like the hero).
  const mod = (e.tileSlow || 1) * Entities.ENEMY_PACE;
  dx *= mod; dy *= mod;
  if (e.type === 'ghost') {
    const nx = Util.clamp(e.x + dx, e.radius, G.world.w * 24 - e.radius);
    const ny = Util.clamp(e.y + dy, e.radius, G.world.h * 24 - e.radius);
    if (!isInSafeZone(nx, ny)) { e.x = nx; e.y = ny; }
  } else {
    // Try move; if blocked by a wall the attempt is rejected wholesale, but
    // safe-zone crossing is filtered per component so a chase along the rim
    // still works when only one axis would spill inside.
    const safe = G.world.safeRects || [];
    const gx = Util.clamp(e.x + dx, e.radius, G.world.w * 24 - e.radius);
    const gy = Util.clamp(e.y + dy, e.radius, G.world.h * 24 - e.radius);
    if (safe.length && withinSafeRect(e.x, e.y)) {
      // Inside a safe zone: only move along the axis that stays inside.
      if (withinSafeRect(gx, e.y) && !wouldCollide(gx, e.y, e.radius)) e.x = gx;
      if (withinSafeRect(e.x, gy) && !wouldCollide(e.x, gy, e.radius)) e.y = gy;
    } else {
      tryMove(e, dx, dy);
      // Safety: if the combined move ended up inside a safe zone, bail out.
      if (isInSafeZone(e.x, e.y)) { e.x = bx; e.y = by; }
    }
  }
  if (Math.abs(e.x - bx) > 0.05 || Math.abs(e.y - by) > 0.05) {
    if (Math.abs(dx) > 0.01) e.facing = dx > 0 ? 1 : -1;
    e.walkT = Math.min(1, (e.walkT || 0) + dt * 3);
  }
}

function isInSafeZone(x, y) {
  const safe = G.world.safeRects || [];
  for (const r of safe) {
    if (x > r.x0 * 24 - 6 && x < (r.x1 + 1) * 24 + 6 && y > r.y0 * 24 - 6 && y < (r.y1 + 1) * 24 + 6) return true;
  }
  return false;
}
function withinSafeRect(x, y) {
  const safe = G.world.safeRects || [];
  for (const r of safe) {
    if (x >= r.x0 * 24 && x <= (r.x1) * 24 && y >= r.y0 * 24 && y <= (r.y1) * 24) return true;
  }
  return false;
}

// Coarse raycast on the walkable grid — tells ranged enemies whether their
// shot has a clear path (they reposition instead of firing into walls).
function lineOfSight(ax, ay, bx, by) {
  const w = G.world.w, h = G.world.h;
  const dx = bx - ax, dy = by - ay;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 12));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor((ax + dx * t) / 24), cy = Math.floor((ay + dy * t) / 24);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    if (!G.world.walkable[cy * w + cx]) return false;
  }
  return true;
}

// BFS over the walkable grid from the enemy tile toward the player tile.
// Returns the center of the first walkable tile to head to, or null when the
// target is adjacent/unreachable (caller falls back to straight-line).
function findPath(e, tx, ty) {
  const w = G.world.w, h = G.world.h;
  const sx = Math.floor(e.x / 24), sy = Math.floor(e.y / 24);
  const gx = Math.floor(tx / 24), gy = Math.floor(ty / 24);
  if (sx === gx && sy === gy) return null;
  const start = sy * w + sx, goal = gy * w + gx;
  const prev = new Int32Array(w * h).fill(-1);
  const dist = new Int32Array(w * h).fill(-1);
  const queue = [start];
  dist[start] = 0;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goal) break;
    if (dist[cur] >= 220) continue; // cap the search radius for perf
    const cx = cur % w, cy = (cur / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nxx = cx + (d === 1 ? 1 : d === 3 ? -1 : 0);
      const nyy = cy + (d === 0 ? -1 : d === 2 ? 1 : 0);
      if (nxx < 0 || nyy < 0 || nxx >= w || nyy >= h) continue;
      const ni = nyy * w + nxx;
      if (dist[ni] !== -1 || !G.world.walkable[ni]) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      if (ni === goal) { head = queue.length; break; }
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
  // Walk back to the tile right after the enemy's current tile.
  let cur = goal;
  while (prev[cur] !== start) {
    cur = prev[cur];
    if (prev[cur] === -1) return null;
  }
  return { x: (cur % w) * 24 + 12, y: ((cur / w) | 0) * 24 + 12 };
}

// Cached BFS step: recompute at most every `PATH_REFRESH` s per enemy so 20+
// chasers don't all run a full-grid flood fill every frame.
const PATH_REFRESH = 0.45;
function pathStep(e, tx, ty) {
  if (!e.path || e.path.t <= 0) {
    e.path = { t: PATH_REFRESH, step: findPath(e, tx, ty) };
  }
  return e.path.step;
}

function updateEnemies(dt) {
  const p = G.player;
  for (const e of G.world.enemies) {
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.walkT = Math.max(0, (e.walkT || 0) - dt * 4);
    if (e.path) e.path.t -= dt;

    // Hazards hit monsters the same way they hit the hero: water drags,
    // lava drags AND burns. moveEnemy applies e.tileSlow as a speed factor.
    const et = tileAtWorld(e.x, e.y);
    if (et === Tile.WATER) {
      e.tileSlow = 0.5;
    } else if (et === Tile.LAVA) {
      e.tileSlow = 0.55;
      e.lavaT = (e.lavaT || 0) - dt;
      if (e.lavaT <= 0) {
        e.lavaT = 0.55;
        e.hp -= Math.max(1, Math.round(e.maxHp * 0.02));
        Particles.burst(e.x, e.y, '#ff7a3c', 4, 50, 1.6, 0.3);
        if (e.hp <= 0) { killEnemy(e); continue; }
      }
    } else {
      e.tileSlow = 1;
      e.lavaT = 0;
    }

    const distToP = Util.dist(e.x, e.y, p.x, p.y);

    // Alert if player near or damaged.
    if (!e.alert && distToP < e.aggroRange * 24) e.alert = true;

    // Handle attacking state.
    if (e.attacking) {
      const a = e.attacking;
      a.t += dt;
      if (a.kind === 'charge') {
        // Charger windup -> fast straight lunge that stops on walls/contact.
        if (!a.done && a.t >= a.windup && a.t < a.windup + a.active) {
          const bx = e.x, by = e.y;
          tryMove(e, a.dirx * a.speed * dt, a.diry * a.speed * dt);
          const moved = Math.abs(e.x - bx) + Math.abs(e.y - by) > 0.01;
          if (!moved) {
            a.done = true;
            G.camShake = Math.max(G.camShake, 3);
            Particles.doubleRing(e.x, e.y, '#c9b48a', 12);
          } else {
            Particles.dustTrail(e.x, e.y, a.dirx, a.diry, '#c9b48a');
            if (Util.dist(e.x, e.y, p.x, p.y) < p.radius + e.radius + 6) {
              hitPlayer(a, e);
              Particles.impact(p.x, p.y, a.dirx, a.diry, '#ffb35c');
              a.done = true;
            }
          }
        }
        if (a.t >= a.windup + a.active + a.recover) e.attacking = null;
        continue;
      }
      if (a.kind === 'melee' && !a.done && a.t >= a.windup && a.t <= a.windup + a.active) {
        a.done = true;
        const overlap = Util.dist(e.x, e.y, p.x, p.y) < a.range + p.radius + e.radius;
        if (overlap) hitPlayer(a, e);
      }
      if (a.kind === 'ranged') {
        // Warmer glow during the windup telegraphs the cast before the shot.
        if (a.t < a.windup) {
          if (Math.random() < 0.3) Particles.tracer(e.x, e.y, 0, 0, e.glowColor || '#ff7a3c');
        } else if (!a.done) {
          a.done = true;
          fireEnemyProjectile(e, a);
        }
      }
      if (a.t >= a.windup + a.active + a.recover) e.attacking = null;
      continue; // can't move while mid-attack
    }

    if (!e.alert) {
      // Idle wander — deterministic per-enemy stream.
      e.stroll.timer -= dt;
      if (e.stroll.timer <= 0) {
        e.stroll.timer = 1 + e.rng() * 4;
        e.stroll.dirx = (e.rng() - 0.5) * 2;
        e.stroll.diry = (e.rng() - 0.5) * 2;
      }
      if (e.stroll.timer > 0.1) {
        const len = Math.hypot(e.stroll.dirx, e.stroll.diry) || 1;
        moveEnemy(e, (e.stroll.dirx / len) * e.speed * 0.2 * dt, (e.stroll.diry / len) * e.speed * 0.2 * dt, dt);
      }
      continue;
    }

    // --- Alerted: decide behavior by type ---
    if (e.type === 'ranged' || e.type === 'boss') {
      // Ranged keep a comfortable band and never lob shots into a wall.
      const closeDist = e.attack.range * 0.75;
      const canShoot = lineOfSight(e.x, e.y, p.x, p.y);
      const ang = Math.atan2(p.y - e.y, p.x - e.x);
      let dx = 0, dy = 0;
      if (canShoot) {
        if (distToP > closeDist) {
          dx = Math.cos(ang); dy = Math.sin(ang);               // approach
        } else if (distToP < closeDist * 0.45) {
          dx = -Math.cos(ang); dy = -Math.sin(ang);             // back off
        } else {
          // Strafe perpendicular to stay a moving target.
          const s = (Math.sin(e.phase) >= 0 ? 1 : -1);
          dx = -Math.sin(ang) * s; dy = Math.cos(ang) * s;
        }
      } else {
        // No line of sight: path toward the player until a shot opens up.
        const step = pathStep(e, p.x, p.y);
        if (step) {
          const d = Util.dist(step.x, step.y, e.x, e.y) || 1;
          dx = (step.x - e.x) / d; dy = (step.y - e.y) / d;
        } else {
          dx = Math.cos(ang); dy = Math.sin(ang);
        }
      }
      if (dx || dy) moveEnemy(e, dx * e.speed * dt, dy * e.speed * dt, dt);
      if (canShoot && distToP <= e.attack.range + 30 && e.attackCd <= 0) {
        e.attackCd = e.attack.recover + e.attack.windup + 0.6;
        const la = enemyLeadAngle(e, p);
        e.attacking = {
          kind: 'ranged', dirx: Math.cos(la), diry: Math.sin(la),
          range: e.attack.range, dmg: e.atk,
          windup: e.attack.windup, active: e.attack.active, recover: e.attack.recover,
          t: 0, done: false, dmgMult: e.attack.dmgMult,
        };
        AudioSystem.sfx.magic();
      }
    } else {
      // Melee / ghost / charger: chase until in swing or charge range.
      const ang = Math.atan2(p.y - e.y, p.x - e.x);
      const isCharger = e.special === 'charge';
      const reach = isCharger ? e.attack.range : e.attack.range + p.radius - 4;
      if (distToP > reach) {
        let dx = Math.cos(ang), dy = Math.sin(ang);
        // Far targets route around walls via BFS; close range chases straight
        // so the fight stays crisp and aggressive.
        if (distToP > 3 * 24) {
          const step = pathStep(e, p.x, p.y);
          if (step) {
            const d = Util.dist(step.x, step.y, e.x, e.y) || 1;
            dx = (step.x - e.x) / d; dy = (step.y - e.y) / d;
          }
        }
        // Individual strafe: melee mobs drift to the side while closing so
        // they rarely approach perfectly head-on (a pack surrounds instead of
        // one long conga line). Direction flips with each enemy's phase.
        const strafe = Math.sin(G.clock * 2.1 + e.phase) > 0 ? 1 : -1;
        dx += Math.cos(ang + Math.PI / 2) * 0.22 * strafe;
        dy += Math.sin(ang + Math.PI / 2) * 0.22 * strafe;
        {
          const len = Math.hypot(dx, dy) || 1;
          dx /= len; dy /= len;
        }
        // Crowd avoidance: drift sideways instead of piling onto one spot.
        let crowd = 0;
        for (const other of G.world.enemies) {
          if (other !== e && Util.dist(other.x, other.y, e.x, e.y) < 22) crowd++;
        }
        if (crowd > 0) {
          const s = (crowd % 2 === 0 ? 1 : -1);
          dx += Math.cos(ang + Math.PI / 2) * s * (crowd > 2 ? 0.8 : 0.5);
          dy += Math.sin(ang + Math.PI / 2) * s * (crowd > 2 ? 0.8 : 0.5);
          const len = Math.hypot(dx, dy) || 1;
          dx /= len; dy /= len;
        }
        moveEnemy(e, dx * e.speed * dt, dy * e.speed * dt, dt);
      }
      if (isCharger) {
        // Charger: at mid range with line of sight he telegraphs and lunges;
        // close range switches to a normal lunge so he can't charge through walls.
        const canLunge = lineOfSight(e.x, e.y, p.x, p.y);
        if (e.attackCd <= 0 && distToP > 40 && canLunge) {
          e.attackCd = e.attack.windup + e.attack.active + e.attack.recover + 0.7;
          e.attacking = {
            kind: 'charge', dirx: Math.cos(ang), diry: Math.sin(ang),
            range: e.attack.range, dmg: e.atk, speed: 8 * Entities.SPEED_SCALE,
            windup: e.attack.windup, active: e.attack.active, recover: e.attack.recover,
            t: 0, done: false, dmgMult: e.attack.dmgMult,
          };
          e.walkT = 1;
          G.camShake = Math.max(G.camShake, 1);
          Particles.ring(e.x, e.y, '#ffb35c', 8);
          AudioSystem.sfx.whoosh();
        }
      } else if (distToP <= e.attack.range + p.radius + e.radius - 2 && e.attackCd <= 0) {
        e.attackCd = e.attack.recover + e.attack.windup + 0.3;
        e.attacking = {
          kind: 'melee', dirx: Math.cos(ang), diry: Math.sin(ang),
          range: e.attack.range, dmg: e.atk,
          windup: e.attack.windup, active: e.attack.active, recover: e.attack.recover,
          t: 0, done: false, dmgMult: e.attack.dmgMult,
        };
        AudioSystem.sfx.whoosh();
      }
    }
  }
}

function fireEnemyProjectile(e, a) {
  const shots = e.special === 'volley' ? 3 : 1;
  const baseAng = Math.atan2(a.diry, a.dirx);
  const color = e.key === 'boss' ? '#ff3b5c'
    : e.key === 'wraith' || e.key === 'cultist' ? '#c09bff'
      : e.key === 'archer' ? '#e0d8b8' : '#ff7a3c';
  for (let i = 0; i < shots; i++) {
    const ang = baseAng + (shots === 3 ? (i - 1) * 0.15 : 0);
    const sx = e.x + Math.cos(ang) * e.radius, sy = e.y + Math.sin(ang) * e.radius;
    G.world.projectiles.push({
      x: sx, y: sy,
      vx: Math.cos(ang) * (5 * Entities.SPEED_SCALE), vy: Math.sin(ang) * (5 * Entities.SPEED_SCALE),
      damage: Math.round(e.atk * (a.dmgMult || 1)),
      r: e.special === 'volley' ? 5 : 7, friendly: false, color,
      kind: e.special === 'orb' ? 'orb' : 'proj',
      homing: e.special === 'orb',
      // Homing only for a short opening stretch — after that it rides its
      // locked velocity so a quick sidestep can dodge it.
      homingT: e.special === 'orb' ? 0.55 : 0,
      curse: e.special === 'curse', t: 0,
    });
  }
  Particles.magicSparks(e.x + a.dirx * e.radius, e.y + a.diry * e.radius, color);
}

function hitPlayer(a, e) {
  const dmg = Math.round(e.atk * (a.dmgMult || 1));
  const p = G.player;
  // Spider venom shot: the web slows the hero so the pack catches up.
  if (e.special === 'web') {
    p.moveSlow = Math.max(p.moveSlow || 0, 1.1);
    Particles.ring(p.x, p.y, '#bfd49a', 12);
    Particles.magicSparks(p.x, p.y, '#bfd49a');
  }
  // Bone brute smash: the ground shock doubles the sting and rocks the camera
  // so you feel the hit even if the blow glances.
  if (e.special === 'slam') {
    Particles.doubleRing(e.x, e.y, '#d8c9a0', 20);
    Particles.burst(p.x, p.y, '#d8c9a0', 6, 70, 1.8, 0.4);
    G.camShake = Math.max(G.camShake, 5);
    p.facing = p.x < e.x ? -1 : 1;
  }
  damagePlayer(dmg, e);
}

function damagePlayer(dmg, source) {
  const p = G.player;
  if (p.dying || p.dead) return;
  if (p.invuln > 0) return;
  const s = Entities.equipmentStats(p);
  let guard = p.def + s.def;
  let final = Math.max(1, dmg - guard * 0.5);
  if (Input.isDown('shift') && !p.dashing) final = Math.max(1, Math.round(final * 0.5));
  p.invuln = 0.35;
  p.hp -= final;
  p.hitFlash = 0.15;
  G.camShake = Math.max(G.camShake, 5);
  G.dmgFlash = 0.55;
  AudioSystem.sfx.playerHit();
  Particles.blood(p.x, p.y);
  addFloatNum(p.x, p.y - 20, final, 'dmg');
  if (source) {
    const ang = Math.atan2(p.y - source.y, p.x - source.x);
    tryMove(p, Math.cos(ang) * 12, Math.sin(ang) * 12);
  }
  UI.updateHUD();
}

function addFloatNum(x, y, text, cls) {
  Particles.addFloat(x, y, text, cls);
}

// ---------- Projectiles ----------
function updateProjectiles(dt) {
  const p = G.player;
  const list = G.world.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const pr = list[i];
    pr.t += dt;
    // Homing orbs steer toward the player, but only for their opening window
    // (homingT); past that they lock their heading and fly straight so a late
    // sidestep genuinely dodges instead of the orb just behind the hero.
    if (pr.homing && pr.homingT > 0 && !pr.friendly) {
      pr.homingT -= dt;
      const cur = Math.atan2(pr.vy, pr.vx);
      const want = Math.atan2(p.y - pr.y, p.x - pr.x);
      let d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const maxTurn = 2.2 * dt;
      const turn = Math.abs(d) <= maxTurn ? d : Math.sign(d) * maxTurn;
      const spd = Math.hypot(pr.vx, pr.vy);
      const na = cur + turn;
      pr.vx = Math.cos(na) * spd;
      pr.vy = Math.sin(na) * spd;
      if (Math.random() < 0.4) Particles.tracer(pr.x, pr.y, Math.cos(na) * 5, Math.sin(na) * 5, pr.color);
    }
    const nx = pr.x + pr.vx * dt;
    const ny = pr.y + pr.vy * dt;
    // Wall collision.
    if (wouldCollide(nx, ny, pr.r)) {
      if (pr.kind === 'fireball') explodeFireball(pr);
      Particles.burst(pr.x, pr.y, pr.color || '#ff7a3c', 4, 60, 1.6, 0.35);
      list.splice(i, 1);
      continue;
    }
    pr.x = nx; pr.y = ny;

    let dead = false;
    if (pr.friendly) {
      // Hit enemies.
      for (const e of [...G.world.enemies]) {
        if (Util.dist(pr.x, pr.y, e.x, e.y) < pr.r + e.radius) {
          if (pr.kind === 'fireball') explodeFireball(pr);
          else damageEnemy(e, pr.damage, 0, p);
          dead = true;
          break;
        }
      }
    } else {
      // Enemy projectile hitting player.
      if (Util.dist(pr.x, pr.y, p.x, p.y) < pr.r + p.radius) {
        damagePlayer(pr.damage, null);
        // Wraith soul-speckles curse the hero: -20% damage dealt for 3s.
        if (pr.curse) {
          p.curseT = 3;
          Particles.ring(p.x, p.y, '#c09bff', 16);
          Particles.magicSparks(p.x, p.y, '#c09bff');
          addFloatNum(p.x, p.y - 24, 'Проклятие!', 'crit');
        }
        dead = true;
      }
    }
    // Lifetime cull (only if not already removed above — a hit removes it).
    if (dead) {
      list.splice(i, 1);
    } else if (pr.t > 4) {
      list.splice(i, 1);
    }
  }
}

function explodeFireball(pr) {
  AudioSystem.sfx.explosion();
  G.camShake = Math.max(G.camShake, 6);
  Particles.ring(pr.x, pr.y, '#ff7a3c', 24);
  Particles.burst(pr.x, pr.y, '#ff7a3c', 20, 160, 3, 0.5);
  Particles.burst(pr.x, pr.y, '#ffd76a', 14, 120, 2.5, 0.4);
  const radius = 36;
  for (const e of [...G.world.enemies]) {
    if (Util.dist(pr.x, pr.y, e.x, e.y) <= radius + e.radius) {
      damageEnemy(e, pr.damage * 0.7, 0);
    }
  }
}

// ---------- Items / pickups ----------
function updateItems(dt) {
  const p = G.player;
  for (let i = G.world.items.length - 1; i >= 0; i--) {
    const it = G.world.items[i];
    // Breathe scale visual is handled in render.
    const d = Util.dist(p.x, p.y, it.x, it.y);
    if (d < p.radius + 16) {
      if (it.kind === 'gold') {
        const diffGold = Entities.DIFFICULTY[p.difficulty || 'normal'].gold || 1;
        const got = Math.round(it.value * (p.goldMult || 1) * diffGold);
        p.gold += got;
        addFloatNum(it.x, it.y - 10, '+' + got, 'gold');
        AudioSystem.sfx.gold();
      } else if (it.kind === 'potion') {
        pickupPotion(it);
      } else if (it.kind === 'key') {
        p.keys++;
        addFloatNum(it.x, it.y - 10, '🔑 +1', 'loot');
        UI.toast('Получен рунический ключ!', 'loot');
        AudioSystem.sfx.pickup();
        maybeBossIntro();
      } else if (it.kind === 'weapon' || it.kind === 'armor') {
        // If the bag is full the item stays where it lies instead of vanishing.
        if (!pickupEquipment(it)) continue;
      } else if (it.kind === 'book') {
        if (pickupBook(it)) { /* collected */ }
        else continue;
      } else {
        continue; // misc not auto-picked
      }
      G.world.items.splice(i, 1);
    }
    // Item lifetime (optional cleanup not needed).
  }
}

function pickupPotion(it) {
  const p = G.player;
  const key = it.key === 'potion_big' ? 'potion_big' : 'potion';
  p.potions[key]++;
  addFloatNum(it.x, it.y - 10, it.glyph + ' +1', 'heal');
  AudioSystem.sfx.pickup();
}

function pickupBook(it) {
  const p = G.player;
  if (!p.books) p.books = [];
  if (p.books.some((b) => b.key === it.key)) { UI.toast('Ты уже читал эту книгу', 'dim'); return false; }
  p.books.push({ key: it.key, titleR: it.titleR, titleEn: it.titleEn, textR: it.textR, textEn: it.textEn });
  addFloatNum(it.x, it.y - 12, it.glyph, 'loot');
  AudioSystem.sfx.pickup();
  UI.toast('Книга найдена — читается в инвентаре', 'loot');
  return true;
}

function pickupEquipment(it) {
  const p = G.player;
  // Auto-equip if slot empty or strictly better; else add to bag.
  const slotKey = it.kind === 'weapon' ? 'weapon' : 'armor';
  const cur = p[slotKey];
  if (!cur || isBetter(it, cur)) {
    if (cur) { p.inventory.push(cur); UI.toast(`${it.name} — в сумку (заменено)`, 'loot'); }
    p[slotKey] = { ...it };
    UI.toast(`Экипировано: ${it.name}`, 'loot');
    AudioSystem.sfx.pickup();
    Particles.magicSparks(p.x, p.y, it.glow);
    addFloatNum(p.x, p.y - 24, it.glyph, 'loot');
    return true;
  }
  if (p.inventory.length < p.inventoryCap) {
    p.inventory.push({ ...it });
    UI.toast(`${it.name} — в сумку`, 'loot');
    addFloatNum(p.x, p.y - 24, it.glyph, 'loot');
    AudioSystem.sfx.pickup();
    return true;
  }
  // Bag is full: report it but DON'T pick the item up — it stays on the
  // ground. The hint has a cooldown so walking over loot doesn't spam.
  if ((G.bagHintCd || 0) <= 0) {
    G.bagHintCd = 1.6;
    UI.toast('Сумка полна — предмет остаётся на земле!', 'warn');
    AudioSystem.sfx.error();
  }
  return false;
}

function isBetter(newItem, cur) {
  if (newItem.kind === 'weapon') {
    const a = (newItem.max || 0), b = (cur.max || 0);
    return a > b;
  }
  const a = (newItem.def || 0) + (newItem.hpBonus || 0);
  const b = (cur.def || 0) + (cur.hpBonus || 0);
  return a > b;
}

function drinkPotion(key) {
  const p = G.player;
  if (p.potions[key] <= 0) { AudioSystem.sfx.error(); return; }
  p.potions[key]--;
  const s = Entities.equipmentStats(p);
  const def = Entities.ITEMS[key === 'potion_big' ? 'potion_big' : 'potion'];
  const healAmt = def.heal;
  p.hp = Math.min(p.maxHp + s.hpBonus, p.hp + healAmt);
  AudioSystem.sfx.heal();
  Particles.magicSparks(p.x, p.y, '#44e08a');
  addFloatNum(p.x, p.y - 24, '+' + Math.min(healAmt, (p.maxHp + s.hpBonus) - p.hp), 'heal');
  UI.updateHUD();
}

// ---------- Equipment actions ----------
function equipItem(idx) {
  const p = G.player;
  const item = p.inventory[idx];
  if (!item) return;
  if (item.kind === 'weapon' || item.kind === 'armor') {
    const slotKey = item.kind === 'weapon' ? 'weapon' : 'armor';
    const cur = p[slotKey];
    if (cur) p.inventory[idx] = cur;
    else p.inventory.splice(idx, 1);
    p[slotKey] = item;
    UI.toast(`Экипировано: ${item.name}`, 'loot');
    AudioSystem.sfx.pickup();
    UI.updateHUD();
  }
}
function dropItem(idx) {
  const p = G.player;
  const item = p.inventory[idx];
  if (!item) return;
  p.inventory.splice(idx, 1);
  // Dropped gear lands ~2 tiles ahead so it isn't re-picked instantly. If the
  // forward spot is a wall, drop straight at the feet instead.
  let dx = p.facing * 48, dy = 8;
  if (wouldCollide(p.x + dx, p.y + dy, 8)) { dx = 0; dy = 48; }
  const dropped = { ...item, x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
  G.world.items.push(dropped);
  UI.toast('Выброшено: ' + dropped.name, 'dim');
  AudioSystem.sfx.pickup();
  UI.updateHUD();
}
function sellItem(idx) {
  const p = G.player;
  const item = p.inventory[idx];
  if (!item) return;
  // Merchants pay ~30% of value — selling loot is a straight-up loss on the
  // buy curve, so hoarded drops can't be turned into a gold printer.
  const price = Math.max(1, Math.round(item.value * 0.3));
  p.gold += price;
  p.inventory.splice(idx, 1);
  addFloatNum(p.x, p.y - 10, '+💰' + price, 'gold');
  AudioSystem.sfx.gold();
  UI.toast('Продано: ' + item.name, 'gold');
  UI.updateHUD();
}

// ---------- Exploration / fog ----------
function revealAround(x, y) {
  if (!G.explored) return;
  const rad = 7;
  const cx = Math.floor(x / 24), cy = Math.floor(y / 24);
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const ny = cy + dy, nx = cx + dx;
      if (nx < 0 || ny < 0 || nx >= G.world.w || ny >= G.world.h) continue;
      if (dy * dy + dx * dx <= rad * rad) {
        G.explored[ny * G.world.w + nx] = 1;
      }
    }
  }
}

// ---------- Floor transition via exit ----------
// Standing on the stairs without a key used to spam a toast every frame; the
// cooldown lets only one hint through per ~2.5s.
function checkExit() {
  if (!G || !G.world) return;
  const p = G.player;
  for (const ex of G.world.exits) {
    if (Util.dist(p.x, p.y, ex.x, ex.y) < 26) {
      // The hub door is the free staircase into the dungeon: no key needed.
      if (ex.hub) { advanceFloor(); return; }
      if (ex.boss) {
        // Need key to descend past boss floor (victory already triggered on boss kill).
        return;
      }
      // Need a runic key to descend on every regular floor.
      if (p.keys > 0) {
        G.exitHintCd = 0;
        p.keys--;
        advanceFloor();
      } else if ((G.exitHintCd || 0) <= 0) {
        G.exitHintCd = 2.5;
        UI.toast('Нужен рунический ключ, чтобы спуститься глубже!', 'warn');
      }
    }
  }
}

function advanceFloor() {
  const next = G.floor + 1;
  AudioSystem.sfx.door();
  if (next === FINAL_FLOOR) {
    UI.showBanner('ВЛАДЫКА ПУСТОТЫ', 'Этаж 100 — последний бой');
  } else {
    UI.showBanner(WorldGen.floorName(next, G.seed), `Этаж ${next}`);
  }
  // Rebuild without keepPlayer so the player is placed at the new floor's
  // spawn room instead of being dropped into a wall at (0,0).
  buildFloor(next, null);
  G.explored = new Uint8Array(G.world.w * G.world.h);
  revealAround(G.player.x, G.player.y);
  G.camShake = 6;
  UI.updateHUD();
  maybeBossIntro();
  showFloorStory(G.floor);
}

// Loose plot captions on milestone floors (once per visit, so respawns/loads
// don't spam them — they only fire from advanceFloor/startRun).
function showFloorStory(floor) {
  if (!LORE[floor]) return;
  // Multi-line diary entry; keep it up much longer than ordinary toasts.
  UI.toast('📜 ' + Lang.story(floor, LORE[floor]), 'story', 11000);
}

function maybeBossIntro() {
  if (!G) return;
  if (G.floor === FINAL_FLOOR) {
    const boss = G.world.enemies.find((e) => e.isFinal);
    if (boss) {
      UI.showBanner('ВЛАДЫКА ПУСТОТЫ', 'пробуждён');
      AudioSystem.sfx.boss();
    }
  } else if (G.floor % 10 === 0) {
    const guard = G.world.enemies.find((e) => e.isGuardian);
    if (guard) {
      const gname = Entities.ENEMIES[guard.key] ? Lang.t(Entities.ENEMIES[guard.key].name) : 'СТРАЖ ПУСТОТЫ';
      UI.showBanner(gname.toUpperCase(), `этаж ${G.floor}`);
      AudioSystem.sfx.boss();
    }
  }
}

function triggerVictory() {
  if (state === 'victory') return;
  state = 'victory';
  G.player.keys++;
  G.player.gold += 200;
  AudioSystem.sfx.levelup();
  UI.toast('ВЛАДЫКА ПУСТОТЫ ПОВЕРЖЕН! Победа!', 'gold');
  setTimeout(() => UI.openVictory(), 800);
}

// ---------- Pause helpers ----------
function setPausedMenu(b) { paused = b; if (!b && state==='playing') { last = 0; } }
function setPausedGame(b) { paused = b; if (!b) last = 0; }

// Auto-save on visibility hidden.
function onVisibility() {
  if (document.hidden && state === 'playing' && G) {
    saveGame();
  }
}

// ---------- Input-driven UI toggles ----------
function handleUIControls() {
  if (Input.wasPressed('i')) {
    if (state === 'playing' && !paused) { UI.openInv(); AudioSystem.sfx.ui(); }
  }
  if (Input.wasPressed('c')) {
    if (state === 'playing' && !paused) { UI.openStats(); AudioSystem.sfx.ui(); }
  }
  if (Input.wasPressed('escape')) {
    if (overlayOpen) { UI.hidePanel(); overlayOpen = false; paused = false; last = 0; }
    else if (state === 'playing' && !paused) UI.openPause();
  }
  if (Input.wasPressed('f5')) {
    if (state === 'playing') { saveGame(); UI.toast('Игра сохранена (F5)', 'loot'); }
  }
}

// ---------- Init ----------
function init() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  Render.init(canvas, ctx);
  Particles.init(canvas, ctx, document.getElementById('float-layer'));
  Input.init(canvas);
  UI.init();
  // Audio is created lazily on the first user gesture (AudioSystem.resume in
  // startRun) so the browser doesn't block/report autoplay warnings.

  const doResize = () => {
    Render.resize();
  };
  window.addEventListener('resize', doResize);
  doResize();

  document.addEventListener('visibilitychange', onVisibility);

  // Any uncaught error should be visible, not a silent freeze. The frame()
  // try/catch already covers the loop; this catches click handlers and such.
  window.addEventListener('error', (ev) => {
    reportCrash(ev.error || ev.message, 'uncaught');
  });

  // Start loop.
  running = true;
  last = 0;
  rafId = requestAnimationFrame(frame);

  // Bind key shortcuts that UI panels need; menu shows first.
  UI.openMenu();
}

document.addEventListener('DOMContentLoaded', init);

// Exposed API used by UI and Render (Render reads getters through window.Game).
window.Game = {
  newGame, saveGame, loadGame, revive, buyUpgrade, setClass, setDifficulty,
  equipItem, dropItem, sellItem, buyItem, openShopCheck,
  setPausedMenu, setPausedGame,
  GAME_VERSION,
  get player() { return G && G.player; },
  get world() { return G && G.world; },
  get floor() { return G && G.floor; },
  get seed() { return G && G.seed; },
  get explored() { return G && G.explored; },
  get camShake() { return G ? G.camShake : 0; },
  get playerLight() { return G ? G.playerLight : 7; },
  get tileScale() { return G ? G.tileScale : 24; },
  get clock() { return G ? G.clock : 0; },
  get dmgFlash() { return G ? (G.dmgFlash || 0) : 0; },
  get overlayOpen() { return overlayOpen; },
  set overlayOpen(v) { overlayOpen = v; if (G) G.overlayOpen = v; },
};
