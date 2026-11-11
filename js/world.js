/* BIOBUZZ 2D world: the moving parts and the rules that act on them.
   Every number that the game defines lives in rules.js, which loads first. This file holds
   the behaviour: robots drive and push, balls roll, fly and land, HIVE cells tip, and the
   score is worked out from the state. render.js only reads the world object. It never
   changes it, so the drawing can be swapped without touching the rules.

   Loaded as a classic script, so every top-level name is shared with the other files. */

/* Simulation settings that are not game rules. They are gathered here so every number that
   is not from the manual is visible in one place. */
const WORLD_TUNING = {
  maxStep: 1 / 90,        // small steps so a fast ball cannot skip over a wall in one frame
  eventKeep: 20,          // how many events the HUD can still read back
  refuseGap: 1.5,         // seconds between refusal messages, so holding fire does not spam
  releaseGap: 0.4,        // seconds between last-minute NECTAR drops
  spawnTries: 8,          // attempts to find an empty spot for a dropped NECTAR
  spillGap: 0.02,         // how far past the frame a tipped ball is placed
  spillFlySpeed: 1.6,     // m/s a spilled ball flies out of a tipped CELL
  spillRangeMin: 0.3,     // it lands 0.3 ...
  spillRangeRange: 0.4,   // ... to 0.7 m past the frame
  spillSpread: 0.7,       // radians either side of straight out
  fxKeep: 1.0,            // seconds an effect stays readable for render.js
  frontMargin: 0.05,      // the front point sits this far beyond the robot's edge
  intakeBack: 0.02,       // intake window, in robot-local metres, behind the front edge
  intakeFront: 0.03,      // and this far beyond the ball's own radius
  intakeWidth: 0.85,      // share of the half-width the intake window spans
  wallTouch: 0.01,        // closer than this to a perimeter wall counts as touching it
  preloadPollen: 4,       // POLLEN each robot starts with
  gardenPollen: 4,        // POLLEN set out in each GARDEN
  gardenGap: 0.01         // space between garden POLLEN, on top of touching
};

const WORLD_ALLIANCES = ['red', 'blue'];
const WORLD_NO_INPUT = { drive: 0, turn: 0, fire: false };
/* Which archetype flag decides whether a robot may take a ball of a given kind. A lookup
   table keeps the intake rule free of if/else chains on element names. */
const WORLD_TAKES_KEY = { pollen: 'takesPollen', nectar: 'takesNectar' };
/* How much each element weighs in a CELL. NECTAR weighs more, so a NECTAR-heavy HIVE tips
   with fewer balls. */
const WORLD_LOAD_BY_KIND = { pollen: HIVE.pollenLoad, nectar: HIVE.nectarLoad };

/* ---------- small helpers ---------- */

function clampValue(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/* Moves value towards target by at most maxStep, without overshooting. This is what makes
   the drive feel like a motor that takes time to spin up, not a switch. */
function approachValue(value, target, maxStep) {
  if (value < target) return Math.min(value + maxStep, target);
  return Math.max(value - maxStep, target);
}

function phaseDuration(id) {
  return PHASES.find(phase => phase.id === id).dur;
}

function phaseId(world) {
  return PHASES[world.phaseIndex].id;
}

/* G410 and G426 switch on at one minute left. The state stays on through FINAL and the end
   of the match, so a late drop is never refused. */
function lastMinuteStarted(world) {
  const id = phaseId(world);
  if (id === 'teleop') return world.teleopLeft <= LAST_MINUTE;
  return id === 'settle' || id === 'done';
}

const HIVE_BARS = hiveBars();

/* Pushes a ball out of the HIVE's base bars and bounces it off whichever one it hit. */
function bounceOffHiveBars(ball) {
  for (const bar of HIVE_BARS) {
    const n = pushOutOfRect(ball, ball.r, bar);
    if (n) bounceBall(ball, n.x, n.y);
  }
}

function pointInRect(x, y, rect) {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

function cellCentre(alliance, end) {
  const rect = cellRect(alliance, end);
  return { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
}

function isFloor(ball) {
  return ball.air === null;
}

/* ---------- robot geometry ---------- */

/* A rotated square's extent along each axis. The same number applies to x and y, since the
   square is the same on both axes. */
function aabbHalf(robot) {
  return ROBOT.half * (Math.abs(Math.cos(robot.heading)) + Math.abs(Math.sin(robot.heading)));
}

function robotFrontPoint(robot) {
  const reach = ROBOT.half + WORLD_TUNING.frontMargin;
  return {
    x: robot.x + Math.cos(robot.heading) * reach,
    y: robot.y + Math.sin(robot.heading) * reach
  };
}

/* Converts a field point into the robot's own frame: fwd runs out of the front, lat runs out
   of the robot's left side. The intake and the ball push both work in this frame, which keeps
   the rules simple no matter which way the robot faces. */
function toRobotLocal(robot, x, y) {
  const dx = x - robot.x;
  const dy = y - robot.y;
  const c = Math.cos(robot.heading);
  const s = Math.sin(robot.heading);
  return { fwd: dx * c + dy * s, lat: -dx * s + dy * c };
}

function fromRobotLocal(robot, fwd, lat) {
  const c = Math.cos(robot.heading);
  const s = Math.sin(robot.heading);
  return { x: robot.x + fwd * c - lat * s, y: robot.y + fwd * s + lat * c };
}

function touchesPerimeter(robot) {
  const gap = Math.min(FIELD.half - Math.abs(robot.x), FIELD.half - Math.abs(robot.y)) - aabbHalf(robot);
  return gap <= WORLD_TUNING.wallTouch;
}

function aabbOverlapsRect(robot, rect) {
  const e = aabbHalf(robot);
  return Math.min(robot.x + e, rect.x1) > Math.max(robot.x - e, rect.x0)
    && Math.min(robot.y + e, rect.y1) > Math.max(robot.y - e, rect.y0);
}

function overlapsOwnLoading(robot) {
  return aabbOverlapsRect(robot, ZONES.loading[robot.alliance]);
}

/* ---------- setup ---------- */

function emptyBank() {
  return { leave: 0, autoPark: 0, hive: 0 };
}

function makeBall(world, kind, color, x, y) {
  return { id: world.nextId++, kind, color, r: ELEMENT[kind].r, x, y, vx: 0, vy: 0, air: null };
}

function makeRobot(world, entry) {
  const seat = SEATS.find(s => s.slot === entry.slot);
  const start = STARTS[seat.alliance][seat.index];
  const robot = {
    slot: seat.slot,
    alliance: seat.alliance,
    archetype: entry.archetype,
    x: start.x,
    y: start.y,
    heading: start.heading,
    v: 0,
    omega: 0,
    held: [],
    fireCooldown: 0,
    sinceDrop: Infinity,     // Infinity means "nothing dropped yet", so pulling is allowed
    refuseCooldown: 0,
    atFlower: -1,
    left: false,
    hint: ''
  };
  if (ARCHETYPES[robot.archetype].takesPollen) {
    for (let i = 0; i < WORLD_TUNING.preloadPollen; i++) {
      robot.held.push(makeBall(world, 'pollen', 'yellow', robot.x, robot.y));
    }
  } else {
    /* A robot that cannot carry POLLEN starts with its POLLEN on the floor, touching its
       front edge, so it can drive over it. */
    placePollenInFront(world, robot, WORLD_TUNING.preloadPollen);
  }
  return robot;
}

/* Lines POLLEN up across the front edge. The gap of 0.001 m keeps them just outside the
   robot's push zone, so they are not shoved away before the first frame. */
function placePollenInFront(world, robot, count) {
  const r = ELEMENT.pollen.r;
  const spacing = 2 * r + WORLD_TUNING.gardenGap;
  const fwd = ROBOT.half + r + 0.001;
  for (let i = 0; i < count; i++) {
    const lat = (i - (count - 1) / 2) * spacing;
    const p = fromRobotLocal(robot, fwd, lat);
    world.balls.push(makeBall(world, 'pollen', 'yellow', p.x, p.y));
  }
}

/* The GARDEN is a thin strip, so the row runs along it starting at the end nearest that
   alliance's side wall. Math.sign of the start position gives that side: -1 for red, +1 for
   blue. */
function placeGardenPollen(world, alliance) {
  const zone = ZONES.garden[alliance];
  const r = ELEMENT.pollen.r;
  const wallSide = Math.sign(STARTS[alliance][0].x);
  const y = (zone.y0 + zone.y1) / 2;
  const step = 2 * r + WORLD_TUNING.gardenGap;
  for (let i = 0; i < WORLD_TUNING.gardenPollen; i++) {
    const x = wallSide * (FIELD.half - r - i * step);
    world.balls.push(makeBall(world, 'pollen', 'yellow', x, y));
  }
}

function createWorld(setup) {
  const world = {
    time: 0,
    phase: PHASES[0].id,
    phaseIndex: 0,
    phaseTime: 0,
    teleopLeft: phaseDuration('teleop'),
    robots: [],
    balls: [],
    hives: {},
    flowers: [],
    reserve: { red: NECTAR_RESERVE, blue: NECTAR_RESERVE },
    released: { red: false, blue: false },
    releaseT: { red: 0, blue: 0 },
    banked: { red: emptyBank(), blue: emptyBank() },
    events: [],
    fx: [],
    final: null,
    nextId: 1
  };

  /* A FLOWER's stack is bottom first, so the first ball pushed is the bottom element. */
  world.flowers = FLOWERS.map(flower => ({ ...flower, stack: [] }));
  for (const flower of world.flowers) {
    for (let i = 0; i < FLOWER.startPollen; i++) {
      flower.stack.push(makeBall(world, 'pollen', 'yellow', flower.x, flower.y));
    }
  }

  for (const alliance of WORLD_ALLIANCES) {
    placeGardenPollen(world, alliance);
    const hive = { up: HIVE.startUp[alliance], cells: [[], []], tipT: 0, tips: 0 };
    world.hives[alliance] = hive;
    const centre = cellCentre(alliance, hive.up);
    for (let i = 0; i < HIVE.startNectar; i++) {
      hive.cells[hive.up].push(makeBall(world, 'nectar', alliance, centre.x, centre.y));
    }
  }

  for (const entry of setup.robots) world.robots.push(makeRobot(world, entry));
  for (const robot of world.robots) updateHint(world, robot);
  return world;
}

/* ---------- events ---------- */

/* Pushes a message for the HUD. The list is capped, so a long match does not grow it without
   limit. */
function pushEvent(world, text, alliance) {
  world.events.push({ t: world.time, text, alliance });
  const extra = world.events.length - WORLD_TUNING.eventKeep;
  if (extra > 0) world.events.splice(0, extra);
}

/* Effects are the moments render.js animates: a shot leaving a robot, a ball dropping into a
   CELL, a ball landing, a CELL spilling. They change nothing in the game. */
function pushFx(world, kind, x, y, extra) {
  world.fx.push({ kind, x, y, t: world.time, ...extra });
}

/* A refusal is repeated every fire interval while the key is held. The cooldown stops the
   same message from flooding the screen. The refusal still happens every time. */
function refuse(world, robot, text) {
  if (robot.refuseCooldown > 0) return;
  robot.refuseCooldown = WORLD_TUNING.refuseGap;
  pushEvent(world, text, robot.alliance);
}

/* ---------- stepping ---------- */

/* Advances the clock, carrying leftover time into the next phase. Carrying the leftover
   keeps the phase boundaries exact, even when a frame straddles one. */
function advanceClock(world, h) {
  let left = h;
  while (left > 0) {
    const phase = PHASES[world.phaseIndex];
    const spent = Math.min(left, phase.dur - world.phaseTime);
    world.time += spent;
    world.phaseTime += spent;
    if (phase.id === 'teleop') world.teleopLeft = Math.max(0, world.teleopLeft - spent);
    left -= spent;
    const isLast = world.phaseIndex === PHASES.length - 1;
    if (isLast || world.phaseTime < phase.dur) break;
    enterPhase(world, world.phaseIndex + 1);
  }
}

function enterPhase(world, index) {
  const id = PHASES[index].id;
  world.phaseIndex = index;
  world.phase = id;
  world.phaseTime = 0;
  if (id === 'transition') bankEndOfAuto(world);
  if (id === 'done') world.final = computeScore(world);
}

function stepWorld(world, dt, inputs) {
  if (!(dt > 0)) return;   // time never runs backwards: a negative dt would push robots past their limits
  /* The whole dt is simulated, cut into small steps. Dropping time here would make the match
     run in slow motion on a slow computer. main.js caps dt for a tab waking up. */
  const steps = Math.max(1, Math.ceil(dt / WORLD_TUNING.maxStep));
  for (let i = 0; i < steps; i++) stepSubstep(world, dt / steps, inputs || {});
  world.fx = world.fx.filter(f => world.time - f.t < WORLD_TUNING.fxKeep);
}

function stepSubstep(world, h, inputs) {
  advanceClock(world, h);
  for (const alliance of WORLD_ALLIANCES) {
    const hive = world.hives[alliance];
    hive.tipT = Math.max(0, hive.tipT - h);
  }
  if (lastMinuteStarted(world)) startLastMinuteRelease(world);

  /* Robots only take input in phases that allow driving. Physics still runs in every phase,
     so balls keep rolling during the countdown and the transition. */
  const drives = PHASES[world.phaseIndex].drive;
  const commands = world.robots.map(robot => commandFor(robot, inputs, drives));

  world.robots.forEach((robot, i) => {
    driveRobot(robot, commands[i], h);
    tickRobotTimers(robot, h);
    if (phaseId(world) === 'auto' && !touchesPerimeter(robot)) robot.left = true;
  });
  separateRobots(world.robots);
  for (const robot of world.robots) resolveRobotStatics(world, robot);

  world.robots.forEach((robot, i) => {
    robot.atFlower = findFlowerAt(world, robot);
    robot.aim = aimFor(robot);
    pushFloorBallsFromRobot(world, robot);
    collectBalls(world, robot);
    if (drives) applyRobotActions(world, robot, commands[i]);
  });

  stepFloorBalls(world, h);
  stepAirborneBalls(world, h);
  stepNectarRelease(world, h);
  for (const robot of world.robots) updateHint(world, robot);
}

function commandFor(robot, inputs, drives) {
  if (!drives) return WORLD_NO_INPUT;
  return inputs[robot.slot] || WORLD_NO_INPUT;
}

/* ---------- robots ---------- */

/* Tank drive: forward speed and turn rate each ease towards their target. The heading then
   moves the robot along its own facing. */
function driveRobot(robot, cmd, h) {
  robot.v = approachValue(robot.v, cmd.drive * ROBOT.maxSpeed, ROBOT.accel * h);
  robot.omega = approachValue(robot.omega, cmd.turn * ROBOT.maxTurn, ROBOT.turnAccel * h);
  robot.heading += robot.omega * h;
  robot.x += Math.cos(robot.heading) * robot.v * h;
  robot.y += Math.sin(robot.heading) * robot.v * h;
}

function tickRobotTimers(robot, h) {
  robot.fireCooldown -= h;
  robot.sinceDrop += h;
  robot.refuseCooldown -= h;
}

/* Two robots are circles of collideR. Each one moves half of the overlap, so neither robot
   gets shoved more than the other. */
function separateRobots(robots) {
  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) {
      separatePair(robots[i], robots[j], 2 * ROBOT.collideR);
    }
  }
}

/* Pushes two circles apart until they are minDist apart, splitting the move evenly. */
function separatePair(a, b, minDist) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  if (d >= minDist) return;
  if (d === 0) {
    dx = 1;
    dy = 0;
    d = 1;
  }
  const push = (minDist - d) / 2;
  const nx = dx / d;
  const ny = dy / d;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
}

/* Walls, the HIVE's two base bars and FLOWERS are solid for robots. The rest of the HIVE is
   overhead, so a robot drives under it. Each FLOWER is a circle, matching how it is drawn. */
function resolveRobotStatics(world, robot) {
  const e = aabbHalf(robot);
  robot.x = clampValue(robot.x, -FIELD.half + e, FIELD.half - e);
  robot.y = clampValue(robot.y, -FIELD.half + e, FIELD.half - e);
  for (const bar of HIVE_BARS) pushOutOfRect(robot, e, bar);
  for (const flower of world.flowers) {
    pushOutOfCircle(robot, flower, FLOWER.r + ROBOT.half);
  }
}

/* Pushes a robot's square, or a ball's square, out of a rectangle along the axis that needs
   the least movement. Returns the outward normal of the face it left through, or null when
   there was no overlap. */
function pushOutOfRect(entity, e, rect) {
  const overlapX = Math.min(entity.x + e, rect.x1) - Math.max(entity.x - e, rect.x0);
  const overlapY = Math.min(entity.y + e, rect.y1) - Math.max(entity.y - e, rect.y0);
  if (overlapX <= 0 || overlapY <= 0) return null;

  const exits = [
    { move: entity.x + e - rect.x0, x: rect.x0 - e, y: entity.y, nx: -1, ny: 0 },
    { move: rect.x1 - (entity.x - e), x: rect.x1 + e, y: entity.y, nx: 1, ny: 0 },
    { move: entity.y + e - rect.y0, x: entity.x, y: rect.y0 - e, nx: 0, ny: -1 },
    { move: rect.y1 - (entity.y - e), x: entity.x, y: rect.y1 + e, nx: 0, ny: 1 }
  ];
  let best = exits[0];
  for (const exit of exits) if (exit.move < best.move) best = exit;
  entity.x = best.x;
  entity.y = best.y;
  return { x: best.nx, y: best.ny };
}

/* Pushes an entity's centre out of a circle of radius need. Returns the outward normal, or
   null if it was already clear. */
function pushOutOfCircle(entity, centre, need) {
  const dx = entity.x - centre.x;
  const dy = entity.y - centre.y;
  const d = Math.hypot(dx, dy);
  if (d >= need || d === 0) return null;
  const nx = dx / d;
  const ny = dy / d;
  entity.x += nx * (need - d);
  entity.y += ny * (need - d);
  return { x: nx, y: ny };
}

function findFlowerAt(world, robot) {
  const front = robotFrontPoint(robot);
  return world.flowers.findIndex(flower => Math.hypot(flower.x - front.x, flower.y - front.y) <= FLOWER.reach);
}

/* A robot is a rotated square. A floor ball inside it, grown by the ball's radius, is pushed
   out through the nearest face. The ball also picks up the robot's speed in that direction, so
   a ball pushed ahead of a driving robot keeps moving. */
function pushFloorBallsFromRobot(world, robot) {
  for (const ball of world.balls) {
    if (isFloor(ball)) pushBallOutOfRobot(robot, ball);
  }
}

function pushBallOutOfRobot(robot, ball) {
  const reach = ROBOT.half + ball.r;
  const local = toRobotLocal(robot, ball.x, ball.y);
  if (Math.abs(local.fwd) >= reach || Math.abs(local.lat) >= reach) return;

  const fwdSide = local.fwd >= 0 ? 1 : -1;
  const latSide = local.lat >= 0 ? 1 : -1;
  const fwdPen = reach - Math.abs(local.fwd);
  const latPen = reach - Math.abs(local.lat);
  const c = Math.cos(robot.heading);
  const s = Math.sin(robot.heading);
  let n;
  let depth;
  if (fwdPen <= latPen) {
    n = { x: c * fwdSide, y: s * fwdSide };
    depth = fwdPen;
  } else {
    n = { x: -s * latSide, y: c * latSide };
    depth = latPen;
  }
  ball.x += n.x * depth;
  ball.y += n.y * depth;

  const robotAlong = robot.v * (c * n.x + s * n.y);
  const ballAlong = ball.vx * n.x + ball.vy * n.y;
  if (robotAlong > ballAlong) {
    const extra = robotAlong - ballAlong;
    ball.vx += n.x * extra;
    ball.vy += n.y * extra;
  }
}

/* Intake is automatic. A floor ball in the front strip is taken if the robot's archetype
   wants that kind, the robot has room, and (for NECTAR) the ball is its own colour. */
function collectBalls(world, robot) {
  for (const ball of world.balls.slice()) {
    if (!isFloor(ball) || !canTake(robot, ball)) continue;
    const local = toRobotLocal(robot, ball.x, ball.y);
    if (!inIntakeWindow(local, ball)) continue;
    removeBall(world, ball);
    robot.held.push(ball);
  }
}

function canTake(robot, ball) {
  if (robot.held.length >= ROBOT.maxHeld) return false;
  if (!ARCHETYPES[robot.archetype][WORLD_TAKES_KEY[ball.kind]]) return false;
  /* G408: a robot never takes the opponent's NECTAR, even when it could take NECTAR. */
  return ball.kind !== 'nectar' || ball.color === robot.alliance;
}

function inIntakeWindow(local, ball) {
  const near = ROBOT.half - WORLD_TUNING.intakeBack;
  const far = ROBOT.half + ball.r + WORLD_TUNING.intakeFront;
  const width = ROBOT.half * WORLD_TUNING.intakeWidth;
  return local.fwd >= near && local.fwd <= far && Math.abs(local.lat) < width;
}

function applyRobotActions(world, robot, cmd) {
  if (cmd.fire) {
    if (robot.fireCooldown > 0) return;
    fireRobot(world, robot);
    robot.fireCooldown = ARCHETYPES[robot.archetype].fireInterval;
    return;
  }
  /* Pulling is a separate action, and it needs the fire key up. Otherwise one press would
     both drop a ball and pull one back out. */
  pullFromFlower(world, robot);
}

function fireRobot(world, robot) {
  if (robot.atFlower >= 0) {
    dropOnFlower(world, robot);
  } else {
    launchHeld(world, robot);
  }
}

function dropOnFlower(world, robot) {
  const ball = robot.held[0];
  if (!ball) return;
  const flower = world.flowers[robot.atFlower];
  if (!flowerHasRoom(flower.stack)) {
    refuse(world, robot, 'That FLOWER is full');
    return;
  }
  if (ball.kind === 'nectar' && !lastMinuteStarted(world)) {
    refuse(world, robot, 'NECTAR goes in FLOWERS at 1:00 (G410)');
    return;
  }
  robot.held.shift();
  ball.x = flower.x;
  ball.y = flower.y;
  flower.stack.push(ball);
  robot.sinceDrop = 0;
}

/* Pulls POLLEN out of the bottom of a FLOWER the moment the intake touches it, as many as the
   robot has room for. NECTAR is never pulled from the bottom (G418), so a bottom NECTAR stops
   the pull. */
function pullFromFlower(world, robot) {
  if (robot.atFlower < 0) return;
  if (!ARCHETYPES[robot.archetype].takesPollen) return;
  if (robot.sinceDrop <= FLOWER.pullAfterDrop) return;
  const stack = world.flowers[robot.atFlower].stack;
  while (robot.held.length < ROBOT.maxHeld && stack.length > 0 && stack[0].kind === 'pollen') {
    robot.held.push(stack.shift());
  }
}

/* Auto-aim, the way dsim does it: every robot has a turret that always points at the nearer
   CELL of its own HIVE, the one at the same end of the field (end 0 at -x, end 1 at +x). A
   CELL's mouth faces out along x, so a ball only goes in travelling inward. That means you can
   only shoot a CELL from its own end of the field, past the end of the HIVE frame.
   The aim does not care whether that CELL is up. A shot at a CELL that is down still goes, and
   misses, so players have to watch which end of their HIVE is live. */
function aimFor(robot) {
  const end = robot.x < 0 ? 0 : 1;
  const c = cellCentre(robot.alliance, end);
  const dx = c.x - robot.x;
  const dy = c.y - robot.y;
  const dist = Math.hypot(dx, dy);
  const outside = end === 0 ? robot.x <= -HIVE.halfW : robot.x >= HIVE.halfW;
  return { end, x: c.x, y: c.y, angle: Math.atan2(dy, dx), dist, outside, ok: outside && dist <= BALL.maxShot };
}

function launchHeld(world, robot) {
  if (robot.held.length === 0) return;
  const aim = robot.aim || aimFor(robot);
  if (!aim.outside) {
    refuse(world, robot, 'Get past the end of your HIVE to shoot');
    return;
  }
  if (!aim.ok) {
    refuse(world, robot, 'Too far: get closer to your HIVE');
    return;
  }
  const ball = robot.held.shift();
  const dx = Math.cos(aim.angle);
  const dy = Math.sin(aim.angle);
  ball.x = robot.x + dx * BALL.muzzle;
  ball.y = robot.y + dy * BALL.muzzle;
  ball.vx = 0;
  ball.vy = 0;
  ball.air = {
    dx,
    dy,
    flown: 0,
    range: Math.max(0, aim.dist - BALL.muzzle),
    owner: robot.slot,
    target: { alliance: robot.alliance, end: aim.end }
  };
  world.balls.push(ball);
  pushFx(world, 'shot', ball.x, ball.y, { slot: robot.slot, alliance: robot.alliance, dx, dy });
}

/* The hint is the short line the HUD shows under each robot. It tells the player what the
   next press will do. */
function updateHint(world, robot) {
  const count = robot.held.length;
  const aim = robot.aim;
  if (robot.atFlower >= 0 && count > 0) {
    robot.hint = 'At FLOWER: fire to drop in';
  } else if (count > 0 && aim && !aim.outside) {
    robot.hint = 'Get past the end of your HIVE to shoot';
  } else if (count > 0 && aim && !aim.ok) {
    robot.hint = 'Too far: get closer to your HIVE';
  } else if (count > 0 && aim && world.hives[robot.alliance].up !== aim.end) {
    robot.hint = 'This CELL is down: shots will miss';
  } else if (count > 0) {
    robot.hint = count >= ROBOT.maxHeld ? `Full (${count}/${ROBOT.maxHeld}): fire, auto-aimed` : 'Fire: auto-aimed at your CELL';
  } else {
    robot.hint = 'Empty: drive over balls';
  }
}

/* ---------- floor balls ---------- */

function removeBall(world, ball) {
  const index = world.balls.indexOf(ball);
  if (index >= 0) world.balls.splice(index, 1);
}

function bounceBall(ball, nx, ny) {
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn >= 0) return;
  const k = (1 + BALL.wallBounce) * vn;
  ball.vx -= k * nx;
  ball.vy -= k * ny;
}

function bounceOffFieldWalls(ball) {
  const lim = FIELD.half - ball.r;
  if (ball.x > lim) {
    ball.x = lim;
    bounceBall(ball, -1, 0);
  } else if (ball.x < -lim) {
    ball.x = -lim;
    bounceBall(ball, 1, 0);
  }
  if (ball.y > lim) {
    ball.y = lim;
    bounceBall(ball, 0, -1);
  } else if (ball.y < -lim) {
    ball.y = -lim;
    bounceBall(ball, 0, 1);
  }
}

/* Rolling slows the ball at a fixed rate. It never reverses, so a ball stops at zero rather
   than wobbling back and forth. */
function applyRollingFriction(ball, h) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed === 0) return;
  const next = Math.max(0, speed - BALL.rollFriction * h);
  const k = next / speed;
  ball.vx *= k;
  ball.vy *= k;
}

function stepFloorBalls(world, h) {
  const floor = world.balls.filter(isFloor);
  for (const ball of floor) {
    applyRollingFriction(ball, h);
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    bounceOffFieldWalls(ball);
    bounceOffHiveBars(ball);
    for (const flower of world.flowers) {
      const n = pushOutOfCircle(ball, flower, FLOWER.r + ball.r);
      if (n) bounceBall(ball, n.x, n.y);
    }
  }
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) {
      separatePair(floor[i], floor[j], floor[i].r + floor[j].r);
    }
  }
}

/* ---------- airborne balls ---------- */

function stepAirborneBalls(world, h) {
  for (const ball of world.balls.filter(b => !isFloor(b))) {
    stepAirborne(world, ball, h);
  }
}

/* An airborne ball ignores robots, balls and the HIVE. A shot comes down where it was aimed.
   It drops into its target CELL if that CELL is up, and otherwise falls through to the tiles
   under the HIVE: a miss. Only the CELL it was aimed at can take it. */
function stepAirborne(world, ball, h) {
  const air = ball.air;
  const travel = (air.speed || BALL.shotSpeed) * h;
  ball.x += air.dx * travel;
  ball.y += air.dy * travel;
  air.flown += travel;

  if (air.flown >= air.range && air.target && world.hives[air.target.alliance].up === air.target.end) {
    arriveAtCell(world, ball, air.target.alliance);
    return;
  }
  if (air.flown >= air.range || leavesField(ball)) {
    landBall(ball, 1);
    pushFx(world, 'land', ball.x, ball.y, { r: ball.r });
  }
}

function arriveAtCell(world, ball, alliance) {
  /* A HIVE that is mid-tip is not taking balls. The shot bounces back out instead. */
  if (world.hives[alliance].tipT > 0) {
    landBall(ball, -1);
    pushFx(world, 'land', ball.x, ball.y, { r: ball.r });
    return;
  }
  pushFx(world, 'cell', ball.x, ball.y, { color: ball.color });
  removeBall(world, ball);
  storeInCell(world, ball, alliance);
}

function storeInCell(world, ball, alliance) {
  const hive = world.hives[alliance];
  const centre = cellCentre(alliance, hive.up);
  ball.air = null;
  ball.vx = 0;
  ball.vy = 0;
  ball.x = centre.x;
  ball.y = centre.y;
  hive.cells[hive.up].push(ball);
  checkTip(world, alliance);
}

function leavesField(ball) {
  return Math.abs(ball.x) > FIELD.half || Math.abs(ball.y) > FIELD.half;
}

/* Landing turns the flight into a roll. A bounce (sign -1) reverses that roll, which is how
   a shot is sent back out of a HIVE that is tipping. */
function landBall(ball, sign) {
  const air = ball.air;
  ball.air = null;
  ball.vx = sign * air.dx * BALL.landRoll;
  ball.vy = sign * air.dy * BALL.landRoll;
  bounceOffFieldWalls(ball);
  bounceOffHiveBars(ball);
}

/* ---------- HIVE tipping ---------- */

function cellLoad(balls) {
  return balls.reduce((sum, ball) => sum + WORLD_LOAD_BY_KIND[ball.kind], 0);
}

function checkTip(world, alliance) {
  const hive = world.hives[alliance];
  if (hive.tipT > 0) return;
  if (cellLoad(hive.cells[hive.up]) < HIVE.tipLoad) return;
  tipHive(world, alliance);
}

function tipHive(world, alliance) {
  const hive = world.hives[alliance];
  const recycled = spillCell(world, alliance, hive.up);
  hive.up = 1 - hive.up;
  hive.tips += 1;
  hive.tipT = HIVE.tipTime;
  world.banked[alliance].hive += POINTS.tip;
  pushEvent(world, `${alliance.toUpperCase()} HIVE TIPPED +${POINTS.tip}, ${recycled} back in play`, alliance);
  releaseOneNectar(world, alliance);
}

/* Tips recycle. Everything in the tipped CELL pours out past the frame at that end and comes
   back into play, so the same POLLEN and NECTAR can be collected and LAUNCHED again. Each
   ball flies out in a short arc before it touches the tiles. Until then no robot can take it,
   which is G409: spilled elements must hit the floor before anyone collects them. A spilled
   ball cannot drop into a CELL either. Returns how many balls came out. */
function spillCell(world, alliance, end) {
  const hive = world.hives[alliance];
  const balls = hive.cells[end];
  hive.cells[end] = [];
  const rect = cellRect(alliance, end);
  const sign = end === 0 ? -1 : 1;
  const T = WORLD_TUNING;
  for (const ball of balls) {
    ball.x = sign * (HIVE.halfW + ball.r + T.spillGap);
    ball.y = rect.y0 + ball.r + Math.random() * (rect.y1 - rect.y0 - 2 * ball.r);
    const angle = (Math.random() * 2 - 1) * T.spillSpread;
    ball.vx = 0;
    ball.vy = 0;
    ball.air = {
      dx: sign * Math.cos(angle),
      dy: Math.sin(angle),
      flown: 0,
      range: T.spillRangeMin + Math.random() * T.spillRangeRange,
      owner: null,
      spill: true,
      speed: T.spillFlySpeed
    };
    world.balls.push(ball);
  }
  pushFx(world, 'spill', sign * HIVE.halfW, (rect.y0 + rect.y1) / 2, { alliance, count: balls.length, sign });
  return balls.length;
}

/* ---------- NECTAR entry ---------- */

function releaseOneNectar(world, alliance) {
  if (world.reserve[alliance] <= 0) return;
  world.reserve[alliance] -= 1;
  spawnInLoadingZone(world, alliance);
}

/* The human player drops NECTAR into the LOADING ZONE. A spot that is already taken is
   skipped, but only for a few tries, so the spawn never stalls. */
function spawnInLoadingZone(world, alliance) {
  const zone = ZONES.loading[alliance];
  const r = ELEMENT.nectar.r;
  let spot = null;
  for (let t = 0; t < WORLD_TUNING.spawnTries; t++) {
    spot = {
      x: zone.x0 + r + Math.random() * (zone.x1 - zone.x0 - 2 * r),
      y: zone.y0 + r + Math.random() * (zone.y1 - zone.y0 - 2 * r)
    };
    if (!overlapsFloorBall(world, spot.x, spot.y, r)) break;
  }
  world.balls.push(makeBall(world, 'nectar', alliance, spot.x, spot.y));
}

function overlapsFloorBall(world, x, y, r) {
  return world.balls.some(ball => isFloor(ball) && Math.hypot(ball.x - x, ball.y - y) < ball.r + r);
}

function startLastMinuteRelease(world) {
  if (world.released.red) return;
  for (const alliance of WORLD_ALLIANCES) {
    world.released[alliance] = true;
    world.releaseT[alliance] = 0;
  }
  pushEvent(world, 'Last minute: NECTAR in, FLOWERS open', null);
}

/* Last-minute NECTAR trickles in, one every releaseGap, so the drop is not one clump. */
function stepNectarRelease(world, h) {
  for (const alliance of WORLD_ALLIANCES) {
    if (!world.released[alliance] || world.reserve[alliance] <= 0) continue;
    world.releaseT[alliance] -= h;
    if (world.releaseT[alliance] <= 0) {
      releaseOneNectar(world, alliance);
      world.releaseT[alliance] += WORLD_TUNING.releaseGap;
    }
  }
}

/* ---------- phase banking ---------- */

/* LEAVE and AUTO PARK are decided once, at the end of AUTO, from where each robot is then. */
function bankEndOfAuto(world) {
  for (const robot of world.robots) {
    const bank = world.banked[robot.alliance];
    if (!touchesPerimeter(robot)) {
      bank.leave += POINTS.leave;
      pushEvent(world, `${robot.slot} LEAVE +${POINTS.leave}`, robot.alliance);
    }
    if (overlapsOwnLoading(robot)) {
      bank.autoPark += POINTS.autoPark;
      pushEvent(world, `${robot.slot} AUTO PARK +${POINTS.autoPark}`, robot.alliance);
    }
  }
}

/* ---------- scoring ---------- */

/* Live score, worked out from the current state every time. The match end freezes it. */
function computeScore(world) {
  const score = {};
  for (const alliance of WORLD_ALLIANCES) {
    const banked = world.banked[alliance];
    score[alliance] = {
      leave: banked.leave,
      autoPark: banked.autoPark,
      hive: banked.hive,
      cell: POINTS.cell * world.hives[alliance].cells[world.hives[alliance].up].length,
      flower: 0,
      garden: 0,
      park: 0
    };
  }
  addFlowerPoints(world, score);
  addGardenPoints(world, score);
  addParkPoints(world, score);
  for (const alliance of WORLD_ALLIANCES) {
    score[alliance].total = SCORE_KEYS.reduce((sum, key) => sum + score[alliance][key], 0);
  }
  return score;
}

/* FLOWER points only start in the last minute (10.5.2). A stack is bottom first, so the first
   NECTAR found is the bottom one, and the last is the top one, which owns the FLOWER. */
function addFlowerPoints(world, score) {
  if (!lastMinuteStarted(world)) return;
  for (const flower of world.flowers) {
    const nectar = flower.stack.filter(ball => ball.kind === 'nectar');
    if (nectar.length === 0) continue;
    const bottom = nectar[0];
    const top = nectar[nectar.length - 1];
    score[bottom.color].flower += POINTS.bottomNectar;
    score[top.color].flower += POINTS.flowerElement * flowerScoredCount(flower.stack);
  }
}

/* A floor ball counts for a GARDEN if any part of it touches the GARDEN. Its colour does not
   matter, the GARDEN points go to the colour the GARDEN belongs to. */
function addGardenPoints(world, score) {
  for (const alliance of WORLD_ALLIANCES) {
    const rect = ZONES.garden[alliance];
    for (const ball of world.balls) {
      if (isFloor(ball) && circleTouchesRect(ball, rect)) score[alliance].garden += POINTS.garden;
    }
  }
}

function circleTouchesRect(ball, rect) {
  const cx = clampValue(ball.x, rect.x0, rect.x1);
  const cy = clampValue(ball.y, rect.y0, rect.y1);
  return Math.hypot(ball.x - cx, ball.y - cy) <= ball.r;
}

/* PARK is only counted at the end of the match, so it is zero until the phase reaches
   FINAL. */
function addParkPoints(world, score) {
  const id = phaseId(world);
  if (id !== 'settle' && id !== 'done') return;
  for (const robot of world.robots) {
    if (overlapsOwnLoading(robot)) score[robot.alliance].park += POINTS.park;
  }
}

function scoreOf(world) {
  return world.final || computeScore(world);
}

if (typeof module !== 'undefined') module.exports = { createWorld, stepWorld, scoreOf };
