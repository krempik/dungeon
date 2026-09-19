/* tools/run_tests.js — headless logic tests for the pure simulation modules.
 *
 * Loads util.js, worldgen.js and entities.js into an isolated vm context and
 * runs deterministic unit tests: seeded RNG reproducibility, map invariants
 * and data-table sanity. No DOM, no browser.
 *
 * The test bodies live in buildSpec() so the SAME assertions also run in a
 * browser via tools/run_tests_browser.html (useful where node is missing).
 *
 * Run: node tools/run_tests.js   (exit 0 = all green, 1 = failures)
 */
'use strict';

const hasNode = typeof require === 'function' && typeof module !== 'undefined';
let fs, path, vm;
if (hasNode) {
  fs = require('fs');
  path = require('path');
  vm = require('vm');
}

const JS_DIR = hasNode ? path.join(__dirname, '..', 'js') : 'js';
const REPO_ROOT = hasNode ? path.join(__dirname, '..') : '.';

function buildSpec(hooks) {
  const expr = hooks.expr;
  const set = hooks.set;
  const cases = [];

  function check(name, fn) {
    cases.push({ name, fn });
  }
  function eq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error((label || 'values differ') +
        '\n      expected ' + b + '\n      actual   ' + a);
    }
  }
  function ok(value, msg) {
    if (!value) throw new Error(msg || 'expected truthy');
  }

  const TILE = expr('WorldGen.TILE');

  // ---------------------------- version ----------------------------
  check('version: game.js GAME_VERSION matches VERSION file', () => {
    let ver;
    try {
      ver = hooks.read('VERSION').trim();
    } catch (err) {
      return; // node-only (no filesystem in browser)
    }
    const src = fs.readFileSync(path.join(JS_DIR, 'game.js'), 'utf8');
    const m = src.match(/const GAME_VERSION\s*=\s*'([^']+)'/);
    ok(m, 'GAME_VERSION constant not found in game.js');
    eq(m[1], ver, 'game.js GAME_VERSION must equal the VERSION file');
  });

  // ---------------------------- WorldGen ----------------------------
  check('worldgen: makeFloorData deterministic per (floor, seed)', () => {
    eq(
      expr('WorldGen.makeFloorData(7, 12345)'),
      expr('WorldGen.makeFloorData(7, 12345)'),
      'same seed must produce identical map'
    );
  });

  check('worldgen: different seeds produce different maps', () => {
    const a = JSON.stringify(expr('WorldGen.makeFloorData(5, 1)'));
    const b = JSON.stringify(expr('WorldGen.makeFloorData(5, 987654321)'));
    if (a === b) throw new Error('different seeds produced identical maps');
  });

  check('worldgen: tile array matches w*h and holds only known tiles', () => {
    const m = expr('WorldGen.makeFloorData(1, 424242)');
    ok(m.tiles.length === m.w * m.h, 'tile count must equal w*h');
    const seen = new Set(m.tiles);
    for (const t of seen) {
      ok(Object.values(TILE).includes(t), 'unknown tile value ' + t);
    }
  });

  check('worldgen: every floor has floor, wall, and a walkable spawn area', () => {
    for (let floor = 1; floor <= 100; floor += 11) {
      const m = expr('WorldGen.makeFloorData(' + floor + ', 777)');
      let hasFloor = false;
      let hasWall = false;
      for (const t of m.tiles) {
        if (t === TILE.FLOOR) hasFloor = true;
        if (t === TILE.WALL) hasWall = true;
      }
      ok(hasFloor, 'floor ' + floor + ': no FLOOR tile');
      ok(hasWall, 'floor ' + floor + ': no WALL tile (map fully open?)');
      const pad = 4;
      let hasWalk = false;
      for (let y = pad; y < m.h - pad && !hasWalk; y++) {
        for (let x = pad; x < m.w - pad && !hasWalk; x++) {
          if (m.walkable[y * m.w + x]) hasWalk = true;
        }
      }
      ok(hasWalk, 'floor ' + floor + ': no walkable interior cell');
    }
  });

  check('worldgen: floorTheme/floorName stable and valid', () => {
    const a = expr('WorldGen.floorTheme(37, 2024)');
    const b = expr('WorldGen.floorTheme(37, 2024)');
    eq(a, b, 'same (floor, seed) must pick same theme');
    ok(Array.isArray(a.theme.floor) && a.theme.floor.length >= 1, 'theme needs floor colors');
    ok(typeof expr('WorldGen.floorName(37, 2024)') === 'string', 'floorName must be a string');
  });

  check('worldgen: randomFloorSpot lands on a walkable tile', () => {
    const m = expr('WorldGen.makeFloorData(3, 99)');
    set('testTiles', Array.from(m.tiles));
    const spot = expr('WorldGen.randomFloorSpot(' +
      'testTiles, ' + m.w + ', ' + m.h + ', Util.mulberry32(777), 4)');
    ok(Array.isArray(spot) && spot.length === 2, 'spot must be [x, y]');
    ok(spot[0] >= 0 && spot[0] < m.w && spot[1] >= 0 && spot[1] < m.h, 'spot out of bounds');
    ok(m.walkable[spot[1] * m.w + spot[0]] === 1, 'spot must be walkable');
  });

  // ---------------------------- Entities ----------------------------
  check('entities: floorEnemyPool clamps at both ends and only pays known keys', () => {
    const a = expr('Entities.floorEnemyPool(1)');
    const b = expr('Entities.floorEnemyPool(100)');
    ok(a.length > 0, 'floor 1 pool empty');
    ok(b.length > 0, 'floor 100 pool empty');
    const keys = expr('Object.keys(Entities.ENEMIES)');
    for (const k of a.concat(b)) {
      ok(keys.includes(k), 'unknown enemy key ' + k);
    }
  });

  check('entities: scaleEnemy scales hp/atk upward with depth', () => {
    const def = expr('Entities.ENEMIES["skeleton"]');
    const low = expr('Entities.scaleEnemy(Entities.ENEMIES["skeleton"], 1)');
    const high = expr('Entities.scaleEnemy(Entities.ENEMIES["skeleton"], 30)');
    ok(low.hp >= def.hp, 'floor 1 hp below base def hp');
    ok(low.atk > 0 && low.def >= 0, 'floor 1 stats invalid');
    ok(high.hp > low.hp, 'floor 30 hp must exceed floor 1 hp');
    ok(high.atk > low.atk, 'floor 30 atk must exceed floor 1 atk');
    ok(high.speed > 0, 'scaled speed must stay positive');
  });

  check('entities: goldMul ramps with depth', () => {
    eq(expr('Entities.goldMul(1)'), 1.012, 'floor 1 multiplier follows the base ramp');
    ok(expr('Entities.goldMul(50)') > expr('Entities.goldMul(10)'), 'gold must scale up');
    eq(expr('Entities.goldMul(999)'), 1 + 25 * 0.012, 'gold ramps are capped at depth 25');
  });

  check('entities: shop tiers and prices', () => {
    const t5 = expr('Entities.shopTier(5)');
    const t100 = expr('Entities.shopTier(100)');
    ok(t5.weapons.length >= 1 && t100.weapons.length >= 1, 'empty shop stock');
    ok(expr('Entities.shopPrice("sword_1", 30)') > expr('Entities.shopPrice("sword_1", 5)'),
       'price must rise with floor');
    ok(expr('Entities.shopPrice("sword_1", 5)') >= 5, 'price must floor at 5');
  });

  check('entities: books live on their exact floors only', () => {
    const b3 = expr('Entities.bookForFloor(3)');
    ok(b3 && b3.key === 'book_1', 'book_1 must sit on floor 3');
    eq(expr('Entities.bookForFloor(4)'), null, 'no book on floor 4');
    const all = expr('Entities.BOOKS');
    const floors = all.map((b) => b.floor);
    eq(floors, [...new Set(floors)], 'book floors must be unique');
  });

  check('entities: classes, passives and equipment math', () => {
    ok(expr('Entities.classKey({})') === 'void', 'unknown class must fall back to void');
    const p = expr('Entities.createPlayer(10, 10, "mage")');
    ok(p.cls === 'mage' && p.hp < 100 && p.maxMp > 50, 'mage stat multipliers applied');
    eq(expr('Entities.classOf({ cls: "warrior" }).hpMul'), 1.35, 'warrior hpMul');
    eq(expr('Entities.passiveOf(Entities.createPlayer(0, 0, "rogue")).kind'), 'shadow', 'rogue passive');
    const s = expr('Entities.equipmentStats({ cls: "warrior", weapon: { min: 6, max: 11 } })');
    eq(s.minDmg, 6, 'equip minDmg');
    eq(s.maxDmg, 11, 'equip maxDmg');
    eq(s.def, 2, 'warrior defBonus counts from class');
  });

  check('entities: playerDamageRoll stays within rolled bounds', () => {
    const p = expr('Entities.createPlayer(0, 0, "warrior")');
    set('testPlayer', JSON.parse(JSON.stringify(p)));
    let worstMax = 0;
    for (let i = 0; i < 200; i++) {
      const d = expr('Entities.playerDamageRoll(testPlayer, "melee")');
      ok(d >= 1, 'damage must be >= 1 (got ' + d + ')');
      if (d > worstMax) worstMax = d;
    }
    ok(worstMax <= 13, 'warrior base melee roll bounded by (10 * 1.25) = 12.5 -> 13 (got ' + worstMax + ')');
  });

  return cases;
}

function run(cases) {
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    try {
      c.fn();
      pass++;
      console.log('ok    ' + c.name);
    } catch (err) {
      fail++;
      console.log('FAIL  ' + c.name + '\n      ' + (err && err.stack || err));
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  return { pass, fail };
}

// Browser backdoor: expose the spec builder so run_tests_browser.html can run
// the identical assertions without needing node/require.
if (hasNode) {
  module.exports = { buildSpec, run };
} else {
  globalThis.dungeonSpec = { buildSpec, run };
}

// Node entry point.
if (hasNode && require.main === module) {
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    performance: { now: () => 0 },
  };
  vm.createContext(sandbox);

  const hooks = {
    expr: (src) => vm.runInContext(src, sandbox),
    set: (name, value) => vm.runInContext('(' + name + ' = ' + JSON.stringify(value) + ')', sandbox),
    read: (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'),
  };

  const MODULES = ['util.js', 'worldgen.js', 'entities.js'];
  for (const f of MODULES) {
    try {
      vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: 'js/' + f });
    } catch (err) {
      console.error('LOAD FAIL ' + f + '\n' + (err && err.stack || err));
      process.exit(1);
    }
  }

  const { pass, fail } = run(buildSpec(hooks));
  process.exit(fail === 0 ? 0 : 1);
}