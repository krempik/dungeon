/* input.js — keyboard (physical e.code for cross-layout safety), mouse, pointer. */
'use strict';

const Input = (() => {
  const held = new Set();
  const pressed = new Set();
  let mouseX = 0, mouseY = 0;
  let mouseDown = false;

  // Map physical e.code → logical action. Layout-independent (RU/EN/CZ etc).
  const KEYMAP = {
    KeyW: 'up',    KeyArrowUp: 'up',
    KeyS: 'down',  KeyArrowDown: 'down',
    KeyA: 'left',  KeyArrowLeft: 'left',
    KeyD: 'right', KeyArrowRight: 'right',
    KeyF: 'f', KeyQ: 'q', KeyE: 'e', KeyI: 'i', KeyC: 'c',
    Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5',
    ShiftLeft: 'shift', ShiftRight: 'shift',
    ControlLeft: 'ctrl', ControlRight: 'ctrl',
    Space: 'space',
    Escape: 'escape',
  };

  function init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F5') { e.preventDefault(); pressed.add('f5'); return; }
      const k = KEYMAP[e.code];
      if (k) {
        e.preventDefault();
        if (!e.repeat && !held.has(k)) pressed.add(k);
        held.add(k);
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k) held.delete(k);
    });

    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect();
      mouseX = e.clientX - r.left;
      mouseY = e.clientY - r.top;
    };
    canvas.addEventListener('mousemove', toCanvas);
    canvas.addEventListener('pointermove', toCanvas);
    canvas.addEventListener('mousedown', (e) => { toCanvas(e); mouseDown = true; });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      toCanvas(e); mouseDown = true;
    });
    window.addEventListener('mouseup', () => { mouseDown = false; });
    window.addEventListener('pointerup', () => { mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function endFrame() { pressed.clear(); }

  function isDown(k) { return held.has(k); }
  function wasPressed(k) { return pressed.has(k); }

  function moveVector() {
    let x = 0, y = 0;
    if (held.has('left')) x -= 1;
    if (held.has('right')) x += 1;
    if (held.has('up')) y -= 1;
    if (held.has('down')) y += 1;
    return { x, y };
  }

  return { init, endFrame, isDown, wasPressed, moveVector,
           get mouseX() { return mouseX; }, get mouseY() { return mouseY; },
           get mouseDown() { return mouseDown; }, KEYMAP };
})();