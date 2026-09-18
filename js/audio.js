/* audio.js — Web Audio: sfx tones + procedural ambient music. */
'use strict';

const AudioSystem = (() => {
  let ctx = null;
  let master = null;
  let sfxGain = null;
  let musicGain = null;
  let muted = false;
  let musicOn = true;

  let musicTimer = null;
  let nextNoteTime = 0;
  let step = 0;
  let bossMode = false;
  let hubMode = false;
  const STEP_DUR = 0.24; // seconds per 16th note

  // Ambient minor-ish progression: low drone + sparse pentatonic pluck.
  const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic semitone offsets from root
  const ROOTS = [55, 55, 65.4, 49]; // low A, A, C, G drone

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.5;
    sfxGain.connect(master);
    musicGain = ctx.createGain();
    musicGain.gain.value = muted ? 0 : 0.22;
    musicGain.connect(master);
  }

  // Call on first user gesture.
  function resume() {
    ensure();
    if (ctx.state === 'suspended') ctx.resume();
    if (musicOn && !musicTimer) startMusic();
  }

  function setMuted(m) {
    muted = m;
    if (sfxGain) sfxGain.gain.value = m ? 0 : 0.5;
  }
  function setMusicOn(on) {
    musicOn = on;
    if (musicGain) musicGain.gain.value = on && !muted ? 0.22 : 0;
    if (on && ctx) startMusic();
    if (!on && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  // Pure tone builder: osc -> gain with AD envelope (no clicks).
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, delay, filterFreq) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq || 1800;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t0);
  }

  // ---------- Sound effects ----------
  const sfx = {
    hit() { tone(220, 0.08, 'square', 0.25, 140); noise(0.05, 0.2, 0, 2600); },
    playerHit() { tone(140, 0.2, 'sawtooth', 0.3, 80); noise(0.12, 0.25, 0, 1200); },
    crit() { tone(320, 0.12, 'square', 0.35, 120); tone(520, 0.1, 'square', 0.2, 200, 0.02); },
    kill() { noise(0.15, 0.25, 0, 900); tone(190, 0.14, 'triangle', 0.25, 60); },
    whoosh() { noise(0.12, 0.2, 0, 3400); },
    magic() { tone(520, 0.15, 'sine', 0.3, 900); tone(780, 0.2, 'sine', 0.18, 1300, 0.03); },
    fireball() { noise(0.12, 0.3, 0, 1800); tone(260, 0.15, 'sawtooth', 0.25, 90); },
    explosion() { noise(0.3, 0.5, 0, 700); tone(80, 0.3, 'sine', 0.5, 40); },
    dash() { tone(240, 0.12, 'sine', 0.3, 760); noise(0.1, 0.15, 0, 2200); },
    gold() { tone(880, 0.06, 'triangle', 0.2); tone(1320, 0.09, 'triangle', 0.16, undefined, 0.05); },
    pickup() { tone(660, 0.08, 'triangle', 0.2); tone(990, 0.1, 'triangle', 0.16, undefined, 0.05); },
    heal() { tone(440, 0.2, 'sine', 0.25, 660); tone(660, 0.22, 'sine', 0.18, 880, 0.12); },
    levelup() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'triangle', 0.25, undefined, i * 0.09)); },
    door() { tone(160, 0.2, 'sawtooth', 0.22, 90); noise(0.2, 0.18, 0, 500); },
    boss() { tone(60, 0.6, 'sawtooth', 0.4, 40); tone(45, 0.6, 'square', 0.3, 30, 0.1); noise(0.3, 0.3, 0, 300); },
    step() { noise(0.05, 0.06, 0, 600); },
    death() { tone(200, 0.6, 'sawtooth', 0.35, 40); noise(0.5, 0.3, 0, 500); },
    error() { tone(200, 0.12, 'square', 0.2, 160); },
    ui() { tone(520, 0.06, 'triangle', 0.15, 620); },
  };

  // ---------- Procedural music scheduler ----------
  // Noise hit routed into the music bus (used by the boss-mode drum kit).
  function musicNoise(time, dur, vol, filterFreq) {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq || 1800;
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f); f.connect(g); g.connect(musicGain);
    src.start(time);
  }

  // Kick drum: quick sine pitch-drop into the music bus.
  function musicKick(time) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
    g.gain.setValueAtTime(0.4, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
    osc.connect(g); g.connect(musicGain);
    osc.start(time);
    osc.stop(time + 0.16);
  }

  // Boss fights flip the soundtrack into a heavy metal stomp: faster clock,
  // kick/snare groove and crunching fourths under the melody.
  function setBossMode(on) {
    bossMode = !!on;
  }
  // Starting hall / merchant den: relax the soundtrack into a calm campfire
  // loop — slower steps, softer chords, no percussion.
  function setHubMode(on) {
    hubMode = !!on;
  }
  function scheduleNote(time, freq, dur, vol, type) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g); g.connect(musicGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function startMusic() {
    if (!ctx || musicTimer) return;
    nextNoteTime = ctx.currentTime + 0.1;
    step = 0;
    musicTimer = setInterval(scheduler, 40);
  }

  function scheduler() {
    if (!ctx || !musicGain || musicGain.gain.value <= 0) return;
    const stepDur = bossMode ? 0.17 : (hubMode ? 0.32 : STEP_DUR);
    while (nextNoteTime < ctx.currentTime + 0.12) {
      const t = nextNoteTime;
      // Drone bass every whole note.
      if (step % 16 === 0) {
        const root = ROOTS[(step / 16) % ROOTS.length] * (bossMode ? 0.75 : 1);
        scheduleNote(t, root, 3.5, hubMode ? 0.16 : (bossMode ? 0.4 : 0.28), 'sine');
        if (!hubMode) scheduleNote(t, root * 2, 3.5, bossMode ? 0.18 : 0.12, 'sawtooth');
      }
      // Boss groove: kick on the one-and-a-half, snare on the backbeat,
      // plus low power-chord stabs to make it stomp like a boss fight.
      if (bossMode) {
        if (step % 8 === 0 || step % 8 === 6) musicKick(t);
        if (step % 8 === 4) musicNoise(t, 0.1, 0.22, 4200);
        if (step % 2 === 0) scheduleNote(t, 82.4, 0.14, 0.1, 'square');
      }
      // Sparse pluck melody.
      const pstep = step % 16;
      if (!hubMode && (pstep % 4 === 1 || pstep % 4 === 3)) {
        const root = ROOTS[(Math.floor(step / 16)) % ROOTS.length];
        const semi = PENTA[(step / 2) % PENTA.length | 0];
        const freq = root * 4 * Math.pow(2, semi / 12) * (Math.random() > 0.5 ? 1 : 1.5);
        scheduleNote(t, freq, 0.5, bossMode ? 0.11 : 0.06, bossMode ? 'square' : 'triangle');
        if (bossMode) scheduleNote(t, freq / 2, 0.18, 0.07, 'square');
      } else if (hubMode && pstep % 4 === 1) {
        // Campfire arpeggio: warm fifths trickling down, very quiet.
        const root = ROOTS[(Math.floor(step / 16)) % ROOTS.length];
        const semi = PENTA[(step / 2) % PENTA.length | 0];
        scheduleNote(t, root * 4 * Math.pow(2, semi / 12), 1.2, 0.045, 'triangle');
        scheduleNote(t, root * 2.5, 1.6, 0.02, 'sine');
      }
      nextNoteTime += stepDur;
      step++;
    }
  }

  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  return {
    resume, ensure, setMuted, setMusicOn, get muted() { return muted; },
    get musicOn() { return musicOn; }, sfx, stopMusic, setBossMode, setHubMode,
  };
})();
