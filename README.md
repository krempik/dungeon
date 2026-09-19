# Dungeon — Бездна (tactical canvas roguelike)

A browser roguelike built with vanilla HTML5 Canvas + JS, no build step and no
runtime dependencies. Descend the ~100 floors of the void, fight through a
procedural cave system, buy better gear from the merchant, collect lore books
and kill the Lord of the Abyss.

## Run

Open `index.html` in any modern browser. The game is also deployed on GitHub
Pages: `<your-org>.github.io/dungeon/`.

No server needed — the whole game runs client-side and saves to `localStorage`.

## Test

Pure logic modules live in `js/`:

* `js/util.js` — seeded RNG (`mulberry32`), shared math helpers.
* `js/worldgen.js` — deterministic cellular-automata cave generation + floor
  themes. All randomness flows from a seeded stream; same `(floor, seed)` in,
  same map out.
* `js/entities.js` — enemies, items, classes, shop, books and the economy.

The simulation is pure and deterministically seeded, so these modules run
headless under Node's `vm` with no DOM:

```sh
node tools/run_tests.js
```

The harness covers seeded determinism, map invariants (tile vocabulary, w*h
sizing, per-floor spawning), data-table sanity (enemy/floor pools, books on
unique floors), and bounded damage rolls. It also asserts the `GAME_VERSION`
constant in `game.js` matches the `VERSION` file so release and UI never drift.

## Layout

```
index.html            entry; loads js/i18n.js, js/util.js, js/worldgen.js,
                      js/entities.js, js/game.js, js/ui.js
js/                   all logic + rendering (vanilla, no frameworks)
css/                  styling
tools/run_tests.js    node vm test harness (see above)
VERSION               single source of truth for the release version
```

## License

MIT.