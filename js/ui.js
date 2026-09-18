/* ui.js — DOM HUD, panels, toasts, hotbar, minimap (all data via textContent). */
'use strict';

const UI = (() => {
  let panel, overlay, banner, toastWrap;

  // Cached HUD element refs (avoid querySelector on the hot frame path).
  let barHpFill, barHpText, barMpFill, barMpText, barXpFill, barXpText;
  let statLevel, statGold, statFloor, statKills;
  let btnSound, btnMusic;
  let slotAbilities, slotPotions, minimap;

  // Throttle clock for the heavier hotbar/minimap redraws (declared up top).
  let lastSlowUpdate = 0;

  function init() {
    panel = document.getElementById('panel');
    overlay = document.getElementById('overlay');
    banner = document.getElementById('banner');
    toastWrap = document.getElementById('toast-wrap');

    barHpFill = document.querySelector('#bar-hp .bar-fill');
    barHpText = document.querySelector('#bar-hp .bar-text');
    barMpFill = document.querySelector('#bar-mp .bar-fill');
    barMpText = document.querySelector('#bar-mp .bar-text');
    barXpFill = document.querySelector('#bar-xp .bar-fill');
    barXpText = document.querySelector('#bar-xp .bar-text');
    statLevel = document.querySelector('[data-stat="level"]');
    statGold = document.querySelector('[data-stat="gold"]');
    statFloor = document.querySelector('[data-stat="floor"]');
    statKills = document.querySelector('[data-stat="kills"]');
    btnSound = document.getElementById('btn-sound');
    btnMusic = document.getElementById('btn-music');
    slotAbilities = document.getElementById('slot-abilities');
    slotPotions = document.getElementById('slot-potions');
    minimap = document.getElementById('minimap');

    setStat(statLevel, 0, '');
    setStat(statGold, 0, '');
    setStat(statFloor, 0, '');
    setStat(statKills, 0, '');

    btnSound.addEventListener('click', () => {
      AudioSystem.setMuted(!AudioSystem.muted);
      renderSoundBtns();
    });
    btnMusic.addEventListener('click', () => {
      AudioSystem.setMusicOn(!AudioSystem.musicOn);
      renderSoundBtns();
    });
  }

  function renderSoundBtns() {
    btnSound.textContent = AudioSystem.muted ? '🔇' : '♪';
    btnMusic.textContent = AudioSystem.musicOn ? '♫' : '🔈';
    btnSound.classList.toggle('off', AudioSystem.muted);
    btnMusic.classList.toggle('off', !AudioSystem.musicOn);
  }

  // Bind a label + bold number into a stat element (safe, no innerHTML string concat).
  function setStat(el, value, label) {
    el.textContent = '';
    if (label) el.append(label);
    el.append(bold(value));
  }

  function updateHUD() {
    const p = Game.player;
    if (!p) return;
    const s = Entities.equipmentStats(p);
    const effMaxHp = p.maxHp + s.hpBonus;
    const effMaxMp = p.maxMp + s.mpBonus;

    fillBar(barHpFill, barHpText, p.hp, effMaxHp);
    fillBar(barMpFill, barMpText, p.mp, effMaxMp);
    fillBar(barXpFill, barXpText, p.xp, p.xpNext);

    setStat(statLevel, p.level, 'Ур. ');
    setStat(statGold, p.gold, 'Золото: ');
    if (Game.floor === 0) setStat(statFloor, Lang.t('Приют'), '');
    else setStat(statFloor, Game.floor, Lang.t('Этаж') + ': ');
    setStat(statKills, p.kills, 'Убийств: ');

    // Hotbar cooldown overlay + minimap are heavier; throttle to ~5 Hz.
    const now = performance.now();
    if (now - lastSlowUpdate > 200) {
      lastSlowUpdate = now;
      renderHotbar();
      renderMinimap();
    }
  }

  function bold(v) {
    const b = document.createElement('b');
    b.textContent = v;
    return b;
  }

  function fillBar(fill, text, cur, max) {
    const pct = Math.max(0, Math.min(1, cur / max));
    fill.style.transform = `scaleX(${pct})`;
    text.textContent = `${Math.ceil(cur)} / ${max}`;
  }

  // ---------- Hotbar ----------
  function renderHotbar() {
    const ab = slotAbilities;
    ab.textContent = '';
    const player = Game.player;
    const list = [['strike', null], ['whirl', 'whirl'], ['fireball', 'fireball'], ['dash', 'dash'], ['heal', 'heal']];
    for (const [abilKey, unlockKey] of list) {
      const def = Entities.ABILITIES[abilKey];
      if (unlockKey && !player.unlocked[unlockKey]) continue;
      const slot = document.createElement('div');
      slot.className = 'slot';
      if (player.abilityCd[abilKey] > 0) {
        const pct = player.abilityCd[abilKey] / def.cd;
        const cd = document.createElement('div');
        cd.className = 'cd';
        cd.style.height = (pct * 100) + '%';
        cd.textContent = `${(player.abilityCd[abilKey]).toFixed(0)}`;
        slot.appendChild(cd);
      }
      slot.appendChild(sp('key', def.key));
      slot.append(def.glyph);
      // mana cost tag
      if (def.mp > 0) {
        const cost = document.createElement('span');
        cost.className = 'count';
        cost.style.color = player.mp >= def.mp ? '#5ca2ff' : '#ff3b5c';
        cost.textContent = def.mp;
        slot.appendChild(cost);
      }
      slot.title = def.name + ' — ' + def.desc;
      ab.appendChild(slot);
    }

    // Potions
    const pots = slotPotions;
    pots.textContent = '';
    const pOrder = [['potion', '🧪', 'Q'], ['potion_big', '⚗️', 'E']];
    for (const [key, glyph, hotkey] of pOrder) {
      const n = player.potions[key];
      const slot = document.createElement('div');
      slot.className = 'slot pot';
      slot.appendChild(sp('key', hotkey));
      slot.append(glyph);
      const cnt = document.createElement('span');
      cnt.className = 'count';
      cnt.textContent = n;
      slot.appendChild(cnt);
      slot.title = Entities.ITEMS[key].name + ' (' + hotkey + ')';
      slot.style.opacity = n > 0 ? 1 : 0.3;
      pots.appendChild(slot);
    }
  }

  function sp(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  // ---------- Minimap ----------
  function renderMinimap() {
    const c = minimap;
    const ctx = c.getContext('2d');
    // Size the backing store by the CSS box times DPR (multiplied, not
    // divided) so the minimap stays crisp on HiDPI screens.
    const dpr = window.devicePixelRatio || 1;
    const box = c.getBoundingClientRect();
    const wp = Math.max(8, Math.round(box.width * dpr));
    const hp = Math.max(8, Math.round(box.height * dpr));
    if (c.width !== wp) c.width = wp;
    if (c.height !== hp) c.height = hp;
    const w = Game.world.w, h = Game.world.h;
    const size = wp / Math.max(w, h);
    ctx.clearRect(0, 0, wp, hp);
    ctx.fillStyle = 'rgba(5,4,12,0.8)';
    ctx.fillRect(0, 0, wp, wp);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!Game.explored[y * w + x]) continue;
        const t = Game.world.tiles[y * w + x];
        let col;
        if (t === 1) col = '#3a3a52';
        else if (t === 2) col = '#1a1a28';
        else col = '#0e0e1c';
        ctx.fillStyle = col;
        ctx.fillRect(x * size, y * size, Math.ceil(size), Math.ceil(size));
      }
    }
    // Player dot (world pixel coords -> tile coords for minimap grid).
    ctx.fillStyle = '#5ce1e6';
    ctx.beginPath();
    ctx.arc((Game.player.x / 24) * size, (Game.player.y / 24) * size, Math.max(2, size * 1.2), 0, Math.PI * 2);
    ctx.fill();
    // Boss / guardian dot
    for (const e of Game.world.enemies) {
      if (e.isBoss || e.isGuardian) {
        ctx.fillStyle = '#ff3b5c';
        ctx.beginPath();
        ctx.arc((e.x / 24) * size, (e.y / 24) * size, Math.max(2, size), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Exit dot
    for (const ex of Game.world.exits) {
      ctx.fillStyle = ex.boss ? '#ff3b5c' : '#5ce1e6';
      ctx.fillRect((ex.x / 24) * size - 1.5, (ex.y / 24) * size - 1.5, 3, 3);
    }
  }

  // ---------- Toasts ----------
  function toast(msg, cls, dur) {
    const t = document.createElement('div');
    t.className = 'toast ' + (cls || '');
    t.textContent = msg;
    toastWrap.appendChild(t);
    // Story captions stay up long enough to actually be read; others tick by
    // quickly so they never stack.
    setTimeout(() => t.remove(), dur || 3200);
  }

  // ---------- Banner ----------
  function showBanner(text, sub) {
    banner.textContent = text + (sub ? (' — ' + sub) : '');
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  // ---------- Panels ----------
  function showPanel(html) {
    overlay.classList.remove('hidden');
    panel.classList.remove('menu-panel');
    // Panel content is built from trusted static templates only; use the raw.
    panel.innerHTML = html;
  }

  function hidePanel() {
    overlay.classList.add('hidden');
  }

  function openMenu() {
    const canContinue = Save.load() !== null;
    showPanel(`
      <div class="centered">
        <div class="logo-wrap"><canvas id="menu-logo" width="64" height="64"></canvas></div>
        <h1>DUNGEON&nbsp;OF&nbsp;THE&nbsp;VOID</h1>
        <div style="font-size:12px;color:#8f87b0;margin-top:4px;letter-spacing:2px">v${Game.GAME_VERSION || '1.0.0'}</div>
        <p>${Lang.t('Потусторонний данджон-краулер. Сначала загляни в Приют Пустоты — выбери класс у героев, затем спускайся через дверь наверху. Торговец заглядывает на каждый 5-й этаж (5, 10, 15...), а на каждый 10-й (10, 20, 30...) тебя ждёт Страж Пустоты.')}</p>
      </div>
      <div class="btn-row" style="flex-direction:column;gap:6px;">
        <button class="btn primary" id="menu-new" type="button" style="padding:14px 0;font-size:17px;">${Lang.t('Играть')}</button>
        ${canContinue ? `<button class="btn" id="menu-continue" type="button" style="padding:12px 0;font-size:15px;">${Lang.t('Продолжить')}</button>` : ''}
        <button class="btn" id="menu-settings" type="button" style="padding:10px 0;font-size:14px;">${Lang.t('Настройки')}</button>
      </div>
      <div class="menu-tip">${Lang.t('Прогресс сохраняется автоматически в локальном хранилище.')}</div>
    `);
    panel.classList.add('menu-panel');
    // Draw the hero pixel-art logo onto the menu canvas.
    requestAnimationFrame(() => {
      const logoCanvas = document.getElementById('menu-logo');
      if (logoCanvas) {
        const g = logoCanvas.getContext('2d');
        g.imageSmoothingEnabled = false;
        Art.draw(g, 'hero', '#5ca2ff', 32, 32, 28, 1);
      }
    });
    const newBtn = document.getElementById('menu-new');
    newBtn.addEventListener('click', () => {
      AudioSystem.resume();
      Game.newGame();
    });
    const contBtn = document.getElementById('menu-continue');
    if (contBtn) {
      contBtn.addEventListener('click', () => {
        AudioSystem.resume();
        Game.loadGame();
      });
    }
    const setBtn = document.getElementById('menu-settings');
    setBtn.addEventListener('click', () => { AudioSystem.sfx.ui(); openSettings(); });
    Game.setPausedMenu(true);
  }

  // Settings: language, sound/music toggles and a shortcut to the controls
  // primer. Rerenders after each change so labels always reflect state.
  function openSettings() {
    const isEn = Lang.isEn && Lang.isEn();
    const muted = (typeof AudioSystem.muted === 'boolean') ? AudioSystem.muted : false;
    const music = (typeof AudioSystem.musicOn === 'boolean') ? AudioSystem.musicOn : true;
    showPanel(`
      <div class="centered">
        <h1>${Lang.t('Настройки')}</h1>
      </div>
      <h2>${Lang.t('Язык')}</h2>
      <div class="btn-row">
        <button class="btn${isEn ? '' : ' primary'}" id="set-lang-ru" type="button">Русский</button>
        <button class="btn${isEn ? ' primary' : ''}" id="set-lang-en" type="button">English</button>
      </div>
      <h2>${Lang.t('Звук')}</h2>
      <div class="btn-row">
        <button class="btn" id="set-sound" type="button">${Lang.t('Звук')}: ${muted ? Lang.t('выкл') : Lang.t('вкл')}</button>
        <button class="btn" id="set-music" type="button">${Lang.t('Музыка')}: ${music ? Lang.t('вкл') : Lang.t('выкл')}</button>
      </div>
      <h2>${Lang.t('Как играть?')}</h2>
      <button class="btn" id="set-howto" type="button" style="width:100%;margin:6px 0;">${Lang.t('Как играть?')}</button>
      <div class="btn-row">
        <button class="btn" id="set-back" type="button">${Lang.t('Назад')}</button>
      </div>
    `);
    const wire = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => { AudioSystem.sfx.ui(); fn(); });
    };
    wire('set-lang-ru', () => { Lang.set('ru'); openSettings(); });
    wire('set-lang-en', () => { Lang.set('en'); openSettings(); });
    wire('set-sound', () => { if (AudioSystem.setMuted) AudioSystem.setMuted(!muted); openSettings(); });
    wire('set-music', () => { if (AudioSystem.setMusicOn) AudioSystem.setMusicOn(!music); openSettings(); });
    wire('set-howto', () => openHowTo());
    wire('set-back', () => openMenu());
  }

  // Full controls/gameplay primer, reachable from the main menu.
  function openHowTo() {
    const p = Game.player;
    const revives = p && p.revives ? p.revives : 0;
    showPanel(`
      <div class="centered">
        <h1>Как играть</h1>
      </div>
      <ul class="feats">
        <li><kbd>WASD</kbd>/стрелки — движение</li>
        <li><kbd>ЛКМ</kbd> (зажать) — бить в направлении мыши</li>
        <li><kbd>1</kbd>—удар, <kbd>2</kbd>—вихрь, <kbd>3</kbd>—огненный шар, <kbd>Ctrl</kbd>—рывок, <kbd>4</kbd>—лечение (HP за ману)</li>
        <li><kbd>Shift</kbd> — удержание: блок (снижает урон)</li>
        <li><kbd>Q</kbd>/<kbd>E</kbd> — выпить зелье (малое/большое)</li>
        <li><kbd>F</kbd> — поговорить с торговцем</li>
        <li><kbd>I</kbd> — инвентарь и экипировка</li>
        <li><kbd>C</kbd> — характеристики</li>
        <li><kbd>Esc</kbd> — меню / закрыть</li>
        <li><kbd>F5</kbd> — сохранить вручную</li>
      </ul>
      <ul class="feats">
        <li>Удерживай атаку — каждый удар кормит <b>комбо</b>: при 5 и 10 ударах крит-шанс растёт.</li>
        <li>Вода замедляет, лава поджигает — и тебя, и врагов.</li>
        <li>Респавн на этаже больше не бесплатный: заряды «второй жизни» дают торговец и уровни ×15.</li>
        <li>Продавай хлам торговцу за 30% цены — копи валюту на постоянные улучшения.</li>
      </ul>
      <div class="btn-row centered">
        <button class="btn" id="howto-back">${Lang.t('Назад')}</button>
      </div>
    `);
    document.getElementById('howto-back').addEventListener('click', () => UI.openSettings());
  }

  function openDeath() {
    const p = Game.player;
    const revives = p && p.revives ? p.revives : 0;
    showPanel(`
      <div class="centered">
        <div class="hero-emoji">💀</div>
        <h1>Ты погиб</h1>
        <p>Тьма поглотила тебя на этаже ${Game.floor}. Повелитель Пустоты ждёт.
        ${revives > 0
          ? `Амулет ${'❤️‍🔥'.repeat(Math.min(revives, 3))} второй жизни всё ещё тёплый в твоей руке…`
          : 'Возвращения на этаж больше нет — только амулет второй жизни (его продаёт торговец и дарит судьба на уровнях ×15).'}</p>
      </div>
      <div class="btn-row centered">
        ${revives > 0 ? `<button class="btn primary" id="death-revive">Вторая жизнь (${revives})</button>` : ''}
        <button class="btn" id="death-menu">В меню</button>
      </div>
    `);
    const revBtn = document.getElementById('death-revive');
    if (revBtn) revBtn.addEventListener('click', () => {
      AudioSystem.resume();
      Game.revive();
    });
    document.getElementById('death-menu').addEventListener('click', () => UI.openMenu());
  }

  function openInventory() {
    const p = Game.player;
    const cls = Entities.CLASSES[Entities.classKey(p)];
    const s = Entities.equipmentStats(p);
    let html = `<h1>Инвентарь</h1>`;
    html += `<p>Класс: <b>${cls.glyph} ${cls.name}</b> · Золото: <b>${p.gold}</b> · Ключи: <b>${p.keys}</b></p>`;
    html += `<h2>Экипировка</h2>`;
    html += `<p>Оружие: ${p.weapon ? itemHtml(p.weapon) : '— нет —'}</p>`;
    html += `<p>Броня: ${p.armor ? itemHtml(p.armor) : '— нет —'}</p>`;
    html += `<p>Суммарно: урон ~${s.minDmg + p.baseAtk}–${s.maxDmg + p.baseAtk * 2}, защита ${s.def}, +${s.hpBonus} HP, +${s.mpBonus} мана</p>`;
    html += `<h2>Сумка (${p.inventory.length}/${p.inventoryCap})</h2>`;
    if (p.inventory.length === 0) html += `<p>Пусто. Добывай предметы с врагов.</p>`;
    for (let i = 0; i < p.inventory.length; i++) {
      const item = p.inventory[i];
      html += `<div class="inv-row" style="border:1px solid #3a2f6b;border-radius:6px;padding:8px;margin:4px 0;display:flex;justify-content:space-between;align-items:center;" data-idx="${i}">
        <span>${itemHtml(item)}</span>
        <span>
          ${item.kind === 'weapon' || item.kind === 'armor' ? `<button class="btn" data-equiv="${i}">Экипировать</button>` : ''}
          <button class="btn danger" data-drop="${i}">Выбросить</button>
        </span>
      </div>`;
    }
    html += `<p class="menu-tip">Продать собранные вещи можно только у торговца (каждый 5-й этаж, начиная с 5-го).</p>`;
    const books = p.books || [];
    html += `<h2>Книги (${books.length})</h2>`;
    if (books.length === 0) {
      html += `<p>Пока не найдено ни одной книги. Они прячутся на отдельных этажах — читай, чтобы узнать историю Преисподней.</p>`;
    } else {
      html += `<div class="menu-tip">Прочитанные книги открываются в инвентаре — нажми «Читать».</div>`;
      for (let i = 0; i < books.length; i++) {
        const b = books[i];
        const isEn = Lang.isEn && Lang.isEn();
        const displayName = isEn ? (b.titleEn || b.titleR) : (b.titleR || b.titleEn);
        html += `<div class="inv-row" style="border:1px solid #4a3c20;border-radius:6px;padding:8px;margin:4px 0;display:flex;justify-content:space-between;align-items:center;">
          <span>📖 <b>${Util.escapeHtml(displayName)}</b></span>
          <span><button class="btn" data-readbook="${i}">Читать</button></span>
        </div>`;
      }
    }
    html += `<div class="btn-row"><button class="btn" id="inv-close">Закрыть</button></div>`;
    showPanel(html);
    overlay.querySelectorAll('[data-equiv]').forEach((b) => {
      b.addEventListener('click', () => { Game.equipItem(+b.dataset.equiv); UI.openInventory(); AudioSystem.sfx.ui(); });
    });
    overlay.querySelectorAll('[data-drop]').forEach((b) => {
      b.addEventListener('click', () => { Game.dropItem(+b.dataset.drop); UI.openInventory(); AudioSystem.sfx.ui(); });
    });
    overlay.querySelectorAll('[data-readbook]').forEach((b) => {
      b.addEventListener('click', () => {
        const book = books[+b.dataset.readbook];
        AudioSystem.sfx.ui();
        UI.openBook(book);
      });
    });
    document.getElementById('inv-close').addEventListener('click', () => { UI.hidePanel(); Game.overlayOpen = false; });
    Game.overlayOpen = true;
  }

  function itemHtml(item) {
    return `${item.glyph} <b>${Util.escapeHtml(item.name)}</b>${itemDefText(item)}`;
  }

  function itemDefText(item) {
    if (item.kind === 'weapon') return ` (урон ${item.min}–${item.max}${item.mpBonus ? ', +' + item.mpBonus + ' мана' : ''})`;
    if (item.kind === 'armor') return ` (+${item.def} защ, +${item.hpBonus} HP)`;
    if (item.kind === 'potion') return ` (+${item.heal} HP)`;
    return '';
  }

  function openStats() {
    const p = Game.player;
    const s = Entities.equipmentStats(p);
    showPanel(`
      <h1>Характеристики</h1>
      <p>Уровень: <b>${p.level}</b></p>
      <p>Опыт: <b>${p.xp} / ${p.xpNext}</b></p>
      <p>Убийств: <b>${p.kills}</b></p>
      <p>Золото: <b>${p.gold}</b></p>
      <p>Ключи: <b>${p.keys}</b></p>
      <h2>Боевые</h2>
      <p>Урон: <b>${s.minDmg + p.baseAtk}–${s.maxDmg + p.baseAtk * 2}</b></p>
      <p>Защита: <b>${p.def + s.def}</b></p>
      <p>Здоровье: <b>${p.maxHp + s.hpBonus}</b></p>
      <p>Мана: <b>${p.maxMp + s.mpBonus}</b></p>
      <h2>Способности</h2>
      <ul class="feats">
        ${Object.entries(Entities.ABILITIES).filter(([k, d]) => k === 'strike' || p.unlocked[k]).map(([k, d]) => `<li>${d.glyph} <b>${d.name}</b> — ${d.desc} (${d.mp} мана, кулдаун ${d.cd}s)</li>`).join('')}
      </ul>
      <h2>Хроника</h2>
      ${LORE && Object.keys(LORE).length
        ? `<ul class="feats">${Object.entries(LORE).sort((a, b) => +a[0] - +b[0]).map(([f, txt]) => `<li>📜 <b>Этаж ${f}:</b> ${txt}</li>`).join('')}</ul>`
        : ''}
      <div class="btn-row"><button class="btn" id="stats-close">Закрыть</button></div>
    `);
    document.getElementById('stats-close').addEventListener('click', () => { UI.hidePanel(); Game.overlayOpen = false; });
    Game.overlayOpen = true;
  }

  function openShop() {
    const p = Game.player;
    const shop = Game.world && Game.world.shop;
    if (!shop) return;
    let html = `<h1>🧙 Торговец</h1>`;
    html += `<p>Золото: <b>${p.gold}</b> · Сумка: ${p.inventory.length}/${p.inventoryCap}</p>`;
    html += `<h2>Товары</h2>`;
    if (shop.stock.every((s) => s.sold)) html += `<p>Временный ассортимент закончился.</p>`;
    for (let i = 0; i < shop.stock.length; i++) {
      const it = shop.stock[i];
      html += `<div class="inv-row" style="border:1px solid #3a2f6b;border-radius:6px;padding:8px;margin:4px 0;display:flex;justify-content:space-between;align-items:center;">
        <span>${itemHtml(it)}</span>
        <span>${it.sold ? '<i>Продано</i>' : `<button class="btn" data-buy="${i}">Купить за ${it.price}</button>`}</span>
      </div>`;
    }
    html += `<h2>Постоянные улучшения</h2>`;
    if (shop.upgrades.length > 0) {
      for (let i = 0; i < shop.upgrades.length; i++) {
        const u = shop.upgrades[i];
        html += `<div class="inv-row" style="border:1px solid #4a3c20;border-radius:6px;padding:8px;margin:4px 0;display:flex;justify-content:space-between;align-items:center;">
        <span><b>${u.glyph} ${u.name}</b><br><small>${u.desc}</small></span>
        <span>${u.bought ? '<i>Куплено</i>' : `<button class="btn" data-upgrade="${i}">За ${u.price} зол.</button>`}</span>
      </div>`;
      }
    } else {
      html += `<p>Сейчас нечего предложить.</p>`;
    }
    html += `<h2>Ваши вещи (продать)</h2>`;
    if (p.inventory.length === 0) html += `<p>Нечего продавать.</p>`;
    for (let i = 0; i < p.inventory.length; i++) {
      const item = p.inventory[i];
      if (item.kind === 'key') continue;
      const price = Math.max(1, Math.round(item.value * 0.3));
      html += `<div class="inv-row" style="border:1px solid #3a2f6b;border-radius:6px;padding:8px;margin:4px 0;display:flex;justify-content:space-between;align-items:center;">
        <span>${itemHtml(item)}</span>
        <span><button class="btn" data-s="${i}">Продать за ${price}</button></span>
      </div>`;
    }
    html += `<div class="btn-row"><button class="btn" id="shop-close">Уйти</button></div>`;
    showPanel(html);
    overlay.querySelectorAll('[data-buy]').forEach((b) => {
      b.addEventListener('click', () => { Game.buyItem(+b.dataset.buy); if (Game.world.shop) UI.openShop(); });
    });
    overlay.querySelectorAll('[data-upgrade]').forEach((b) => {
      b.addEventListener('click', () => { Game.buyUpgrade(+b.dataset.upgrade); if (Game.world.shop) UI.openShop(); });
    });
    overlay.querySelectorAll('[data-s]').forEach((b) => {
      b.addEventListener('click', () => { Game.sellItem(+b.dataset.s); if (Game.world.shop) UI.openShop(); });
    });
    document.getElementById('shop-close').addEventListener('click', () => { UI.hidePanel(); Game.overlayOpen = false; });
    Game.overlayOpen = true;
  }

  function openBook(book) {
    if (!book) return;
    const isEn = Lang.isEn && Lang.isEn();
    const displayTitle = isEn ? (book.titleEn || book.titleR) : (book.titleR || book.titleEn);
    const displayText = isEn ? (book.textEn || book.textR) : (book.textR || book.textEn);
    showPanel(`
      <div class="centered">
        <h1>📖 ${Util.escapeHtml(displayTitle)}</h1>
      </div>
      <div class="book-body" style="white-space:pre-line;line-height:1.6;font-size:15px;color:#e8e2ff;background:#17122b;border:1px solid #4a3c20;border-radius:10px;padding:14px;">
        ${Util.escapeHtml(displayText || '')}
      </div>
      <div class="btn-row centered">
        <button class="btn" id="book-close">Закрыть</button>
      </div>
    `);
    document.getElementById('book-close').addEventListener('click', () => UI.openInventory());
    Game.overlayOpen = true;
  }

  // Totem of difficulty at the hub. Balanced presets, explained up front.
  function openDifficulty() {
    const p = Game.player;
    const cur = p.difficulty || 'normal';
    const rows = Object.entries(Entities.DIFFICULTY).map(([k, d]) => `
      <button class="cls-card" data-diff="${k}" type="button"
        style="flex:1;margin:4px;padding:10px;border-radius:10px;border:2px solid ${cur === k ? '#e6c458' : '#3a2f6b'};background:#17122b;color:#e8e2ff;cursor:pointer;text-align:left;font-family:inherit;">
        <span style="font-size:20px;">${k === 'easy' ? '🍃' : k === 'hard' ? '🔥' : '⚖️'} <b>${k === 'easy' ? 'Лёгкая' : k === 'hard' ? 'Сложная' : 'Обычная'}</b></span><br>
        <small style="display:block;margin-top:4px;opacity:0.85;">HP врагов ×${d.enmHp} · их урон ×${d.enmDmg} · золото ×${d.gold}</small>
      </button>`).join('');
    showPanel(`
      <h1>🪬 Тотем трудности</h1>
      <p>Соотношение «риск/награда» на весь спуск.</p>
      <div style="display:flex;flex-wrap:wrap;margin:-4px;">${rows}</div>
      <div class="btn-row"><button class="btn" id="diff-close">Закрыть</button></div>
    `);
    overlay.querySelectorAll('[data-diff]').forEach((b) => {
      b.addEventListener('click', () => {
        AudioSystem.sfx.ui();
        Game.setDifficulty(b.dataset.diff);
        overlay.querySelectorAll('[data-diff]').forEach((o) => { o.style.borderColor = '#3a2f6b'; });
        b.style.borderColor = '#e6c458';
      });
    });
    document.getElementById('diff-close').addEventListener('click', () => { UI.hidePanel(); Game.overlayOpen = false; });
    Game.overlayOpen = true;
  }

  // Notice board: route stats + chronicle of found books & lore.
  function openBlackboard() {
    const p = Game.player;
    let html = `<h1>Доска объявлений</h1>`;
    html += `<p>Глубина: <b>этаж ${Game.floor}/100</b></p>`;
    html += `<p>Уровень: <b>${p.level}</b> · Убийств: <b>${p.kills}</b> · Золото: <b>${p.gold}</b> · Ключей: <b>${p.keys}</b></p>`;
    html += `<h2>Хроника глубин</h2>`;
    const loreList = Object.entries(LORE || {}).sort((a, b) => +a[0] - +b[0]);
    html += loreList.length
      ? `<ul class="feats">${loreList.map(([f, txt]) => `<li>📜 <b>Этаж ${f}:</b> ${Lang.story(+f, txt)}</li>`).join('')}</ul>`
      : `<p>Хроника пуста — она пишется по мере спуска.</p>`;
    html += `<h2>Книги (${(p.books || []).length}/11)</h2>`;
    const bookKeys = new Set((p.books || []).map((b) => b.key));
    const allBooks = Entities.BOOKS || [];
    html += allBooks.length
      ? `<ul class="feats">${allBooks.map((b) => {
          const isEn = Lang.isEn && Lang.isEn();
          const name = isEn ? b.titleEn : b.titleR;
          return `<li>${bookKeys.has(b.key) ? '📖' : '🔒'} <b>${Util.escapeHtml(name)}</b> — этаж ${b.floor} ${bookKeys.has(b.key) ? '' : '(не найдена)'}</li>`;
        }).join('')}</ul>`
      : `<p>О книгах пока не слышно.</p>`;
    html += `<div class="btn-row"><button class="btn" id="board-close">Закрыть</button></div>`;
    showPanel(html);
    document.getElementById('board-close').addEventListener('click', () => { UI.hidePanel(); Game.overlayOpen = false; });
    Game.overlayOpen = true;
  }

  function openPause() {
    showPanel(`
      <h1>Пауза</h1>
      <div class="btn-row">
        <button class="btn primary" id="pause-resume">Продолжить</button>
        <button class="btn" id="pause-save">Сохранить</button>
        <button class="btn" id="pause-menu">В меню</button>
      </div>
    `);
    document.getElementById('pause-resume').addEventListener('click', () => { UI.hidePanel(); Game.overlayOpen = false; Game.setPausedGame(false); });
    document.getElementById('pause-save').addEventListener('click', () => { Game.saveGame(); UI.toast('Игра сохранена', 'loot'); });
    document.getElementById('pause-menu').addEventListener('click', () => UI.openMenu());
    Game.overlayOpen = true; // so Esc closes the pause panel
    Game.setPausedGame(true);
  }

  function openVictory() {
    showPanel(`
      <div class="centered">
        <div class="hero-emoji">🏆</div>
        <h1>ПОБЕДА!</h1>
        <p>Повелитель Пустоты повержен. Тьма расступилась, и солнечный свет впервые
        за века коснулся этих глубин.</p>
        <p>Легенды о безымянном герое, спустившемся на самое дно, будут
        рассказывать ещё сто этажей спустя.</p>
        <p><b>Ты достиг ${Game.player.level} уровня, убил ${Game.player.kills} врагов
        и собрал ${Game.player.gold} золота.</b></p>
      </div>
      <div class="btn-row centered">
        <button class="btn primary" id="victory-new">Сыграть снова</button>
        <button class="btn" id="victory-menu">В меню</button>
      </div>
    `);
    document.getElementById('victory-new').addEventListener('click', () => Game.newGame());
    document.getElementById('victory-menu').addEventListener('click', () => UI.openMenu());
    Game.setPausedGame(true);
  }

  return { init, updateHUD, toast, showBanner, openMenu, openHowTo, openDeath, openInv: openInventory,
           openStats, openShop, openBook, openSettings, openDifficulty, openBlackboard,
           openPause, openVictory, hidePanel, showPanel, renderSoundBtns,
           itemHtml };
})();