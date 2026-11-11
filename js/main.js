/* Screens, the match loop and the HUD. This file owns the DOM and the match state. The world
   itself belongs to world.js: we step it and read it, and never change its fields. */

const DEFAULT_PICKS = ['pollen', 'nectar', 'pollen', 'nectar'];   // indexed like SEATS
const METRES_PER_INCH = 0.0254;
const MAX_FRAME_SECS = 0.05;   // a long pause (a background tab) must not teleport the robots
const NOTE_BELOW_PX = 900;     // narrower than this, show the "best on a laptop" note

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Writes text only when it changed. Rewriting the same text every frame costs layout time.
function setText(node, text) {
  if (node.dataset.last === text) return;
  node.dataset.last = text;
  node.textContent = text;
}

const state = {
  screen: 'setup',        // 'setup' or 'game'
  picks: DEFAULT_PICKS.slice(),
  world: null,
  paused: false,
  looping: false,         // true while a requestAnimationFrame loop is scheduled
  last: 0,
  resultsShown: false,
  view: null
};

const canvas = $('field');
const ctx = canvas.getContext('2d');
const seatViews = [];   // setup-screen DOM per seat
const hudCards = [];    // game-screen player cards per seat
const hud = {};         // scoreboard nodes, keyed by alliance

/* ---------- Setup screen ---------- */

function keycap(label, extraClass) {
  const cap = el('span', `keycap ${extraClass || ''}`.trim(), label);
  return cap;
}

/* The key diagram. Forward sits on top, with back and left/right below, like an inverted T.
   The fire key goes to the left of forward, as the seats are laid out on a keyboard. */
function buildKeyDiagram(seat) {
  const k = seat.keyLabels;
  // Some fire keys are words ("Enter"), which need a smaller font to fit the keycap.
  const fire = keycap(k.fire, k.fire.length > 1 ? 'fire wide' : 'fire');
  fire.append(el('small', '', 'FIRE'));
  const wrap = el('div', 'keys');
  wrap.append(
    fire,
    keycap(k.fwd),
    keycap('', 'spacer'),
    keycap(k.left),
    keycap(k.back),
    keycap(k.right)
  );
  return wrap;
}

function buildSeatCard(seat, i) {
  const card = el('section', 'seat-card');
  const head = el('div', 'seat-head');
  head.append(el('span', 'slot', seat.slot));
  const pad = el('span', 'pad-badge', '🎮 gamepad');
  pad.hidden = true;
  head.append(pad);

  const body = el('div', 'seat-body');
  const archCol = el('div', 'arch-col');
  const row = el('div', 'arch-row');
  const buttons = ARCHETYPE_ORDER.map((key) => {
    const btn = el('button', 'arch-btn', ARCHETYPES[key].name.replace(' Bot', ''));
    btn.type = 'button';
    btn.dataset.arch = key;
    btn.addEventListener('click', () => setPick(i, key));
    row.append(btn);
    return btn;
  });
  const blurb = el('p', 'blurb');
  archCol.append(row, blurb);
  body.append(buildKeyDiagram(seat), archCol);

  card.append(head, body);
  seatViews[i] = { card, pad, buttons, blurb };
  return card;
}

function buildSetup() {
  const perf = ROBOT.size / METRES_PER_INCH;
  $('subtitle').textContent =
    `4 players, 1 keyboard. Every robot has the same drivetrain: ${ROBOT.motorRpm} RPM, ` +
    `${ROBOT.wheelMm} mm wheels, ${Math.round(perf)} in square. Pick a mechanism.`;

  // Red pair on the left, blue on the right, both generated from SEATS.
  const grid = $('seat-grid');
  for (const alliance of ['red', 'blue']) {
    const column = el('div', `pair ${alliance}`);
    SEATS.forEach((seat, i) => {
      if (seat.alliance === alliance) column.append(buildSeatCard(seat, i));
    });
    grid.append(column);
  }

  // The rules come from rules.js, so the numbers here follow any change to POINTS.
  const howList = $('how-list');
  const lines = [
    'Shoot into your HIVE\'s open CELL.',
    `Filling a CELL tips the HIVE for ${POINTS.tip} points and spills it.`,
    'Each tip lets your human player drop 1 NECTAR in your LOADING ZONE.',
    `In the last minute all NECTAR comes in and FLOWERS score: ${POINTS.flowerElement} per element ` +
      `to the highest NECTAR, and +${POINTS.bottomNectar} to the lowest.`,
    `Balls in your GARDEN are ${POINTS.garden} each.`,
    `End in your LOADING ZONE for ${POINTS.park}.`
  ];
  lines.forEach(text => howList.append(el('li', '', text)));
}

function renderSetup() {
  seatViews.forEach((view, i) => {
    const pick = state.picks[i];
    view.buttons.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.arch === pick)));
    view.blurb.textContent = ARCHETYPES[pick].blurb;
  });
}

function updateGamepadBadges() {
  seatViews.forEach((view, i) => {
    view.pad.hidden = !seatHasGamepad(i);
  });
}

function setPick(i, archetype) {
  state.picks[i] = archetype;
  renderSetup();
}

// Left and right keys cycle a seat's type, so a player never needs the mouse during setup.
function cyclePick(i, step) {
  const count = ARCHETYPE_ORDER.length;
  const at = ARCHETYPE_ORDER.indexOf(state.picks[i]);
  setPick(i, ARCHETYPE_ORDER[(at + step + count) % count]);
}

/* ---------- Game screen ---------- */

function buildPlayerCard(seat) {
  const card = el('div', `card ${seat.alliance}`);
  const head = el('div', 'card-head');
  const name = el('span', 'arch-name');
  head.append(el('span', 'slot', seat.slot), name);

  const k = seat.keyLabels;
  const keys = el('div', 'card-keys', `${k.fwd} ${k.left} ${k.back} ${k.right} · fire ${k.fire}`);

  const held = el('div', 'card-held');
  const count = el('span', '');
  const dots = el('span', 'dots');
  held.append(count, dots);

  const hint = el('div', 'card-hint');
  card.append(head, keys, held, hint);
  return { card, name, count, dots, hint, cacheKey: '' };
}

function buildGame() {
  SEATS.forEach((seat, i) => {
    const target = $(seat.alliance === 'red' ? 'cards-red' : 'cards-blue');
    const ref = buildPlayerCard(seat);
    hudCards[i] = ref;
    target.append(ref.card);
  });
  for (const a of ['red', 'blue']) {
    hud[a] = { total: $(`${a}-total`), breakdown: $(`${a}-break`) };
  }
  hud.phase = $('phase');
  hud.clock = $('clock');
}

// The breakdown line shows only the parts that scored, e.g. "Hive tips 40 · Cell 6".
function breakdownText(score) {
  return SCORE_KEYS
    .filter(key => score[key] > 0)
    .map(key => `${SCORE_LABELS[key]} ${score[key]}`)
    .join(' · ');
}

function formatClock(secs) {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// What the big clock shows. TELEOP counts down teleopLeft; every other phase uses its own length.
function clockFor(world) {
  const def = PHASES.find(p => p.id === world.phase) || PHASES[0];
  if (world.phase === 'done') return { label: def.label, secs: 0, amber: false };
  if (world.phase === 'teleop') {
    if (world.teleopLeft <= LAST_MINUTE) {
      return { label: 'FLOWERS OPEN', secs: world.teleopLeft, amber: true };
    }
    return { label: def.label, secs: world.teleopLeft, amber: false };
  }
  return { label: def.label, secs: def.dur - world.phaseTime, amber: false };
}

function updateHud(world) {
  // Once the match is over, use the frozen final score. Before that, score the live world.
  const score = world.phase === 'done' && world.final ? world.final : scoreOf(world);
  for (const a of ['red', 'blue']) {
    setText(hud[a].total, String(score[a].total));
    setText(hud[a].breakdown, breakdownText(score[a]));
  }
  const clock = clockFor(world);
  setText(hud.phase, clock.label);
  setText(hud.clock, formatClock(clock.secs));
  hud.clock.classList.toggle('amber', clock.amber);
}

function updateCards(world) {
  SEATS.forEach((seat, i) => {
    const robot = world.robots.find(r => r.slot === seat.slot);
    if (!robot) return;
    const ref = hudCards[i];
    const colours = robot.held.map(b => (b.kind === 'pollen' ? 'pollen' : b.color)).join(',');
    const key = `${robot.archetype}|${colours}|${robot.hint || ''}`;
    if (key === ref.cacheKey) return;   // nothing changed, skip the DOM work
    ref.cacheKey = key;
    ref.name.textContent = ARCHETYPES[robot.archetype].name;
    ref.count.textContent = `Holding ${robot.held.length}/${ROBOT.maxHeld}`;
    ref.dots.replaceChildren(...robot.held.map(b =>
      el('span', `dot ${b.kind === 'pollen' ? 'pollen' : b.color}`)));
    ref.hint.textContent = robot.hint || '';
  });
}

function winnerOf(score) {
  if (score.red.total > score.blue.total) return 'red';
  if (score.blue.total > score.red.total) return 'blue';
  return 'tie';
}

function tableRow(label, red, blue, isTotal) {
  const row = el('tr', isTotal ? 'total' : '');
  row.append(el('th', '', label), el('td', 'red', String(red)), el('td', 'blue', String(blue)));
  return row;
}

function showResults(world) {
  const score = world.final || scoreOf(world);
  const winner = winnerOf(score);
  const banner = $('winner');
  banner.className = `winner ${winner}`;
  banner.textContent = winner === 'tie' ? 'TIE' : `${winner.toUpperCase()} WINS`;

  const body = $('results-body');
  body.replaceChildren(...SCORE_KEYS.map(key =>
    tableRow(SCORE_LABELS[key], score.red[key], score.blue[key], false)));
  body.append(tableRow('Total', score.red.total, score.blue.total, true));

  $('results').hidden = false;
  state.resultsShown = true;
}

function sizeCanvas() {
  const box = $('field-box').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(box.width));
  const height = Math.max(1, Math.floor(box.height));
  // The backing store is dpr times the CSS size, so drawing stays sharp on dense screens.
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  state.view = { width, height, dpr };
}

/* ---------- Screens and match control ---------- */

function showSetup() {
  state.screen = 'setup';
  state.world = null;
  state.paused = false;
  state.resultsShown = false;
  $('setup').hidden = false;
  $('game').hidden = true;
  $('pause').hidden = true;
  $('results').hidden = true;
  setKeyCapture(false);
  renderSetup();
}

function showGame() {
  state.screen = 'game';
  $('setup').hidden = true;
  $('game').hidden = false;
  setKeyCapture(true);
  sizeCanvas();
  if (!state.looping) {
    state.looping = true;
    state.last = 0;
    requestAnimationFrame(frame);
  }
}

function newWorld() {
  return createWorld({
    robots: SEATS.map((seat, i) => ({ slot: seat.slot, archetype: state.picks[i] }))
  });
}

// Puts a fresh match in place with the current robot picks. Used by the first start, rematch and R.
function beginMatch() {
  state.world = newWorld();
  state.paused = false;
  state.resultsShown = false;
  $('results').hidden = true;
  $('pause').hidden = true;
}

function startMatch() {
  if (state.screen !== 'setup' || typeof createWorld !== 'function') return;
  beginMatch();
  showGame();
}

// Only allowed once the match is over. That way a double-press cannot restart a live match.
function rematch() {
  if (state.screen !== 'game' || !state.world || state.world.phase !== 'done') return;
  beginMatch();
}

function togglePause() {
  if (!state.world || state.world.phase === 'done') return;
  state.paused = !state.paused;
  $('pause').hidden = !state.paused;
}

/* ---------- Loop ---------- */

function frame(now) {
  if (state.screen !== 'game') {
    state.looping = false;   // the menu is up, so stop scheduling frames
    return;
  }
  requestAnimationFrame(frame);
  const elapsed = state.last ? (now - state.last) / 1000 : 0;
  state.last = now;
  const world = state.world;
  if (!world) return;

  const dt = Math.max(0, Math.min(elapsed, MAX_FRAME_SECS));
  if (!state.paused && world.phase !== 'done') {
    stepWorld(world, dt, readInputs());
  }
  drawWorld(ctx, world, state.view);
  updateHud(world);
  updateCards(world);
  if (world.phase === 'done' && !state.resultsShown) showResults(world);
}

/* ---------- Input wiring ---------- */

// Setup is where a player picks their type with their own keys. The game ignores these.
onSeatKey((i, action) => {
  if (state.screen !== 'setup') return;
  if (action === 'left') cyclePick(i, -1);
  if (action === 'right') cyclePick(i, 1);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();   // Space would otherwise scroll the page or press a focused button twice
    if (e.repeat) return;
    if (state.screen === 'setup') startMatch();
    else if (state.world && state.world.phase === 'done') rematch();
    return;
  }
  if (state.screen !== 'game') return;
  if (e.code === 'Escape' && !e.repeat) togglePause();
  if (state.paused && e.code === 'KeyN') {
    beginMatch();
  } else if (state.paused && e.code === 'KeyM') {
    showSetup();
  }
});

function updateNote() {
  $('note').hidden = window.innerWidth >= NOTE_BELOW_PX;
}

function boot() {
  buildSetup();
  buildGame();

  if (typeof createWorld !== 'function') {
    $('setup-error').hidden = false;
    $('start').disabled = true;
  }

  $('start').addEventListener('click', startMatch);
  $('rematch').addEventListener('click', rematch);
  $('change').addEventListener('click', showSetup);

  new ResizeObserver(() => {
    if (state.screen === 'game') sizeCanvas();
  }).observe($('field-box'));

  window.addEventListener('resize', updateNote);
  updateNote();
  updateGamepadBadges();
  setInterval(updateGamepadBadges, 500);   // pads often connect after the page loads
  showSetup();
}

boot();
