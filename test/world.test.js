/* Behaviour tests for the BIOBUZZ 2D world. Run from the repo root with:
   node 2d/test/world.test.js

   rules.js and world.js are classic scripts that share globals, so both are loaded into one
   vm context, in order. The tests call the same functions the game calls, and they check what
   a player would see: positions, banked points, the contents of a FLOWER, and the score. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ Math, console });
for (const file of ['rules.js', 'world.js']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  vm.runInContext(source, ctx, { filename: file });
}

const { createWorld, stepWorld, scoreOf } = ctx;
const NECTAR_RADIUS = vm.runInContext('ELEMENT.nectar.r', ctx);
const POLLEN_RADIUS = vm.runInContext('ELEMENT.pollen.r', ctx);
const ZONES = vm.runInContext('ZONES', ctx);
const FLOWERS = vm.runInContext('FLOWERS', ctx);

const STEP = 1 / 30;

function setupWorld(archetypes) {
  const robots = Object.entries(archetypes).map(([slot, archetype]) => ({ slot, archetype }));
  return createWorld({ robots });
}

function robotOf(world, slot) {
  return world.robots.find(robot => robot.slot === slot);
}

function runFor(world, seconds, inputs) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) stepWorld(world, STEP, inputs || {});
}

function runUntil(world, done, inputs, maxSteps) {
  for (let i = 0; i < maxSteps && !done(world); i++) stepWorld(world, STEP, inputs || {});
}

function runUntilPhase(world, phase) {
  runUntil(world, w => w.phase === phase, {}, 20000);
  assert.strictEqual(world.phase, phase, `never reached phase ${phase}`);
}

function ballInRect(ball, rect) {
  return ball.x >= rect.x0 && ball.x <= rect.x1 && ball.y >= rect.y0 && ball.y <= rect.y1;
}

/* A NECTAR ball put straight into a robot's hand. Intake is covered by the G408 test, so this
   one only exercises dropping. */
function nectarBall(color) {
  return { id: 9001, kind: 'nectar', color, r: NECTAR_RADIUS, x: 0, y: 0, vx: 0, vy: 0, air: null };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('setup puts 40 POLLEN on the field, in FLOWERS, GARDENS and robots', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'nectar', B1: 'hybrid', B2: 'pollen' });
  const inFlowers = world.flowers.reduce((n, f) => n + f.stack.filter(b => b.kind === 'pollen').length, 0);
  const held = world.robots.reduce((n, r) => n + r.held.filter(b => b.kind === 'pollen').length, 0);
  const onFloor = world.balls.filter(b => b.kind === 'pollen').length;
  assert.strictEqual(inFlowers, 16);
  assert.strictEqual(held, 12);
  assert.strictEqual(onFloor, 12, '8 in the two GARDENS plus the 4 the NECTAR robot starts with');
  assert.strictEqual(inFlowers + held + onFloor, 40);
});

test('setup puts 3 red or blue NECTAR in each starting CELL and 5 in each reserve', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'nectar', B1: 'hybrid', B2: 'pollen' });
  assert.strictEqual(world.hives.blue.up, 0);
  assert.strictEqual(world.hives.red.up, 1);
  const blueCell = world.hives.blue.cells[world.hives.blue.up];
  const redCell = world.hives.red.cells[world.hives.red.up];
  assert.strictEqual(blueCell.length, 3);
  assert.strictEqual(redCell.length, 3);
  assert.ok(blueCell.every(b => b.kind === 'nectar' && b.color === 'blue'));
  assert.ok(redCell.every(b => b.kind === 'nectar' && b.color === 'red'));
  /* Compared field by field: objects built inside the vm context fail deepStrictEqual
     against objects built here, because the two realms have different prototypes. */
  assert.strictEqual(world.reserve.red, 5);
  assert.strictEqual(world.reserve.blue, 5);
});

test('a NECTAR robot starts with no POLLEN in its hand, and 4 POLLEN on the floor in front of it', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'nectar', B1: 'hybrid', B2: 'pollen' });
  const nectarBot = robotOf(world, 'R2');
  assert.strictEqual(nectarBot.held.length, 0);
  const nearby = world.balls.filter(b => b.kind === 'pollen' && Math.hypot(b.x - nectarBot.x, b.y - nectarBot.y) < 0.3);
  assert.strictEqual(nearby.length, 4);
});

test('the phases run countdown, auto, transition, teleop, settle, done and stop at 163 seconds', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'nectar', B1: 'hybrid', B2: 'pollen' });
  const seen = [world.phase];
  let steps = 0;
  while (world.phase !== 'done' && steps < 6000) {
    const before = world.phase;
    stepWorld(world, STEP, {});
    if (world.phase !== before) seen.push(world.phase);
    steps += 1;
  }
  assert.deepStrictEqual(seen, ['countdown', 'auto', 'transition', 'teleop', 'settle', 'done']);
  assert.ok(world.time > 162.9 && world.time < 163.1, `match took ${world.time} s`);
  assert.ok(world.final !== null, 'final score is frozen at done');
  assert.strictEqual(scoreOf(world), world.final);
});

test('a robot driven forward in AUTO moves along +x until the HIVE frame stops it, and LEAVE pays only for the robot off its wall', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'pollen' });
  runUntilPhase(world, 'auto');
  const driver = robotOf(world, 'R1');
  const startX = driver.x;
  const startY = driver.y;
  runFor(world, 1, { R1: { drive: 1, turn: 0, fire: false } });
  assert.ok(driver.x - startX > 0.5, `moved only ${driver.x - startX} m`);
  assert.ok(Math.abs(driver.y - startY) < 0.01, 'drove straight along x');
  assert.ok(driver.x > -1.0, 'nothing in its way: it drives in under the HIVE');

  runUntilPhase(world, 'transition');
  assert.strictEqual(world.banked.red.leave, 3, 'only R1 left its wall');
  assert.strictEqual(world.banked.blue.leave, 0, 'blue robots never moved off their walls');
});

test('a POLLEN robot in front of its alliance CELL tips the HIVE after 3 POLLEN, and the tip spawns NECTAR in the LOADING ZONE', () => {
  const world = setupWorld({ R1: 'hybrid', R2: 'nectar', B1: 'pollen', B2: 'nectar' });
  runUntilPhase(world, 'auto');
  /* Blue's up CELL is at the -x end of the blue half. Facing +x from x = -1.45 gives the shot
     about 0.54 m of flight before it reaches the CELL, which is past the 0.5 m arming distance. */
  const shooter = robotOf(world, 'B1');
  shooter.x = -1.45;
  shooter.y = -0.25;
  shooter.heading = 0;
  runUntil(world, w => w.banked.blue.hive >= 20, { B1: { drive: 0, turn: 0, fire: true } }, 600);

  assert.strictEqual(world.banked.blue.hive, 20);
  assert.strictEqual(world.hives.blue.up, 1, 'the CELL that was up is now the other end');
  assert.strictEqual(shooter.held.length, 1, 'exactly three POLLEN were fired before the tip');
  assert.strictEqual(world.reserve.blue, 4);
  const dropped = world.balls.filter(b => b.kind === 'nectar' && b.color === 'blue' && ballInRect(b, ZONES.loading.blue));
  assert.strictEqual(dropped.length, 1);
  assert.ok(world.events.some(e => e.text === 'BLUE HIVE TIPPED +20, 6 back in play'));
});

test('a tip recycles the CELL: its 6 elements fly out, land past the frame, and can be collected again', () => {
  const world = setupWorld({ R1: 'hybrid', R2: 'nectar', B1: 'pollen', B2: 'nectar' });
  runUntilPhase(world, 'auto');
  const total = () => world.balls.length + world.robots.reduce((n, r) => n + r.held.length, 0)
    + world.flowers.reduce((n, f) => n + f.stack.length, 0)
    + ['red', 'blue'].reduce((n, a) => n + world.hives[a].cells[0].length + world.hives[a].cells[1].length, 0);
  const before = total();
  const shooter = robotOf(world, 'B1');
  shooter.x = -1.45;
  shooter.y = -0.25;
  shooter.heading = 0;
  runUntil(world, w => w.banked.blue.hive >= 20, { B1: { drive: 0, turn: 0, fire: true } }, 600);

  const spilled = world.balls.filter(b => b.air && b.air.spill);
  assert.strictEqual(spilled.length, 6, '3 starting NECTAR and 3 POLLEN fly out');
  assert.ok(spilled.every(b => b.x < -0.628), 'out past the -x end of the frame');
  assert.strictEqual(world.hives.blue.cells[0].length, 0);
  assert.ok(world.fx.some(f => f.kind === 'spill' && f.alliance === 'blue' && f.count === 6));
  assert.strictEqual(world.fx.filter(f => f.kind === 'cell').length, 3, 'one splash per POLLEN that went in');

  runFor(world, 1, {});
  assert.ok(spilled.every(b => b.air === null), 'all six are back on the tiles');
  assert.strictEqual(total(), before + 1, 'nothing lost: the only new ball is the NECTAR the tip unlocked');
});

test('a POLLEN robot whose intake touches a FLOWER pulls its POLLEN out at once, as many as it has room for', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'nectar' });
  runUntilPhase(world, 'auto');
  const bot = robotOf(world, 'B1');
  bot.held.length = 1;          // room for 3 more
  bot.x = 1.408;                // same spot as the G410 test: front point at the blue wall FLOWER
  bot.y = -0.594;
  bot.heading = 0;
  const flower = world.flowers[3];
  stepWorld(world, STEP, {});
  assert.strictEqual(bot.atFlower, 3);
  assert.strictEqual(bot.held.length, 4, 'full after one step');
  assert.strictEqual(flower.stack.length, 1, '3 of the 4 starting POLLEN came out, 1 is left');
});

test('G410: a NECTAR robot at a FLOWER cannot drop NECTAR until the last minute, then it can and scores for it', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'nectar' });
  runUntilPhase(world, 'auto');
  const nectarBot = robotOf(world, 'B2');
  /* The blue wall FLOWER is index 3. This spot puts the robot's front point about 0.04 m from
     its centre, which is inside the FLOWER reach, and keeps the robot outside the FLOWER. */
  nectarBot.x = 1.408;
  nectarBot.y = -0.594;
  nectarBot.heading = 0;
  nectarBot.held.push(nectarBall('blue'));
  const flower = world.flowers[3];
  assert.deepStrictEqual([flower.x, flower.y], [FLOWERS[3].x, FLOWERS[3].y]);

  runFor(world, 1, { B2: { drive: 0, turn: 0, fire: true } });
  assert.strictEqual(nectarBot.atFlower, 3);
  assert.strictEqual(flower.stack.length, 4, 'the FLOWER still has its 4 starting POLLEN');
  assert.ok(!flower.stack.some(b => b.kind === 'nectar'));
  assert.strictEqual(nectarBot.held.length, 1, 'the NECTAR is still in hand');
  assert.ok(world.events.some(e => e.text === 'NECTAR goes in FLOWERS at 1:00 (G410)'));

  runUntilPhase(world, 'teleop');
  runUntil(world, w => w.teleopLeft <= 60, {}, 5000);
  assert.ok(world.teleopLeft <= 60);
  runUntil(world, () => nectarBot.held.length === 0, { B2: { drive: 0, turn: 0, fire: true } }, 200);
  assert.strictEqual(flower.stack.length, 5);
  assert.strictEqual(flower.stack[4].kind, 'nectar');
  assert.strictEqual(flower.stack[4].color, 'blue');

  const score = scoreOf(world);
  assert.strictEqual(score.blue.flower, 13, 'bottom NECTAR 5, plus 2 for each of the 4 elements above the middle ring');
  assert.strictEqual(score.red.flower, 0);
});

test('G408: a NECTAR robot does not take the opponent NECTAR it drives over, but takes its own', () => {
  const build = color => {
    const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'nectar' });
    runUntilPhase(world, 'auto');
    const bot = robotOf(world, 'B2');
    const forward = 0.25;
    world.balls.push({
      id: 9100, kind: 'nectar', color, r: NECTAR_RADIUS,
      x: bot.x + Math.cos(bot.heading) * forward,
      y: bot.y + Math.sin(bot.heading) * forward,
      vx: 0, vy: 0, air: null
    });
    stepWorld(world, STEP, {});
    return { world, bot };
  };

  const opponent = build('red');
  assert.strictEqual(opponent.bot.held.length, 0, 'opponent NECTAR was not taken');
  assert.ok(opponent.world.balls.some(b => b.id === 9100), 'and it is still on the floor');

  const own = build('blue');
  assert.strictEqual(own.bot.held.length, 1, 'own NECTAR was taken');
  assert.ok(!own.world.balls.some(b => b.id === 9100));
});

test('a POLLEN dropped in the red GARDEN adds 1 to the red GARDEN score, whatever its colour', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'pollen' });
  const before = scoreOf(world);
  assert.strictEqual(before.red.garden, 4, 'the red GARDEN starts with 4 POLLEN');
  assert.strictEqual(before.blue.garden, 4, 'and the blue GARDEN starts with 4 POLLEN');

  world.balls.push({ id: 9200, kind: 'pollen', color: 'yellow', r: POLLEN_RADIUS, x: -1.5, y: 1.755, vx: 0, vy: 0, air: null });
  const after = scoreOf(world);
  assert.strictEqual(after.red.garden, 5);
  assert.strictEqual(after.blue.garden, 4);

  world.balls.push({ id: 9201, kind: 'nectar', color: 'blue', r: NECTAR_RADIUS, x: -1.5, y: 1.72, vx: 0, vy: 0, air: null });
  assert.strictEqual(scoreOf(world).red.garden, 6, 'a blue NECTAR in the red GARDEN still scores for red');
});

let passed = 0;
const failures = [];
test('a FLOWER holds 8 POLLEN or 5 NECTAR, and its bottom POLLEN is below the scoring volume', () => {
  const fill = kind => {
    const stack = [];
    while (vm.runInContext('flowerHasRoom', ctx)(stack)) stack.push({ kind });
    return stack.length;
  };
  assert.strictEqual(fill('pollen'), 8);
  assert.strictEqual(fill('nectar'), 5);
  const scored = vm.runInContext('flowerScoredCount', ctx);
  assert.strictEqual(scored([{ kind: 'pollen' }]), 0, 'a lone POLLEN on the lower ring scores nothing');
  assert.strictEqual(scored([{ kind: 'pollen' }, { kind: 'pollen' }, { kind: 'pollen' }, { kind: 'pollen' }]), 3);
  assert.strictEqual(scored([{ kind: 'nectar' }]), 1);
});

function pollenBall(id) {
  return { id, kind: 'pollen', color: 'yellow', r: POLLEN_RADIUS, x: 0, y: 0, vx: 0, vy: 0, air: null };
}

test('a HIVE tips again and again: after the tip settles, the new up CELL takes shots and tips too', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'nectar' });
  runUntilPhase(world, 'auto');
  const shooter = robotOf(world, 'B1');
  shooter.x = -1.45;
  shooter.y = -0.25;
  shooter.heading = 0;
  runUntil(world, w => w.banked.blue.hive >= 20, { B1: { drive: 0, turn: 0, fire: true } }, 600);
  assert.strictEqual(world.hives.blue.up, 1);

  runFor(world, 1, {});
  assert.strictEqual(world.hives.blue.tipT, 0, 'the tip has finished');

  // 7 POLLEN already in the +x CELL, so the next one tips it (8 POLLEN, Field Setup Guide 12.3).
  for (let i = 0; i < 7; i++) world.hives.blue.cells[1].push(pollenBall(9200 + i));
  shooter.x = 1.45;
  shooter.y = -0.25;
  shooter.heading = Math.PI;
  runUntil(world, w => w.banked.blue.hive >= 40, { B1: { drive: 0, turn: 0, fire: true } }, 300);
  assert.strictEqual(world.hives.blue.tips, 2);
  assert.strictEqual(world.banked.blue.hive, 40);
  assert.strictEqual(world.hives.blue.up, 0, 'back to the first CELL');
});

test('shots auto-aim, but only from past the end of the HIVE: a robot beside it cannot fire', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'nectar' });
  runUntilPhase(world, 'auto');
  const bot = robotOf(world, 'B1');
  bot.x = -0.3;
  bot.y = -1.2;
  bot.heading = Math.PI / 2;
  runFor(world, 0.5, { B1: { drive: 0, turn: 0, fire: true } });
  assert.strictEqual(bot.held.length, 4, 'nothing was launched');
  assert.ok(world.events.some(e => e.text === 'Get past the end of your HIVE to shoot'));

  // Facing away from the HIVE does not matter: the turret aims for the robot.
  bot.x = -1.2;
  bot.y = -1.2;
  bot.heading = Math.PI;
  runFor(world, 0.2, { B1: { drive: 0, turn: 0, fire: true } });
  assert.ok(bot.held.length < 4, 'past the end of the HIVE it fires');
  runFor(world, 1, {});
  assert.ok(world.hives.blue.cells[0].some(b => b.kind === 'pollen'), 'and the shot lands in the blue -x CELL');
});

test('a shot at a CELL that is down misses and stays on the field', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'nectar' });
  runUntilPhase(world, 'auto');
  assert.strictEqual(world.hives.red.up, 1, 'red starts with its +x CELL up');
  const bot = robotOf(world, 'R1');
  bot.x = -1.45;
  bot.y = 0.25;
  bot.heading = 0;
  runFor(world, 0.2, { R1: { drive: 0, turn: 0, fire: true } });
  runFor(world, 1.5, {});
  assert.strictEqual(world.hives.red.cells[0].length, 0, 'nothing went into the -x CELL');
  assert.strictEqual(world.hives.red.cells[1].length, 3, 'the up CELL still has only its 3 NECTAR');
  assert.strictEqual(world.hives.red.tips, 0);
  const underHive = world.balls.filter(b => b.kind === 'pollen' && b.air === null && b.x > -0.6096 && b.x < 0 && b.y > 0 && b.y < 0.5);
  assert.ok(underHive.length >= 1, 'the missed POLLEN fell through to the tiles under the HIVE');
});

test('robots drive under the HIVE from either end: only its two base bars, top and bottom, are solid', () => {
  const world = setupWorld({ R1: 'pollen', R2: 'pollen', B1: 'pollen', B2: 'nectar' });
  runUntilPhase(world, 'auto');
  const bot = robotOf(world, 'B1');
  bot.x = -0.95;   // clear of R1, which starts on the red wall at y = 0.05
  bot.y = 0;
  bot.heading = 0;
  runUntil(world, () => bot.x > 1.0, { B1: { drive: 1, turn: 0, fire: false } }, 600);
  assert.ok(bot.x > 1.0, `drove in at the -x end, under the HIVE and out at the +x end, reached x = ${bot.x}`);
  assert.ok(Math.abs(bot.y) < 0.01, `straight through, nothing pushed it sideways, y = ${bot.y}`);

  // Driving along y into the blue (top) bar stops it, with its edge on the bar's outer face.
  bot.x = 0;
  bot.y = -1.2;
  bot.heading = Math.PI / 2;
  runFor(world, 1.5, { B1: { drive: 1, turn: 0, fire: false } });
  assert.ok(Math.abs(bot.y - (-0.495 - 0.2286)) < 0.01, `stopped at the blue bar, y = ${bot.y}`);
});

for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  not ok - ${name}`);
    console.log(`    ${err.message.split('\n').join('\n    ')}`);
  }
}

if (failures.length > 0) {
  console.log(`${passed}/${tests.length} tests passed, ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log(`ok ${passed} tests`);
}
