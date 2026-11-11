/* BIOBUZZ 2D: the rules and the field, as data.
   Everything the game knows about BIOBUZZ lives here, so the physics (world.js) and the
   drawing (render.js) never hard-code a number. Sources are the Competition Manual, Team
   Update 02: section 9 (field), 10.3 (setup), 10.4 (match periods), 10.5 (scoring) and
   rules G407, G408, G410, G418, G426, G427.

   Units: metres and seconds. The origin is the centre of the field. +x points right (towards
   the blue ALLIANCE AREA), +y points down the screen. Red is on the left, as in 9.5.
   Headings are radians, 0 = facing +x, increasing clockwise on screen.

   Loaded as a classic script (no modules), so these consts are shared with the other files. */

const FIELD = {
  half: 1.7806,          // inside face of the perimeter wall, from the centre
  tile: 0.6096           // 24 in foam tiles, 6 x 6
};

/* Every robot is the same machine. The user asked for identical drivetrains, so the only
   thing that differs between robots is the mechanism (see ARCHETYPES). */
const ROBOT = {
  size: 0.4572,          // 18 in square, the starting size limit
  half: 0.2286,
  motorRpm: 312,
  wheelMm: 104,
  maxSpeed: 312 / 60 * Math.PI * 0.104,   // 1.70 m/s at the wheel
  accel: 5.0,            // m/s^2
  maxTurn: 3.6,          // rad/s
  turnAccel: 18,         // rad/s^2
  maxHeld: 4,            // G407: no more than 4 elements at a time
  collideR: 0.25         // robot-to-robot contact radius
};

/* The three robot types. Same drivetrain, different mechanism. The hybrid handles both
   elements, and pays for it with a slower shooter, otherwise it would beat the others at
   everything and nobody would pick them. */
const ARCHETYPES = {
  pollen: {
    name: 'Pollen Bot', letter: 'P',
    blurb: 'Picks up yellow POLLEN only. Fast shooter. Pulls POLLEN out of FLOWERS.',
    takesPollen: true, takesNectar: false, fireInterval: 0.25
  },
  nectar: {
    name: 'Nectar Bot', letter: 'N',
    blurb: 'Picks up your own NECTAR only. Fast shooter. NECTAR weighs more in the HIVE.',
    takesPollen: false, takesNectar: true, fireInterval: 0.25
  },
  hybrid: {
    name: 'Hybrid Bot', letter: 'H',
    blurb: 'Picks up both. Shoots at half the speed of the specialists.',
    takesPollen: true, takesNectar: true, fireInterval: 0.5
  }
};
const ARCHETYPE_ORDER = ['pollen', 'nectar', 'hybrid'];

const ELEMENT = {
  pollen: { r: 0.0356, count: 40 },     // 2.8 in, 9.8
  nectar: { r: 0.0457, perAlliance: 8 } // 3.6 in, 9.8
};

/* Ball physics on the tiles. */
const BALL = {
  rollFriction: 1.6,     // m/s^2 of slowdown while rolling
  wallBounce: 0.45,
  shotSpeed: 4.0,        // m/s while airborne
  shotRange: 1.8,        // an airborne ball lands this far from where it left the robot
  shotArmDist: 0.5,      // and can only drop into a CELL after flying at least this far
  landRoll: 0.6          // m/s it keeps rolling after it lands
};

/* HIVE structure, 9.6. The frame is 49.46 in by 38.95 in at the base, in the centre of the
   field, and robots and balls cannot pass through it. It holds two HIVES side by side: blue
   on the top half (y < 0), red on the bottom half. Each HIVE is a see-saw with a CELL at each
   end (end 0 at -x, end 1 at +x). One CELL faces up at a time.
   The manual's figures are 3D; this top-down layout is our reading of them. The blue +x end
   points at the blue-wall FLOWER and the red -x end at the red-wall one, which matches 10.3.1:
   the CELL that points at a FLOWER starts tilted down. */
const HIVE = {
  halfW: 0.628,          // frame half-width along x
  halfD: 0.495,          // frame half-depth along y
  cellInner: 0.27,       // a CELL spans |x| from here to halfW
  /* How full a CELL must be before it tips. The manual does not say, but the Event Field Setup
     Guide (V1.0, section 12.3) does: every CELL is ballasted to tip at 8 POLLEN alone, or at 3
     NECTAR + 3 POLLEN, and NOT at 7 POLLEN or 3 NECTAR + 2 POLLEN. These weights hit all four
     of those cases exactly. Mixes the guide does not list (1 NECTAR + 6 POLLEN, say) are our fit,
     and a real HIVE may tip a little earlier or later on them. */
  tipLoad: 15, pollenLoad: 2, nectarLoad: 3,
  tipTime: 0.6,          // seconds the tip animation takes; shots arriving then bounce off
  startUp: { blue: 0, red: 1 },
  startNectar: 3         // 10.3.1 B.i: 3 NECTAR of its own colour in each upward CELL
};

/* The CELL rectangle for one alliance's HIVE end, in field coordinates. */
function cellRect(alliance, end) {
  const y0 = alliance === 'blue' ? -HIVE.halfD : 0;
  const y1 = alliance === 'blue' ? 0 : HIVE.halfD;
  const x0 = end === 0 ? -HIVE.halfW : HIVE.cellInner;
  const x1 = end === 0 ? -HIVE.cellInner : HIVE.halfW;
  return { x0, x1, y0: y0 + 0.03, y1: y1 - 0.03 };
}

/* FLOWERS, 9.7: one on each perimeter wall. (nx, ny) points from the wall into the field. */
const FLOWERS = [
  { x: -1.728, y:  0.594, nx:  1, ny:  0 },   // red wall
  { x: -0.594, y: -1.728, nx:  0, ny:  1 },   // top wall
  { x:  0.594, y:  1.728, nx:  0, ny: -1 },   // bottom wall
  { x:  1.728, y: -0.594, nx: -1, ny:  0 }    // blue wall
];
const FLOWER = {
  r: 0.075,              // drawn and collision radius
  startPollen: 4,        // 10.3.1 A.i
  reach: 0.16,           // a robot's front must be this close to the centre to use it
  pullCooldown: 0.5,     // seconds between pulling POLLEN out of the bottom
  pullAfterDrop: 1.5,    // no pulling for this long after dropping something in
  /* Heights inside the tube, in inches above the tiles, from section 9.7. POLLEN rests on the
     lower ring (0.4 in tall). NECTAR is too wide for the middle ring's hole, so it sits on the
     middle ring, which is the top of the 3.55 in Retrieval Opening. The manual does not print the
     middle ring's height; 0.4 + 3.55 is our reading of Figure 9-12. */
  floorIn: 0.4,
  middleRingIn: 0.4 + 3.55,
  topRingIn: 21.5,
  sizeIn: { pollen: 2.8, nectar: 3.6 }
};

/* Where each element in a FLOWER sits: [bottom, top] in inches, for a stack listed bottom first.
   Each one rests on the one below it, and a NECTAR never goes lower than the middle ring. */
function flowerHeights(stack) {
  let z = FLOWER.floorIn;
  return stack.map(ball => {
    const bottom = ball.kind === 'nectar' ? Math.max(z, FLOWER.middleRingIn) : z;
    z = bottom + FLOWER.sizeIn[ball.kind];
    return [bottom, z];
  });
}

/* Another element fits while the column has not reached the top ring yet. That gives 8 POLLEN,
   or 5 NECTAR, with mixes in between. */
function flowerHasRoom(stack) {
  const h = flowerHeights(stack);
  return h.length === 0 || h[h.length - 1][1] < FLOWER.topRingIn;
}

/* 10.5.2: an element scores if any part of it is between the middle ring and the top ring.
   So the bottom POLLEN, sitting on the lower ring, is below the scoring volume and earns
   nothing. Every NECTAR counts, since it can never sit lower than the middle ring. */
function flowerScoredCount(stack) {
  return flowerHeights(stack).filter(([, top]) => top > FLOWER.middleRingIn).length;
}

/* Taped zones, 9.3. Rectangles in field coordinates. GARDENS are in opposite corners. */
const ZONES = {
  loading: {
    blue: { x0: 1.5012, x1: 1.7806, y0: 0.6072, y1: 1.1836 },
    red:  { x0: -1.7806, x1: -1.5012, y0: -1.1836, y1: -0.6072 }
  },
  garden: {
    blue: { x0: 1.2042, x1: 1.7806, y0: -1.7806, y1: -1.7298 },
    red:  { x0: -1.7806, x1: -1.2042, y0: 1.7298, y1: 1.7806 }
  }
};

/* Starting positions, touching the alliance's wall (so LEAVE has to be earned). Blue is red
   turned 180 degrees about the centre, like the real field. */
const STARTS = {
  red:  [{ x: -FIELD.half + ROBOT.half, y: 0.05, heading: 0 },
         { x: -FIELD.half + ROBOT.half, y: 1.25, heading: 0 }],
  blue: [{ x: FIELD.half - ROBOT.half, y: -0.05, heading: Math.PI },
         { x: FIELD.half - ROBOT.half, y: -1.25, heading: Math.PI }]
};

/* Match periods, 10.4, as a table the world steps through in order. `drive` says whether
   robots take input. `clock` is what the big timer counts down. */
const PHASES = [
  { id: 'countdown',  label: 'GET READY',  dur: 3,   drive: false },
  { id: 'auto',       label: 'AUTO',       dur: 30,  drive: true  },
  { id: 'transition', label: 'TRANSITION', dur: 8,   drive: false },
  { id: 'teleop',     label: 'TELEOP',     dur: 120, drive: true  },
  { id: 'settle',     label: 'FINAL',      dur: 2,   drive: false },
  { id: 'done',       label: 'MATCH OVER', dur: Infinity, drive: false }
];
/* G410 and G426 both key off 60 seconds left in the match. */
const LAST_MINUTE = 60;

/* Table 10-2. */
const POINTS = {
  leave: 3,              // AUTO only, robot no longer touching the perimeter wall
  autoPark: 5,           // end of AUTO, robot at least partly in its LOADING ZONE
  park: 5,               // end of match, same
  tip: 20,               // per HIVE TIP, AUTO or TELEOP
  cell: 2,               // per element left in an upward CELL at the end
  bottomNectar: 5,       // per FLOWER, to the alliance with the lowest NECTAR in it
  flowerElement: 2,      // per element in a FLOWER, to its owner (highest NECTAR)
  garden: 1              // per element at least partly in the GARDEN, to the garden's colour
};
const SCORE_KEYS = ['leave', 'autoPark', 'hive', 'cell', 'flower', 'garden', 'park'];
const SCORE_LABELS = {
  leave: 'Leave', autoPark: 'Auto park', hive: 'Hive tips', cell: 'Left in cell',
  flower: 'Flowers', garden: 'Garden', park: 'Park'
};

const NECTAR_RESERVE = 5;  // 10.3.1 B.ii, held by the drive team in the ALLIANCE AREA

/* The four seats. Keys are KeyboardEvent.code values so they work on any keyboard layout.
   Each player's fire key sits up and left of their forward key. */
const SEATS = [
  { slot: 'R1', alliance: 'red',  index: 0, keys: { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', fire: ['KeyQ'] },
    keyLabels: { fwd: 'W', back: 'S', left: 'A', right: 'D', fire: 'Q' } },
  { slot: 'R2', alliance: 'red',  index: 1, keys: { fwd: 'KeyT', back: 'KeyG', left: 'KeyF', right: 'KeyH', fire: ['KeyR'] },
    keyLabels: { fwd: 'T', back: 'G', left: 'F', right: 'H', fire: 'R' } },
  { slot: 'B1', alliance: 'blue', index: 0, keys: { fwd: 'KeyI', back: 'KeyK', left: 'KeyJ', right: 'KeyL', fire: ['KeyU'] },
    keyLabels: { fwd: 'I', back: 'K', left: 'J', right: 'L', fire: 'U' } },
  { slot: 'B2', alliance: 'blue', index: 1, keys: { fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: ['Enter', 'NumpadEnter', 'ShiftRight'] },
    keyLabels: { fwd: '↑', back: '↓', left: '←', right: '→', fire: 'Enter' } }
];

const COLORS = {
  red: '#e5484d', redDark: '#9b2226', redSoft: '#ffd6d6',
  blue: '#3e7bfa', blueDark: '#1d3f8f', blueSoft: '#d6e4ff',
  pollen: '#ffd23f', pollenEdge: '#b8901a',
  tile: '#3a3f47', tileLine: '#4a505a', wall: '#1b1e23',
  frame: '#6b7280', ink: '#f5f7fa', muted: '#9aa3ad'
};

/* THE WORLD, the one object world.js owns and render.js only reads:
   world = {
     time, phase (a PHASES id), phaseIndex, phaseTime (seconds into the phase), nextId,
     teleopLeft (seconds left in TELEOP, 120 until TELEOP starts),
     robots: [{ slot, alliance, archetype, x, y, heading, v (forward m/s), omega,
                held: [ball], fireCooldown, pullCooldown, sinceDrop, atFlower (index|-1),
                left (true once off the wall in AUTO), hint (short text for the HUD),
                refuseCooldown }],
     balls:  [{ id, kind: 'pollen'|'nectar', color: 'yellow'|'red'|'blue', r, x, y, vx, vy,
                air: null | { dx, dy, flown, range, owner } }]      floor and airborne only
     hives:  { red: { up: 0|1, cells: [[ball], [ball]], tipT, tips },  blue: same }
     flowers: [{ ...FLOWERS[i], stack: [ball] }]                    bottom first
     reserve: { red, blue }, released: { red: bool, blue: bool }     NECTAR still off field
     releaseT: { red, blue }                                        timers for last-minute drops
     banked: { red: { leave, autoPark, hive }, blue: same }          points already locked in
     events: [{ t, text, alliance|null }]                           newest last, for toasts
     final: null | score                                            frozen when phase hits done
   }
   score = { red: { total, leave, autoPark, hive, cell, flower, garden, park }, blue: same } */
