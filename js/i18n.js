/* i18n.js — RU/EN localization: string dictionary + language persistence.
   Designed as a value-add layer over existing code: Ru stays untouched, EN is
   looked up per exact string. All visible UI goes through Lang.t / Lang.msg. */
'use strict';

const Lang = (() => {
  const KEY = 'dungeon_lang';
  let lang = 'ru';

  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'ru') lang = saved;
  } catch (e) { /* storage disabled — default ru */ }

  // ---- exact match RU → EN dictionary (UI, toasts, panels are keys) ----
  const T = {
    // menu / settings
    'Играть': 'Play',
    'Настройки': 'Settings',
    'Язык': 'Language',
    'Русский': 'Russian',
    'Английский': 'English',
    'Как играть?': 'How to play?',
    'Как играть': 'How to play',
    'Продолжить': 'Continue',
    'Новое путешествие': 'New journey',
    'Новая игра': 'New game',
    'Назад': 'Back',
    'Закрыть': 'Close',
    'В меню': 'To menu',
    'Пауза': 'Pause',
    'Сохранить': 'Save',
    'Зачем спускаться ниже?': 'Why go deeper?',
    'Легенды': 'Lore',
    'Выбери класс': 'Choose a class',
    'Выбери класс: подойди к воину, магу или тени': 'Pick a class: walk up to the warrior, mage or rogue',
    'Прогресс сохраняется автоматически в локальном хранилище.': 'Progress is saved automatically to local storage.',
    'Потусторонний данджон-краулер. Сначала загляни в Приют Пустоты — выбери класс у героев, затем спускайся через дверь наверху. Торговец заглядывает на каждый 5-й этаж (5, 10, 15...), а на каждый 10-й (10, 20, 30...) тебя ждёт Страж Пустоты.': 'An otherworldly dungeon crawler. Start at the Sanctuary — pick a class from the heroes, then descend through the door. The merchant visits every 5th floor (5, 10, 15...), and every 10th floor (10, 20, 30...) holds a Void Guardian.',
    'Приют Пустоты': 'Sanctuary of the Void',
    'Приют': 'Sanctuary',
    'Дверь наверху ведёт на этаж 1.': 'The door above leads to floor 1.',
    'Помни свои пассивки — они решают исход боя.': 'Remember your passives — they decide the fight.',
    'вкл': 'on',
    'выкл': 'off',
    'Выбери класс: подойди к воину, магу или тени': 'Pick a class: walk up to the warrior, mage or rogue',
    'Продолжить спуск': 'Continue the descent',
    'Новая экспедиция': 'New expedition',
    'Звук': 'Sound',
    'Музыка': 'Music',

    // difficulty
    'Сложность': 'Difficulty',
    'Лёгкий': 'Easy',
    'Нормальный': 'Normal',
    'Сложный': 'Hard',
    'Враги слабее, золота больше.': 'Weaker enemies, more gold.',
    'Сбалансированный спуск.': 'Balanced descent.',
    'Враги злее, золота меньше.': 'Deadlier enemies, less gold.',
    'Выбери уровень сложности': 'Choose the difficulty',
    'Текущая сложность:': 'Current difficulty:',

    // hub room
    'Доска знаний': 'Knowledge board',
    'Очаг': 'Hearth',
    'Ящик': 'Crate',
    'Табличка': 'Sign',
    'Тотем выбора': 'Tide of choice',
    'Сундук': 'Chest',
    'Скамья': 'Bench',
    'Нажми F': 'Press F',
    'Класс:': 'Class:',
    'Вместо тебя пойду я': 'I will go instead of you',
    'Хочешь, я пойду вместо тебя?': 'Want me to go instead of you?',
    'Да': 'Yes',
    'Нет': 'No',
    'Класс сменён:': 'Class changed:',

    // stats / board
    'Характеристики': 'Stats',
    'Доска героя': 'Hero board',
    'Уровень:': 'Level:',
    'Опыт:': 'XP:',
    'Убийств:': 'Kills:',
    'Золото:': 'Gold:',
    'Ключи:': 'Keys:',
    'Боевые': 'Combat',
    'Урон:': 'Damage:',
    'Защита:': 'Defense:',
    'Здоровье:': 'Health:',
    'Мана:': 'Mana:',
    'Способности': 'Abilities',
    'Хроника': 'Chronicle',
    'Книги': 'Books',
    'Прочитано книг:': 'Books read:',

    // inventory
    'Инвентарь': 'Inventory',
    'Экипировка': 'Equipment',
    'Оружие:': 'Weapon:',
    'Броня:': 'Armor:',
    'Сумка': 'Bag',
    'Пусто. Добывай предметы с врагов.': 'Empty. Loot items from enemies.',
    'Экипировать': 'Equip',
    'Выбросить': 'Drop',
    'Продать': 'Sell',
    'Купить за': 'Buy for',
    'Продано': 'Sold',
    'Куплено': 'Bought',
    'Уйти': 'Leave',
    'Суммарно:': 'Total:',
    'в сумку (заменено)': 'to bag (replaced)',
    'Экипировано:': 'Equipped:',
    '— нет —': '— none —',
    'пусто': 'empty',

    // how-to
    'WASD/стрелки — движение': 'WASD / arrows — move',
    'ЛКМ (зажать) — бить в направлении мыши': 'LMB (hold) — attack toward the mouse',
    '1—удар, 2—вихрь, 3—огненный шар, Ctrl—рывок, 4—лечение (HP за ману)': '1—strike, 2—whirl, 3—fireball, Ctrl—dash, 4—heal (HP for mana)',
    'Shift — удержание: блок (снижает урон)': 'Shift — hold: block (reduce damage)',
    'Q/E — выпить зелье (малое/большое)': 'Q/E — drink potion (small/big)',
    'F — поговорить (торговец, классы, тотем)': 'F — talk (merchant, classes, totem)',
    'I — инвентарь и экипировка': 'I — inventory and equipment',
    'C — характеристики': 'C — stats',
    'Esc — меню / закрыть': 'Esc — menu / close',
    'F5 — сохранить вручную': 'F5 — save manually',
    'Удерживай атаку — каждый удар кормит комбо: при 5 и 10 ударах крит-шанс растёт.': 'Hold attack — each hit feeds a combo: at 5 and 10 hits crit chance grows.',
    'Вода замедляет, лава поджигает — и тебя, и врагов.': 'Water slows, lava burns — both you and enemies.',
    'Респавн на этаже больше не бесплатный: заряды «второй жизни» дают торговец и уровни ×15.': 'Respawn is no longer free: "second life" charges come from the merchant and level-ups ×15.',
    'Продавай хлам торговцу за 30% цены — копи валюту на постоянные улучшения.': 'Sell junk to the merchant for 30% of its value — save gold for permanent upgrades.',
    'Книги читаются в инвентаре и не занимают место в сумке.': 'Books are read from the inventory and take no bag space.',
    'Классы передают тебе пассивное умение (ярость, эхо, чародейство, тень).': 'Classes grant a passive skill (rage, echo, sorcery, shadow).',

    // skill icons (abilities + their descs stay from entities; names translated)
    'Удар': 'Strike',
    'Вихрь': 'Whirl',
    'Огненный шар': 'Fireball',
    'Рывок': 'Dash',
    'Вспышка жизни': 'Heal',
    'Быстрый удар по врагу перед собой': 'A quick strike at the enemy ahead',
    'Вращение, бьющее всех вокруг': 'Spin, hitting everything around',
    'Снаряд дальнего боя, взрывается': 'Ranged projectile that explodes',
    'Прорыв, отбрасывающий врагов': 'Dash that knocks enemies back',
    'Восстановление здоровья': 'Restores health',

    // toasts
    'Сохранение загружено': 'Save loaded',
    'Игра сохранена': 'Game saved',
    'Игра сохранена (F5)': 'Game saved (F5)',
    'Сумка полна!': 'Bag full!',
    'Не хватает золота!': 'Not enough gold!',
    'Уже продано': 'Already sold',
    'Уже куплено': 'Already bought',
    'Подойди ближе к торговцу': 'Get closer to the merchant',
    'Получен рунический ключ!': 'Runic key obtained!',
    'Куплен рунический ключ!': 'Runic key bought!',
    'Куплен амулет второй жизни!': 'Second-life amulet bought!',
    'Сумка полна — предмет остаётся на земле!': 'Bag full — item stays on the ground!',
    'Выброшено:': 'Dropped:',
    'Продано:': 'Sold:',
    'Недостаточно маны': 'Not enough mana',
    'Вторая жизнь! Ты вернулся к бою.': 'Second life! You are back in the fight.',
    'Нужен рунический ключ, чтобы спуститься глубже!': 'You need a runic key to descend deeper!',
    'Собери ключи, открой выход и спускайся глубже!': 'Gather keys, open the exit and descend deeper!',
    'Торговец — каждые 5 этажей, Страж Пустоты — каждые 10.': 'Merchant every 5 floors, Void Guardian every 10.',
    'СТРАЖ ПУСТОТЫ ПОВЕРЖЕН!': 'VOID GUARDIAN DOWN!',
    'ВЛАДЫКА ПУСТОТЫ ПОВЕРЖЕН! Победа!': 'VOID LORD SLAIN! Victory!',
    'Уровень': 'Level',
    'Божественная искра: +1 второй жизни!': 'Divine spark: +1 second life!',
    'Жизни': 'Lives',

    // death panel
    'Ты погиб': 'You died',
    'Вторая жизнь': 'Second life',
    'Амулет жизни всё ещё тёплый в твоей руке…': 'A life amulet is still warm in your hand…',
    'Возвращения на этаж больше нет.': 'There is no floor respawn anymore.',
    'Тьма поглотила тебя.': 'The darkness has consumed you.',

    // victory panel
    'ПОБЕДА!': 'VICTORY!',
    'Сыграть снова': 'Play again',
    'Легенды о герое будут рассказывать ещё сто этажей спустя.': 'Legends of the hero will be told a hundred floors later.',

    // class names + descs
    'Изгой Пустоты': 'Void Outcast',
    'Рубака': 'Brawler',
    'Маг': 'Mage',
    'Тень': 'Shadow',
    'Хранитель историй': 'Keeper of Stories',
    'Вниз': 'Down',
    'Сбалансированный исследователь без бонусов и штрафов.': 'A balanced explorer, no bonuses or penalties.',
    'Больше жизни и защиты, сильнее бьёт в ближнем бою, но слабая магия.': 'More health and defense, strong melee, weak magic.',
    'Больше маны и её регенерации, мощная магия, но хрупкое тело.': 'More mana and regeneration, powerful magic, fragile body.',
    'Самый быстрый, частые и мощные критические удары, но меньше жизни.': 'Fastest, frequent and powerful crits, but less health.',
    'Эхо Пустоты: кулдауны на 10% короче.': 'Void Echo: cooldowns 10% shorter.',
    'Ярость: ниже 35% HP критический шанс +15%, ближний бой +20%.': 'Rage: below 35% HP crit +15%, melee +20%.',
    'Чародейство: огненный шар +25% урона и −20% маны.': 'Sorcery: fireball +25% damage and −20% mana.',
    'Тень: рывок кулдаун −25%, крит-урон +0.25.': 'Shadow: dash cooldown −25%, crit damage +0.25.',
    'Кулдауны на 10% короче.': 'Cooldowns 10% shorter.',
    'Ниже 35% HP: крит-шанс +15%, ближний бой +20%.': 'Below 35% HP: crit chance +15%, melee +20%.',
    'Огненный шар +25% урона, −20% маны.': 'Fireball +25% damage, −20% mana.',
    'Рывок: кулдаун −25%, крит-урон +0.25.': 'Dash: cooldown −25%, crit damage +0.25.',

    // enemies (names)
    'Сквернокрыс': 'Blighthorn Rat',
    'Кожаный нетопырь': 'Leather Bat',
    'Скелет-страж': 'Skeleton Guard',
    'Призрак': 'Ghost',
    'Гниющий страж': 'Rotten Warden',
    'Имп-пироман': 'Pyromaniac Imp',
    'Костяной боец': 'Bone Fighter',
    'Переводчик душ': 'Soul Herald',
    'Паук-ткач': 'Weaver Spider',
    'Скелет-лучник': 'Skeleton Archer',
    'Глубинный жрец': 'Deep Priest',
    'Взрывной слизень': 'Boom Slime',
    'Стальной щитоносец': 'Steel Shieldbearer',
    'Воин-таран': 'Ram Warrior',
    'Владыка Пустоты': 'Void Lord',
    'Страж Рубежа': 'Warden of the Mark',
    'Страж Начал': 'Warden of Beginnings',
    'Страж-Истукан': 'Colossus Guardian',
    'Торговец': 'Merchant',

    // items (names)
    'Ржавый клинок': 'Rusty Blade',
    'Стальной меч': 'Steel Sword',
    'Клинок Пустоты': 'Void Blade',
    'Косоход-некромант': 'Necromancer Scythe',
    'Печать Владыки': 'Lord\'s Seal',
    'Клинок Рассвета': 'Dawn Blade',
    'Топор Погибели': 'Doom Axe',
    'Каратель Пустоты': 'Void Punisher',
    'Меч Конечности': 'Blade of Finality',
    'Зов Бездны': 'Call of the Abyss',
    'Меч Раскола': 'Sunder Blade',
    'Погибель Тьмы': 'Scourge of Darkness',
    'Деревянный посох': 'Wooden Staff',
    'Ледяной посох': 'Frost Staff',
    'Посох Бездны': 'Staff of the Abyss',
    'Посох Тайных Искр': 'Staff of Secret Sparks',
    'Посох Шёпота': 'Whisper Staff',
    'Посох Забвения': 'Staff of Oblivion',
    'Посох Угасших звёзд': 'Staff of Faded Stars',
    'Скипетр Рассвета': 'Sceptre of Dawn',
    'Кожаный доспех': 'Leather Armor',
    'Кольчатая броня': 'Ring Mail',
    'Некропластины': 'Necroplates',
    'Звёздная броня': 'Star Armor',
    'Осколок Зари': 'Dawn Shard',
    'Утверждение Тьмы': 'Assertion of Darkness',
    'Плащ Глубин': 'Cloak of the Depths',
    'Эхо Вечности': 'Echo of Eternity',
    'Броня Последних врат': 'Armor of the Last Gate',
    'Корона Пустоты': 'Crown of the Void',
    'Зелье жизни': 'Life Potion',
    'Большое зелье': 'Greater Potion',
    'Рунический ключ': 'Runic Key',
    'Факел': 'Torch',
    'Золото': 'Gold',
    'Амулет второй жизни': 'Second-Life Amulet',

    // merchant
    'Товары': 'Goods',
    'Постоянные улучшения': 'Permanent upgrades',
    'Ваши вещи (продать)': 'Your items (sell)',
    'Нечего продавать.': 'Nothing to sell.',
    'Сейчас нечего предложить.': 'Nothing to offer right now.',
    'Временный ассортимент закончился.': 'The temporary stock is sold out.',
    'Амулет здоровья': 'Health Amulet',
    '+12 к макс. жизни навсегда': '+12 max health forever',
    'Точильный камень': 'Whetstone',
    '+1 к базовому урону навсегда': '+1 base damage forever',
    'Янтарный кристалл': 'Amber Crystal',
    '+10 к мане навсегда': '+10 mana forever',
    'Золотой ключик': 'Golden Charm',
    '+8% к подбираемому золоту': '+8% gold pickup',
    'Уйти от торговца': 'Leave the merchant',

    // merchant lines
    'Глубины жадные, путник. Не скупись.': 'The depths are greedy, wanderer. Don\'t be cheap.',
    'Серебро здесь обесценивается с каждым этажом. Трать сейчас.': 'Silver loses value with every floor here. Spend it now.',
    'Видел Повелителя? Я — нет. И не хочу.': 'Seen the Lord? Not me. And I don\'t want to.',
    'Камень, сталь и зубы — надёжнее любой магии.': 'Stone, steel and teeth beat any magic.',
    'Возвращайся с золотом — я не пошевелюсь без монеты.': 'Come back with gold — I won\'t move without a coin.',
    'Это остриё выковано из костей твоего предшественника.': 'This edge was forged from your predecessor\'s bones.',
    'Пока ты спускаешься, я торгую. Так каждый из нас идёт своим путём.': 'While you descend, I trade. That is how each of us walks their way.',

    // NPC chit-chat (hub)
    'Я держал этот спуск дольше всех. Поделюсь опытом.': 'I have held this descent longest. Let me share experience.',
    'Мана — река. Маг лишь ковшик.': 'Mana is a river. A mage is just a ladle.',
    'Скорость решает всё. Удар, удар, уклонение.': 'Speed decides everything. Strike, strike, dodge.',
    'Тише. Пустота разговаривает с теми, кто слушает.': 'Hush. The void speaks to those who listen.',

    // floor banners / story keys
    'СТРАЖ ПУСТОТЫ': 'VOID GUARDIAN',
    'ВЛАДЫКА ПУСТОТЫ': 'VOID LORD',
    'пробуждён': 'awakened',
    'последний бой': 'final fight',
    'Этаж': 'Floor',
    'Место силы': 'Place of power',

    // misc UI
    'мана': 'mana',
    'урон': 'dmg',
    'защ': 'def',
    'Ур.': 'Lv.',
    'Убийств': 'Kills',
    'Координаты:': 'Position:',
    'Времени в пути:': 'Time on the road:',
  };

  // ---- Lore entries (Chronicle) by floor ----
  const STORY = {
    1: 'They say this well once led to the very heart of the world.\nNow it leads down — and something answers from below.\nBegin with the key: the stairs will not open without it.',
    5: 'The Void Market is the last place where gold still means something.\nThe merchant waits in his den at the floor\'s edge.\nHe sees deeper than he speaks.',
    10: 'Guardians do not guard treasure. They guard the stairs.\nEvery tenth floor is a sentry post.\nBreak the warden and descend without looking back.',
    25: 'The walls have learned your name. That is a bad sign.\nThe carving on the bone grows longer — someone is counting the sand.',
    50: 'Halfway. The light above is a memory now.\nThe air is hot and heavy, like a sleeper\'s breath.\nHe sleeps. Do not wake him too soon.',
    75: 'The depths no longer hide what moves between the floors.\nShieldbearers and rams charge in silence — they simply know where you will be.',
    90: 'He already knows you are coming.\nThe last ten floors are his palaces. Here the stone remembers his steps.',
    100: 'THE VOID LORD. The one who devoured his own guardians.\nNothing is left but hunger.\nEnd him — and the stairs will finally end too.',
  };

  function t(text) {
    if (lang !== 'en' || !text) return text;
    const out = T[text];
    return (out !== undefined) ? out : text;
  }

  function story(floor, fallback) {
    if (lang !== 'en') return fallback;
    return STORY[floor] || fallback;
  }

  function set(next) {
    lang = (next === 'en') ? 'en' : 'ru';
    try { localStorage.setItem(KEY, lang); } catch (e) { /* non-fatal */ }
  }

  function get() { return lang; }

  return { t, story, set, get, isEn: () => lang === 'en' };
})();