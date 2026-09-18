/* entities.js — player, enemies, items: data tables + logic (pure, dt-driven). */
'use strict';

const Entities = (() => {

  // Speeds in ENEMIES/player are logical units; one shared scaling factor maps
  // them to px/sec at a 24px tile so walk/kin feels right and stays consistent
  // between player, enemies and projectiles.
  const SPEED_SCALE = 24;

  // Global pacing boost for monsters (moves the whole bestiary up a gear so
  // the game plays faster and snappier, Soul-Knight style).
  const ENEMY_PACE = 1.22;

  // ---------------- Enemy definitions (scaled by floor) ----------------
  const ENEMIES = {
    rat:    { name: 'Сквернокрыс',   glyph: '🐀', color: '#9aa0b0', hp: 16, atk: 5,  def: 1,  speed: 2.1, xp: 12, gold: [2, 6],   radius: 12, aggro: 7, type: 'melee',  speedScale: 1.0,
               attack: { windup: 0.30, active: 0.12, recover: 0.30, dmgMult: 1.0, range: 16 } },
    bat:    { name: 'Кожаный нетопырь', glyph: '🦇', color: '#7a6a9a', hp: 11, atk: 6, def: 0, speed: 3.1, xp: 14, gold: [2, 5], radius: 11, aggro: 8, type: 'melee', speedScale: 1.25,
               attack: { windup: 0.22, active: 0.10, recover: 0.26, dmgMult: 1.0, range: 14 } },
    skeleton:{ name: 'Скелет-страж', glyph: '💀', color: '#dfe0e8', hp: 30, atk: 9,  def: 3,  speed: 1.6, xp: 26, gold: [5, 12], radius: 13, aggro: 6, type: 'melee', speedScale: 1.0,
               attack: { windup: 0.40, active: 0.14, recover: 0.42, dmgMult: 1.1, range: 18 } },
    ghost:  { name: 'Призрак',     glyph: '👻', color: '#b8e6ff', hp: 21, atk: 8,  def: 1,  speed: 2.4, xp: 30, gold: [6, 14], radius: 12, aggro: 7, type: 'ghost', speedScale: 1.1,
               attack: { windup: 0.35, active: 0.12, recover: 0.36, dmgMult: 1.15, range: 17 } },
    zombie: { name: 'Гниющий страж', glyph: '🧟', color: '#8fae6a', hp: 42, atk: 10, def: 4,  speed: 1.15, xp: 34, gold: [8, 16], radius: 14, aggro: 5, type: 'melee', speedScale: 1.0,
               attack: { windup: 0.55, active: 0.16, recover: 0.55, dmgMult: 1.25, range: 19 } },
    imp:    { name: 'Имп-пироман', glyph: '🔥', color: '#ff7a3c', hp: 18, atk: 11, def: 1,  speed: 1.9, xp: 38, gold: [8, 18], radius: 12, aggro: 9, type: 'ranged', speedScale: 1.0,
               attack: { windup: 0.45, active: 0.12, recover: 0.6, dmgMult: 1.0, range: 130 } },
    brute:  { name: 'Костяной боец', glyph: '🦴', color: '#d8c9a0', hp: 68, atk: 15, def: 6,  speed: 1.0, xp: 55, gold: [14, 28], radius: 16, aggro: 5, type: 'melee', speedScale: 1.0,
               attack: { windup: 0.50, active: 0.18, recover: 0.5, dmgMult: 1.35, range: 22 }, special: 'slam' },
    wraith: { name: 'Переводчик душ', glyph: '☠️', color: '#c09bff', hp: 54, atk: 18, def: 3,  speed: 1.7, xp: 70, gold: [20, 40], radius: 14, aggro: 8, type: 'ranged', speedScale: 1.05,
               attack: { windup: 0.5, active: 0.14, recover: 0.7, dmgMult: 1.2, range: 150, projectile: true }, special: 'curse' },
    spider: { name: 'Паук-ткач', glyph: '🕷️', color: '#8fae6a', hp: 24, atk: 8,  def: 2,  speed: 2.6, xp: 22, gold: [4, 12], radius: 12, aggro: 8, type: 'melee', speedScale: 1.3,
               attack: { windup: 0.28, active: 0.12, recover: 0.30, dmgMult: 1.05, range: 16 }, special: 'web' },
    archer: { name: 'Скелет-лучник', glyph: '🏹', color: '#b8c9a0', hp: 26, atk: 12, def: 2,  speed: 1.4, xp: 44, gold: [10, 20], radius: 13, aggro: 10, type: 'ranged', speedScale: 1.0,
               attack: { windup: 0.55, active: 0.14, recover: 0.75, dmgMult: 1.1, range: 160 }, special: 'volley' },
    cultist:{ name: 'Глубинный жрец', glyph: '🔮', color: '#c09bff', hp: 34, atk: 14, def: 2,  speed: 1.4, xp: 58, gold: [12, 24], radius: 13, aggro: 9, type: 'ranged', speedScale: 1.1,
               attack: { windup: 0.6, active: 0.16, recover: 0.7, dmgMult: 1.2, range: 170 }, special: 'orb' },
    boomling:{ name: 'Взрывной слизень', glyph: '🟢', color: '#7ac95c', hp: 22, atk: 7,  def: 1,  speed: 1.0, xp: 40, gold: [6, 12], radius: 12, aggro: 6, type: 'melee', speedScale: 1.0,
               attack: { windup: 0.60, active: 0.16, recover: 0.6, dmgMult: 1.1, range: 18 }, special: 'boom' },
    bulwark:{ name: 'Стальной щитоносец', glyph: '🗿', color: '#8ab8d8', hp: 90, atk: 14, def: 12, speed: 0.9, xp: 80, gold: [18, 32], radius: 16, aggro: 5, type: 'melee', speedScale: 1.0,
               attack: { windup: 0.50, active: 0.16, recover: 0.55, dmgMult: 1.25, range: 20 }, special: 'shield' },
    charger:{ name: 'Воин-таран', glyph: '🐗', color: '#d8a05a', hp: 70, atk: 18, def: 5,  speed: 1.6, xp: 90, gold: [20, 36], radius: 15, aggro: 7, type: 'melee', speedScale: 1.0,
               attack: { windup: 0.5, active: 0.3, recover: 0.8, dmgMult: 1.5, range: 120 }, special: 'charge' },
boss:   { name: 'Владыка Пустоты', glyph: '👁', color: '#ff3b5c', hp: 460, atk: 22, def: 8, speed: 1.35, xp: 600, gold: [300, 500], radius: 24, aggro: 10, type: 'boss', speedScale: 1.0,
                attack: { windup: 0.5, active: 0.18, recover: 0.5, dmgMult: 1.3, range: 24 } },
    // Guardian variants — one of these stands guard on every 10th floor so
    // arenas feel distinct: the Warden volleys, the Beginnings weave homing
    // orbs + curse, the Colossus charges and slams the very ground.
    boss_warden:   { name: 'Страж Рубежа', glyph: '🛡', color: '#8ab8d8', hp: 560, atk: 24, def: 16, speed: 1.1, xp: 680, gold: [320, 540], radius: 26, aggro: 10, type: 'boss', speedScale: 1.0,
                       attack: { windup: 0.5, active: 0.18, recover: 0.55, dmgMult: 1.35, range: 28 }, special: 'volley' },
    boss_mystic:   { name: 'Страж Начал', glyph: '🌌', color: '#c09bff', hp: 420, atk: 26, def: 6, speed: 1.25, xp: 680, gold: [300, 540], radius: 24, aggro: 10, type: 'boss', speedScale: 1.0,
                       attack: { windup: 0.55, active: 0.16, recover: 0.55, dmgMult: 1.3, range: 28 }, special: 'orb' },
    boss_behemoth: { name: 'Страж-Истукан', glyph: '🗿', color: '#d8a05a', hp: 720, atk: 30, def: 12, speed: 0.95, xp: 720, gold: [340, 580], radius: 28, aggro: 10, type: 'boss', speedScale: 1.0,
                       attack: { windup: 0.6, active: 0.25, recover: 0.7, dmgMult: 1.5, range: 30 }, special: 'slam' },
  };

  // Which enemy pool appears per floor band (indexes into ENEMIES). As depth
  // grows, the weak early mobs fade out and the tanky/ranged core takes over.
  const FLOOR_ENEMIES = [
    { min: 1,  max: 4,  pool: ['rat', 'bat', 'spider', 'skeleton'] },
    { min: 5,  max: 7,  pool: ['rat', 'bat', 'spider', 'skeleton', 'zombie'] },
    { min: 8,  max: 9,  pool: ['bat', 'spider', 'skeleton', 'zombie', 'cultist', 'ghost'] },
    { min: 10, max: 19, pool: ['bat', 'spider', 'skeleton', 'zombie', 'ghost', 'imp', 'archer', 'cultist'] },
    { min: 20, max: 34, pool: ['skeleton', 'zombie', 'ghost', 'imp', 'archer', 'boomling', 'brute', 'cultist'] },
    { min: 35, max: 54, pool: ['zombie', 'ghost', 'imp', 'archer', 'brute', 'cultist', 'bulwark', 'wraith'] },
    { min: 55, max: 74, pool: ['ghost', 'imp', 'brute', 'wraith', 'archer', 'bulwark', 'boomling'] },
    { min: 75, max: 89, pool: ['imp', 'brute', 'wraith', 'charger', 'cultist', 'bulwark'] },
    { min: 90, max: 100, pool: ['brute', 'wraith', 'charger', 'cultist', 'bulwark'] },
  ];

  function floorEnemyPool(floor) {
    for (const b of FLOOR_ENEMIES) {
      if (floor >= b.min && floor <= b.max) return b.pool;
    }
    return FLOOR_ENEMIES[FLOOR_ENEMIES.length - 1].pool;
  }

  // ---------------- Abilities (player skills) ----------------
  const ABILITIES = {
    strike:    { name: 'Удар', glyph: '🗡️', key: '1', mp: 0,  cd: 0.42, range: 38, dmg: 1.0,   desc: 'Быстрый удар по врагу перед собой', kind: 'melee' },
    whirl:     { name: 'Вихрь', glyph: '🌀', key: '2', mp: 12, cd: 2.8, range: 34, dmg: 0.8,   desc: 'Вращение, бьющее всех вокруг', kind: 'aoe' },
    fireball:  { name: 'Огненный шар', glyph: '🔥', key: '3', mp: 18, cd: 3.4, range: 500, dmg: 1.6, desc: 'Снаряд дальнего боя, взрывается', kind: 'projectile', projSpeed: 140 },
    dash:      { name: 'Рывок', glyph: '⚡', key: 'ctrl', mp: 8,  cd: 2.2, range: 60, dmg: 0.6,   desc: 'Прорыв, отбрасывающий врагов', kind: 'dash' },
    heal:      { name: 'Вспышка жизни', glyph: '💚', key: '4', mp: 22, cd: 6.0, range: 0, dmg: 0, desc: 'Восстановление здоровья', kind: 'heal' },
  };

  // ---------------- Items / equipment ----------------
  const ITEMS = {
    sword_1:  { name: 'Ржавый клинок', kind: 'weapon', glyph: '🗡️', sprite: 'sword_1',  color: '#8a6a3c', min: 6, max: 11,  value: 20 },
    sword_2:  { name: 'Стальной меч', kind: 'weapon', glyph: '⚔️', sprite: 'sword_2',  color: '#b8c4d8', min: 10, max: 18, value: 60 },
    sword_3:  { name: 'Клинок Пустоты', kind: 'weapon', glyph: '🗡️', sprite: 'sword_3',  color: '#9a7cff', min: 16, max: 27, value: 140 },
    sword_4:  { name: 'Косоход-некромант', kind: 'weapon', glyph: '⚔️', sprite: 'sword_4',  color: '#6ad8c8', min: 24, max: 40, value: 300 },
    sword_5:  { name: 'Печать Владыки', kind: 'weapon', glyph: '⚔️', sprite: 'sword_5',  color: '#ff4d5e', min: 34, max: 58, value: 600 },
    sword_6:  { name: 'Клинок Рассвета', kind: 'weapon', glyph: '⚔️', sprite: 'sword_6',  color: '#ffd76a', min: 46, max: 78, value: 1000 },
    sword_7:  { name: 'Топор Погибели', kind: 'weapon', glyph: '⚔️', sprite: 'sword_7',  color: '#d8a05a', min: 60, max: 102, value: 1600 },
    sword_8:  { name: 'Каратель Пустоты', kind: 'weapon', glyph: '⚔️', sprite: 'sword_8',  color: '#7c5cff', min: 78, max: 132, value: 2600 },
    sword_9:  { name: 'Меч Конечности', kind: 'weapon', glyph: '⚔️', sprite: 'sword_9',  color: '#5ce1e6', min: 100, max: 170, value: 4200 },
    sword_10: { name: 'Зов Бездны', kind: 'weapon', glyph: '⚔️', sprite: 'sword_10', color: '#ff7ad5', min: 130, max: 220, value: 6800 },
    sword_11: { name: 'Меч Раскола', kind: 'weapon', glyph: '⚔️', sprite: 'sword_10', color: '#e6e064', min: 170, max: 285, value: 11000 },
    sword_12: { name: 'Погибель Тьмы', kind: 'weapon', glyph: '⚔️', sprite: 'sword_10', color: '#3ce0b8', min: 215, max: 360, value: 17000 },
    staff_1:  { name: 'Деревянный посох', kind: 'weapon', glyph: '🪄', sprite: 'staff_1',  color: '#a0845c', min: 5, max: 16,  value: 30, mpBonus: 10 },
    staff_2:  { name: 'Ледяной посох', kind: 'weapon', glyph: '🪄', sprite: 'staff_2',  color: '#9be8ff', min: 12, max: 25,  value: 95, mpBonus: 25 },
    staff_3:  { name: 'Посох Бездны', kind: 'weapon', glyph: '🪄', sprite: 'staff_3',  color: '#9a7cff', min: 20, max: 38, value: 240, mpBonus: 45 },
    staff_4:  { name: 'Посох Тайных Искр', kind: 'weapon', glyph: '🪄', sprite: 'staff_4',  color: '#7c5cff', min: 30, max: 58, value: 600, mpBonus: 70 },
    staff_5:  { name: 'Посох Шёпота', kind: 'weapon', glyph: '🪄', sprite: 'staff_5',  color: '#c09bff', min: 44, max: 84, value: 1200, mpBonus: 110 },
    staff_6:  { name: 'Посох Забвения', kind: 'weapon', glyph: '🪄', sprite: 'staff_6',  color: '#5ce1a0', min: 62, max: 120, value: 2200, mpBonus: 160 },
    staff_7:  { name: 'Посох Угасших звёзд', kind: 'weapon', glyph: '🪄', sprite: 'staff_6',  color: '#a5e8ff', min: 85, max: 160, value: 4000, mpBonus: 220 },
    staff_8:  { name: 'Скипетр Рассвета', kind: 'weapon', glyph: '🪄', sprite: 'staff_6',  color: '#ffe08a', min: 115, max: 215, value: 7000, mpBonus: 300 },

    armor_1:  { name: 'Кожаный доспех', kind: 'armor', glyph: '🛡️', sprite: 'armor_1',  color: '#a0845c', def: 2, hpBonus: 8,  value: 18 },
    armor_2:  { name: 'Кольчатая броня', kind: 'armor', glyph: '🛡️', sprite: 'armor_2',  color: '#b8c4d8', def: 4, hpBonus: 16, value: 45 },
    armor_3:  { name: 'Некропластины', kind: 'armor', glyph: '🛡️', sprite: 'armor_3',  color: '#8aae8a', def: 7, hpBonus: 30, value: 110 },
    armor_4:  { name: 'Звёздная броня', kind: 'armor', glyph: '🛡️', sprite: 'armor_4',  color: '#9be8ff', def: 11, hpBonus: 55, value: 260 },
    armor_5:  { name: 'Осколок Зари', kind: 'armor', glyph: '🛡️', sprite: 'armor_5',  color: '#ffd76a', def: 16, hpBonus: 85, value: 520 },
    armor_6:  { name: 'Утверждение Тьмы', kind: 'armor', glyph: '🛡️', sprite: 'armor_6',  color: '#7c5cff', def: 22, hpBonus: 130, value: 950 },
    armor_7:  { name: 'Плащ Глубин', kind: 'armor', glyph: '🛡️', sprite: 'armor_7',  color: '#1f8f9c', def: 30, hpBonus: 200, value: 1700 },
    armor_8:  { name: 'Эхо Вечности', kind: 'armor', glyph: '🛡️', sprite: 'armor_8',  color: '#ff7ad5', def: 40, hpBonus: 300, value: 3000 },
    armor_9:  { name: 'Броня Последних врат', kind: 'armor', glyph: '🛡️', sprite: 'armor_8',  color: '#ffcf6a', def: 52, hpBonus: 430, value: 5500 },
    armor_10: { name: 'Корона Пустоты', kind: 'armor', glyph: '🛡️', sprite: 'armor_8', color: '#c09bff', def: 68, hpBonus: 620, value: 9500 },

    potion:   { name: 'Зелье жизни', kind: 'potion', glyph: '🧪', heal: 60, value: 12 },
    potion_big: { name: 'Большое зелье', kind: 'potion', glyph: '⚗️', heal: 150, value: 34 },
    key:      { name: 'Рунический ключ', kind: 'key', glyph: '🔑', value: 60 },
    torch:    { name: 'Факел', kind: 'misc', glyph: '🔥', value: 4 },
    crate:    { name: 'Ящик', kind: 'misc', glyph: '🪵', value: 0 },
  };

  // Monster loot table by floor band: which items a monster can drop. Bands are
  // tight (every few levels) so the loot genuinely improves as you descend.
  const LOOT_TABLE = [
    { min: 1,  max: 3,   pool: ['sword_1', 'armor_1', 'potion'] },
    { min: 4,  max: 6,   pool: ['sword_1', 'sword_2', 'armor_1', 'armor_2', 'potion', 'staff_1'] },
    { min: 7,  max: 10,  pool: ['sword_2', 'sword_3', 'armor_2', 'armor_3', 'potion_big', 'staff_1'] },
    { min: 11, max: 15,  pool: ['sword_3', 'armor_3', 'staff_2', 'potion_big', 'sword_2'] },
    { min: 16, max: 21,  pool: ['sword_3', 'sword_4', 'armor_4', 'staff_2', 'potion_big'] },
    { min: 22, max: 29,  pool: ['sword_4', 'sword_5', 'armor_4', 'armor_5', 'staff_3', 'potion_big'] },
    { min: 30, max: 39,  pool: ['sword_5', 'sword_6', 'armor_5', 'armor_6', 'staff_3', 'potion_big'] },
    { min: 40, max: 51,  pool: ['sword_6', 'armor_6', 'staff_4', 'potion_big', 'sword_5'] },
    { min: 52, max: 64,  pool: ['sword_7', 'armor_6', 'armor_7', 'staff_4', 'potion_big'] },
    { min: 65, max: 79,  pool: ['sword_7', 'sword_8', 'armor_7', 'armor_8', 'staff_5'] },
    { min: 80, max: 92,  pool: ['sword_8', 'sword_9', 'armor_8', 'staff_5', 'staff_6'] },
    { min: 93, max: 100, pool: ['sword_9', 'sword_10', 'sword_11', 'armor_9', 'staff_6', 'staff_7', 'potion_big'] },
  ];

  function floorLootPool(floor) {
    for (const b of LOOT_TABLE) {
      if (floor >= b.min && floor <= b.max) return b.pool;
    }
    return LOOT_TABLE[LOOT_TABLE.length - 1].pool;
  }

// Killed-mob gold scales gently with depth but is CAPPED: once goldMul stops
  // growing (~floor 25) the economy balance point is reached, so later floors
  // keep dropping meaningful coin without the hoard exploding. Goods at the
  // shop must stay a real choice, and selling loot stays deliberately cheap.
  function goldMul(floor) { return 1 + Math.min(floor, 25) * 0.012; }

  // ---------------- Player classes (picked at the menu) ----------------
  const CLASSES = {
    void:    { name: 'Изгой Пустоты', glyph: '🌀', desc: 'Сбалансированный исследователь без бонусов и штрафов.', passive: 'echo', hpMul: 1.0,  mpMul: 1.0,  meleeMul: 1.0,  magicMul: 1.0,  defBonus: 0, crch: 0.10, crd: 1.6, speedMul: 1.35, regen: 1.0 },
    warrior: { name: 'Рубака',        glyph: '⚔️', desc: 'Больше жизни и защиты, сильнее бьёт в ближнем бою, но слабая магия.', passive: 'rage', hpMul: 1.35, mpMul: 0.8, meleeMul: 1.25, magicMul: 0.9, defBonus: 2, crch: 0.05, crd: 1.5, speedMul: 1.30, regen: 1.0 },
    mage:    { name: 'Маг',           glyph: '🔮', desc: 'Больше маны и её регенерации, мощная магия, но хрупкое тело.', passive: 'sorcery', hpMul: 0.80, mpMul: 1.6, meleeMul: 0.75, magicMul: 1.35, defBonus: 0, crch: 0.05, crd: 1.6, speedMul: 1.35, regen: 2.4 },
    rogue:   { name: 'Тень',          glyph: '🗡️', desc: 'Самый быстрый, частые и мощные критические удары, но меньше жизни.', passive: 'shadow', hpMul: 0.85, mpMul: 1.0, meleeMul: 1.10, magicMul: 1.0, defBonus: 0, crch: 0.22, crd: 2.0, speedMul: 1.65, regen: 1.0 },
  };

  // Passive skill hooks, driven by the class. Each returns modifiers that feed
  // logic in game.js; the names surface in the stats screen for clarity.
  const PASSIVES = {
    echo:   { name: 'Эхо Пустоты', desc: 'Кулдауны на 10% короче.', kind: 'cd' },
    rage:   { name: 'Ярость', desc: 'Ниже 35% HP: крит-шанс +15%, ближний бой +20%.', kind: 'rage' },
    sorcery:{ name: 'Чародейство', desc: 'Огненный шар +25% урона, −20% маны.', kind: 'sorcery' },
    shadow: { name: 'Тень', desc: 'Рывок: кулдаун −25%, крит-урон +0.25.', kind: 'shadow' },
  };

    function classKey(p) { return (p && p.cls && CLASSES[p.cls]) ? p.cls : 'void'; }
  function classOf(p) { return CLASSES[classKey(p)]; }
  function passiveOf(p) { return PASSIVES[classOf(p).passive] || null; }
  function speedMult(p) { return classOf(p).speedMul; }

  function lowHp(p) {
    const s = equipmentStats(p);
    return p.hp / Math.max(1, p.maxHp + s.hpBonus) <= 0.35;
  }

  // Melee/magic multipliers (per class); 'rage' low-HP bonus stacks on top.
  function meleeMult(p) {
    let m = classOf(p).meleeMul;
    const pass = passiveOf(p);
    if (pass && pass.kind === 'rage' && lowHp(p)) m *= 1.2;
    return m;
  }
  function magicMult(p) { return classOf(p).magicMul; }

  // Crit chance: base class value + 'rage' survival trigger when at low HP.
  function critChance(p) {
    let c = classOf(p).crch;
    const pass = passiveOf(p);
    if (pass && pass.kind === 'rage' && lowHp(p)) c += 0.15;
    return c;
  }
  // Crit damage: 'shadow' adds extra punch on top of the class roll.
  function critMult(p) {
    let m = classOf(p).crd;
    const pass = passiveOf(p);
    if (pass && pass.kind === 'shadow') m += 0.25;
    return m;
  }
  function manaRegen(p) { return classOf(p).regen; }

  // Ability cooldown multiplier: 'echo' shortens everything, 'shadow' grows
  // smarter dashes so the hit-and-run class pivots faster.
  function cdMult(p, key) {
    const pass = passiveOf(p);
    if (!pass) return 1;
    if (pass.kind === 'echo') return 0.9;
    if (pass.kind === 'shadow' && key === 'dash') return 0.75;
    return 1;
  }

  // ---------------- Player factory ----------------
  function createPlayer(x, y, cls) {
    const c = CLASSES[cls] || CLASSES.void;
    return {
      cls: (CLASSES[cls] ? cls : 'void'),
      difficulty: 'normal', // easy | normal | hard (difficulty presets)
      x, y, radius: 14,
      hp: Math.round(100 * c.hpMul), maxHp: Math.round(100 * c.hpMul),
      mp: Math.round(50 * c.mpMul), maxMp: Math.round(50 * c.mpMul),
      baseAtk: 5,
      def: 0,
      goldMult: 1, // merchant 'gold' upgrades stack into this
      level: 1, xp: 0, xpNext: 40,
      gold: 0, keys: 0, kills: 0,
      weapon: null, armor: null,
      inventory: [], // items held (non-equipped)
      inventoryCap: 12,
      potions: { potion: 0, potion_big: 0 },
      attackDir: 0,
      invuln: 0,
      manaRegenTimer: 0,
      moveSlow: 0,
      lavaT: 0,
      // Soul-knight style combo: consecutive hits build a short streak that
      // feeds crit chance; a dead streak resets it.
      combo: 0, comboT: 0,
      // Second-life charges given by the merchant / at milestone levels.
      revives: 0,
      facing: 1, // 1 = right, -1 = left (for flipping graphic)
      animT: 0,
      dying: false, dead: false,
      // ability cooldowns (sec remaining)
      abilityCd: { strike: 0, whirl: 0, fireball: 0, dash: 0, heal: 0 },
      // state
      attacking: null, // {kind, t, active, dirx, diry} or null
      dashing: null,   // {dirx, diry, t, dist, speed}
      hitFlash: 0,
      // spells known
      unlocked: { whirl: false, fireball: false, dash: false, heal: false },
    };
  }

  // Equipment-derived stats (class def bonus included).
  function equipmentStats(player) {
    let def = 0, hpBonus = 0, mpBonus = 0, minDmg = 0, maxDmg = 0;
    if (player.weapon) {
      if (player.weapon.def) def += player.weapon.def;
      if (player.weapon.hpBonus) hpBonus += player.weapon.hpBonus;
      if (player.weapon.mpBonus) mpBonus += player.weapon.mpBonus;
      minDmg += player.weapon.min || 0;
      maxDmg += player.weapon.max || 0;
    }
    if (player.armor) {
      def += player.armor.def || 0;
      hpBonus += player.armor.hpBonus || 0;
    }
    return { def: def + classOf(player).defBonus, hpBonus, mpBonus, minDmg, maxDmg };
  }

  // Damage roll for a player attack. `kind` is 'melee' / 'magic' / null and
  // applies the class multiplier so each class threatens differently.
  function playerDamageRoll(player, kind) {
    const s = equipmentStats(player);
    let min = s.minDmg + player.baseAtk;
    let max = s.maxDmg + player.baseAtk * 2;
    if (min <= 0) min = 1; if (max < min) max = min;
    const raw = Util.randInt(min, max);
    const cls = classOf(player);
    const m = kind === 'magic' ? cls.magicMul : (kind === 'melee' ? cls.meleeMul : 1);
    return Math.max(1, Math.round(raw * m));
  }

  function scaleEnemy(def, floor) {
    // Separate curves so late floors stay threatening but fair: HP and attack
    // climb noticeably (the early floors are dense now), defense slower so the
    // player's own damage always matters. Tuned for the ~100-floor climb.
    const hpK = 1 + (floor - 1) * 0.13;
    const atkK = 1 + (floor - 1) * 0.11;
    const defK = 1 + (floor - 1) * 0.07;
    return {
      ...def,
      hp: Math.round(def.hp * hpK),
      atk: Math.round(def.atk * atkK),
      def: Math.round(def.def * defK),
      xp: Math.round(def.xp * hpK),
      speed: def.speed * SPEED_SCALE * (def.speedScale || 1),
      radius: def.radius,
    };
  }

  // ---------------- Merchant stock (tier chosen from floor depth) ----------------
  const SHOP_TIERS = [
    { f: 5,  weapons: ['sword_1', 'sword_2', 'staff_1'],    armors: ['armor_1', 'armor_2'], potions: ['potion', 'potion_big'] },
    { f: 10, weapons: ['sword_2', 'sword_3', 'staff_2'],    armors: ['armor_2', 'armor_3'], potions: ['potion_big', 'potion'] },
    { f: 15, weapons: ['sword_3', 'sword_4', 'staff_2'],    armors: ['armor_3', 'armor_4'], potions: ['potion_big'] },
    { f: 20, weapons: ['sword_4', 'sword_5', 'staff_3'],    armors: ['armor_4'],            potions: ['potion_big', 'potion'] },
    { f: 25, weapons: ['sword_4', 'sword_5', 'staff_3'],    armors: ['armor_4', 'armor_5'], potions: ['potion_big'] },
    { f: 30, weapons: ['sword_5', 'sword_6', 'staff_3'],    armors: ['armor_5'],            potions: ['potion_big'] },
    { f: 35, weapons: ['sword_5', 'sword_6', 'staff_4'],    armors: ['armor_5'],            potions: ['potion_big'] },
    { f: 45, weapons: ['sword_6', 'sword_7', 'staff_4'],    armors: ['armor_6'],            potions: ['potion_big'] },
    { f: 55, weapons: ['sword_7', 'sword_8', 'staff_5'],    armors: ['armor_6', 'armor_7'], potions: ['potion_big'] },
    { f: 70, weapons: ['sword_8', 'sword_9', 'staff_5'],    armors: ['armor_7', 'armor_8'], potions: ['potion_big'] },
    { f: 80, weapons: ['sword_9', 'sword_10', 'staff_6'],   armors: ['armor_8'],            potions: ['potion_big'] },
    { f: 90, weapons: ['sword_10', 'sword_11', 'staff_6'],  armors: ['armor_9'],            potions: ['potion_big'] },
    { f: 100, weapons: ['sword_11', 'sword_12', 'staff_7'], armors: ['armor_9', 'armor_10'], potions: ['potion_big'] },
    { f: 110, weapons: ['sword_12', 'sword_12', 'staff_8'], armors: ['armor_10'],           potions: ['potion_big'] },
  ];

  // Buy price = item value scaled with depth so the curve is a gentle ramp,
  // not a wall (sell price is ~45% of value so flipping loot is a poor idea).
  function shopPrice(itemKey, floor) {
    const d = ITEMS[itemKey];
    return Math.max(5, Math.round((d.value || 10) * (1.05 + floor * 0.022)));
  }

  // The merchant always stocks tiers well AHEAD of anything the current floor
  // can drop (+10 floors), and price scaling is built into shopPrice — so
  // spending at his stand stays a genuine upgrade hunt even deep into a run
  // when loot is everywhere (fixes the late-game "money, nothing to buy" drift).
  function shopTier(floor) {
    const want = floor + 10;
    let tier = SHOP_TIERS[0];
    for (const t of SHOP_TIERS) { if (want >= t.f) tier = t; }
    return tier;
  }

  // ---------------- Books (lore pickups, no bag slot) ----------------
  // Land on set floors near the exit, readable in the inventory. The story
  // deepens as the adventurer descends. `textEn` keeps English localised.
  const BOOKS = [
    { floor: 3, key: 'book_1',  glyph: '📕', titleR: 'Дневник первопроходца', titleEn: 'Journal of the First Descender',
      textR: 'Из-под земли пахло гарью ещё до того, как я нашёл колодец. Первую неделю я списывал шёпот на ветер. Вторую — на отсутствие ветра. Совет для тех, кто идёт следом: пишите имена друзей на стенах. Так о них хотя бы кто-то вспомнит.',
      textEn: 'The earth reeked of cinder before I even found the well. First week I blamed the wind for the whispers. The second — on the absence of wind. Advice for those who follow: carve your friends\' names into the walls. So at least someone will remember them.' },
    { floor: 8, key: 'book_2',  glyph: '📗', titleR: 'Анатомия Стража', titleEn: 'Anatomy of a Guardian',
      textR: 'Стражи не рождаются. Их выковывают из тех, кто спустился и не вышел. Десятый этаж — не случайность, это формовочный цех. Если встретишь стража, который знает твоё имя — значит, ты уже в списке.',
      textEn: 'Guardians are not born. They are forged from those who descended and never came back. The tenth floor is no accident — it is the shaping works. If you meet a guard who knows your name, you are already on the list.' },
    { floor: 15, key: 'book_3', glyph: '📙', titleR: 'Рынок Пустоты', titleEn: 'The Void Market',
      textR: 'Говорят, торговцу триста лет. Другой слух — что он триста лет, и все они были вчера. Он скупает золото, которое здесь теряет цену, и платит предметами, которые его держат. Никогда не спрашивай, где он берёт товар. Один мой товарищ спросил. Его шляпа до сих пор висит на его месте.',
      textEn: 'They say the merchant is three hundred years old. Another rumour — that he is three hundred years, all of them yesterday. He buys the gold that loses value here and pays with goods that hold it. Never ask where he gets his stock. A friend of mine asked. His hat still hangs on the stand.' },
    { floor: 22, key: 'book_4', glyph: '📘', titleR: 'Книга обрядов', titleEn: 'The Book of Rites',
      textR: 'Пустота почитает тишину. Посредники молятся шёпотом, жрецы — в неподвижности. Когда услышишь хор без единого голоса — знай: обряд уже начался, и ты его гость.',
      textEn: 'The void honours silence. Intermediaries pray in whispers, priests — in stillness. When you hear a chorus without a single voice, know the rite has already begun — and you are its guest.' },
    { floor: 30, key: 'book_5', glyph: '📕', titleR: 'Песнь воды и огня', titleEn: 'Song of Water and Fire',
      textR: 'Вода просачивается вниз сквозь трещины и помнит все этажи насквозь. Огонь же рвётся вверх и ничего не помнит. Поэтому вода медленна, а огонь неистов. Осторожнее: ледяные залы когда-то были залом огненных недр. Камень помнит, даже когда пламя уходит.',
      textEn: 'Water seeps down through the cracks and remembers every floor it passes. Fire lunges upward and remembers nothing. That is why water is slow and fire is furious. Be careful: the frozen halls were once the halls of fiery depths. Stone remembers even when the flame leaves.' },
    { floor: 40, key: 'book_6', glyph: '📗', titleR: 'Морозные залы', titleEn: 'The Frosted Halls',
      textR: 'Лёд здесь — не холод. Это застывшее время. Страж, которого ты победишь в этих залах, на самом деле пал сотни лет назад, а ты увидел его последний удар с опозданием на века. Не обольщайся: время внизу идёт по своим законам.',
      textEn: 'The ice here is not cold. It is frozen time. The guard you defeat in these halls actually fell centuries ago; you simply witnessed his final blow delayed by ages. Do not be fooled: time below follows its own laws.' },
    { floor: 50, key: 'book_7', glyph: '📙', titleR: 'Срединная отметка', titleEn: 'The Halfway Mark',
      textR: 'Полпути. Те, кто доходят сюда, обычно делятся на два типа: боящиеся, что дальше хуже, и боящиеся, что дальше лучше. Вторых пока не встречали выше этажа 65. Ещё заметка: свет сверху здесь — лишь воспоминание. Бери теплее.',
      textEn: 'Halfway. Those who reach here usually split into two: those who fear it gets worse, and those who fear it gets better. The latter were never seen above floor 65. One more note: the light above is only a memory here. Dress warmer.' },
    { floor: 62, key: 'book_8', glyph: '📘', titleR: 'Голоса в костях', titleEn: 'Voices in the Bones',
      textR: 'Костное поле — не поле битвы. Это кладбище идей. Каждая кость принадлежала существу, которое Пустота когда-то выдумала, а потом раздумала воплотить. Здесь слышно, как гасят целые виды: это похоже на выдох, который ждал вечность.',
      textEn: 'The bone field is not a battlefield. It is a graveyard of ideas. Every bone belonged to a creature the void once imagined, then un-imagined. Here you can hear an entire species being cancelled. It sounds like an exhalation that waited an eternity.' },
    { floor: 75, key: 'book_9', glyph: '📕', titleR: 'Шепчущая книга', titleEn: 'The Whispering Codex',
      textR: 'Глубины больше не прячут то, что движется между этажами. Щитоносцы и тараны идут без крика — они просто знают, где ты появишься, потому что внизу все дороги ведут на дно. Это не слежка. Это геометрия.',
      textEn: 'The depths no longer hide what moves between floors. Shieldbearers and rams charge wordlessly — they simply know where you will appear, because down here all roads lead to the bottom. It is not surveillance. It is geometry.' },
    { floor: 88, key: 'book_10', glyph: '📗', titleR: 'Последние врата', titleEn: 'The Last Gate',
      textR: 'За девяностым этажом заканчиваются этажи и начинаются дво́ры. Камень здесь помнит шаги Повелителя, потому что он ходил по этим залам до того, как стало, что запоминать. Если чувствуешь, что стены смотрят на тебя — имей в виду: они действительно смотрят.',
      textEn: 'Past the ninetieth floor, floors end and courts begin. The stone here remembers the Lord\'s steps because he walked these halls before there was anything to remember. If you feel the walls watching you — keep in mind: they genuinely are.' },
    { floor: 96, key: 'book_11', glyph: '📙', titleR: 'Пророчество Бездны', titleEn: 'Prophecy of the Abyss',
      textR: '«Придёт тот, кто не носит имени, и спустится без спросу. И едрит Повелителя на его собственном пороге, и последняя лестница кончится». Переводчик душ выхватил эти строки у того, кто знал. Он больше не переводит.',
      textEn: '"One who bears no name shall come and descend uninvited. And shall fell the Lord upon his own threshold, and the last stair shall end." The soul herald snatched these lines from one who knew. It does not translate anymore.' },
  ];

  // Difficulty presets (player-facing labels live in Lang; enemies/gold here).
  const DIFFICULTY = {
    easy:   { name: 'Лёгкий',   enmHp: 0.8,  enmDmg: 0.8,  gold: 1.3 },
    normal: { name: 'Нормальный', enmHp: 1,  enmDmg: 1,    gold: 1 },
    hard:   { name: 'Сложный',  enmHp: 1.35, enmDmg: 1.3,  gold: 0.8 },
  };

  function bookForFloor(floor) {
    return BOOKS.find((b) => b.floor === floor) || null;
  }

  return { ENEMIES, FLOOR_ENEMIES, floorEnemyPool, ABILITIES, ITEMS, LOOT_TABLE, floorLootPool, goldMul,
           SPEED_SCALE, ENEMY_PACE,
           CLASSES, PASSIVES, SHOP_TIERS, shopPrice, shopTier,
           BOOKS, bookForFloor, DIFFICULTY,
           createPlayer, equipmentStats, playerDamageRoll, scaleEnemy,
           classKey, classOf, passiveOf, speedMult, meleeMult, magicMult, critChance, critMult, manaRegen,
           cdMult };
})();