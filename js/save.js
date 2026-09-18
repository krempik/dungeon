/* save.js — versioned localStorage persistence with migration. */
'use strict';

const Save = (() => {
  const KEY = 'dungeon_of_the_void_v1';
  const SAVE_VERSION = 1;

  function serialize(Game) {
    const p = Game.player;
    const w = Game.world;
    return {
      v: SAVE_VERSION,
      floor: Game.floor,
      player: {
        x: p.x, y: p.y,
        hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
        level: p.level, xp: p.xp, xpNext: p.xpNext,
        gold: p.gold, keys: p.keys, kills: p.kills,
        revives: p.revives || 0,
        baseAtk: p.baseAtk, goldMult: p.goldMult || 1,
        weapon: p.weapon ? JSON.parse(JSON.stringify(p.weapon)) : null,
        armor: p.armor ? JSON.parse(JSON.stringify(p.armor)) : null,
        inventory: JSON.parse(JSON.stringify(p.inventory)),
        potions: { ...p.potions },
        unlocked: { ...p.unlocked },
        cls: p.cls || 'void',
        difficulty: p.difficulty || 'normal',
        books: (p.books || []).map((b) => ({ key: b.key, titleR: b.titleR, titleEn: b.titleEn, textR: b.textR, textEn: b.textEn })),
      },
      seed: Game.seed,
    };
  }

  function serializeExtra(Game) {
    // Compact representation of enemy/item state for deeper saves.
    const w = Game.world;
    return {
      enemies: w.enemies.map((e) => [e.x, e.y, e.hp, e.key]),
      items: w.items.map((it) => {
        if (it.kind === 'gold') return ['gold', it.x, it.y, it.value];
        return [it.key, it.x, it.y];
      }),
      torches: w.torches.map((t) => [t.x, t.y, t.r]),
      explored: Array.from(Game.explored),
      // Sold marks persist so a saved game cannot re-buy the second-life
      // amulet (or anything else) that was already purchased on this floor.
      shopSold: w.shop ? w.shop.stock.map((s) => !!s.sold) : null,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return migrate(JSON.parse(JSON.stringify({
        ...data,
        extra: JSON.parse(data.extra || 'null'),
      })));
    } catch (e) {
      console.warn('Save load failed:', e);
      return null;
    }
  }

  function store(Game) {
    try {
      const data = { ...serialize(Game), extra: JSON.stringify(serializeExtra(Game)) };
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('Save store failed:', e);
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); }
    catch (e) { console.warn('Save clear failed:', e); }
  }

  // Migration: keyed on v. Currently v1 is the only version.
  function migrate(data) {
    if (!data || typeof data.v !== 'number') return null;
    if (data.v < 1) return null; // too old to migrate, reject
    if (data.v > SAVE_VERSION) return null; // from the future
    return data;
  }

  return { serialize, serializeExtra, load, store, clear, SAVE_VERSION };
})();