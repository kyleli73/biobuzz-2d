/* Input for the four seats. Keyboard and gamepads are merged into one object per frame.

   The browser has no "is this key down right now" call, so we keep our own Set. keydown adds
   a code and keyup removes it. If the window loses focus while a key is held, keyup never
   arrives, so the blur handler clears the Set. Without that, a key would stay stuck down. */

const SEAT_CODES = new Set(SEATS.flatMap(seat => [
  seat.keys.fwd, seat.keys.back, seat.keys.left, seat.keys.right, ...seat.keys.fire
]));

const GAMEPAD_DEADZONE = 0.15;   // sticks drift when released; smaller than this is noise

const heldCodes = new Set();
const seatKeyListeners = [];
let captureKeys = false;

/* While a match runs, seat keys must not scroll the page or press a focused button.
   Menus leave this off so Tab and Space keep working normally there. */
function setKeyCapture(on) {
  captureKeys = on;
}

/* Which action a key means for one seat, or null. Forward and back are not menu actions. */
function seatActionFor(seat, code) {
  if (code === seat.keys.left) return 'left';
  if (code === seat.keys.right) return 'right';
  if (seat.keys.fire.includes(code)) return 'fire';
  return null;
}

/* The menu listens here so a player can change their robot type with their own keys. The
   callback gets (seatIndex, action) where action is 'left', 'right' or 'fire'. */
function onSeatKey(callback) {
  seatKeyListeners.push(callback);
}

window.addEventListener('keydown', (e) => {
  if (!SEAT_CODES.has(e.code)) return;
  if (captureKeys) e.preventDefault();
  if (e.repeat) return;   // holding a key fires one keydown, then repeats; only the first counts
  heldCodes.add(e.code);
  SEATS.forEach((seat, i) => {
    const action = seatActionFor(seat, e.code);
    if (action) seatKeyListeners.forEach(cb => cb(i, action));
  });
});

window.addEventListener('keyup', (e) => {
  if (!SEAT_CODES.has(e.code)) return;
  if (captureKeys) e.preventDefault();
  heldCodes.delete(e.code);
});

window.addEventListener('blur', () => heldCodes.clear());

/* Connected gamepads in the order the browser lists them. getGamepads() can hold empty
   slots for unplugged pads, so we drop those. Gamepad i drives SEATS[i]. */
function connectedPads() {
  if (!navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()).filter(pad => pad && pad.connected);
}

function seatHasGamepad(i) {
  return connectedPads()[i] !== undefined;
}

function deadzone(v) {
  return Math.abs(v) < GAMEPAD_DEADZONE ? 0 : v;
}

function clampUnit(v) {
  return Math.max(-1, Math.min(1, v));
}

/* Standard mapping: axes[0] and [1] are the left stick, [2] and [3] the right stick.
   Pressing up on a stick gives a negative Y, so drive is negated to make up mean forward. */
function padInputs(pad) {
  const axes = pad.axes;
  const buttons = pad.buttons;
  const drive = -deadzone(axes[1] || 0);
  const rightX = axes[2] || 0;
  // Some pads report no right stick at all. Then the left stick steers, so turning still works.
  const turnAxis = Math.abs(rightX) >= GAMEPAD_DEADZONE ? rightX : (axes[0] || 0);
  const fire = (buttons[0] && buttons[0].pressed) || (buttons[7] && buttons[7].value > 0.5);
  return { drive, turn: deadzone(turnAxis), fire: !!fire };
}

/* Called once per game frame. Returns { R1: {drive, turn, fire}, R2: ..., B1: ..., B2: ... }.
   Drive and turn run from -1 to 1. Keyboard and gamepad add together, then clamp, so a
   player holding both does not get double speed. */
function readInputs() {
  const pads = connectedPads();
  const inputs = {};
  SEATS.forEach((seat, i) => {
    const k = seat.keys;
    const kbDrive = (heldCodes.has(k.fwd) ? 1 : 0) - (heldCodes.has(k.back) ? 1 : 0);
    const kbTurn = (heldCodes.has(k.right) ? 1 : 0) - (heldCodes.has(k.left) ? 1 : 0);
    const kbFire = k.fire.some(code => heldCodes.has(code));
    const pad = pads[i] ? padInputs(pads[i]) : { drive: 0, turn: 0, fire: false };
    inputs[seat.slot] = {
      drive: clampUnit(kbDrive + pad.drive),
      turn: clampUnit(kbTurn + pad.turn),
      fire: kbFire || pad.fire
    };
  });
  return inputs;
}
