/* Drawing. Reads `world` and never writes to it.

   Two transforms are used. The field is drawn in metres (the units rules.js uses), so the
   drawing code can pass field numbers straight through. Text and small marks are drawn in
   screen pixels, because a font sized in metres would grow and shrink with the window. */

const ALLIANCE_STRIP = 0.35;       // width of each ALLIANCE AREA strip beside the field, metres
const FIT_FRACTION = 0.95;         // the field fills this share of the canvas, leaving a margin
const LOB_HEIGHT = 0.12;           // the highest a lobbed ball rises on screen, metres
const TOAST_SECS = 2.5;            // how long a toast stays on screen
const TOAST_MAX = 4;               // at most this many toasts at once
const TELEOP_BANNER_SECS = 1.2;    // how long the "TELEOP!" banner shows
const FONT = '"Fredoka", ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
const TAU = Math.PI * 2;
/* How long each effect plays, in seconds. world.fx keeps an effect for a second, so these
   must stay under that. */
const FX_SECS = { shot: 0.18, cell: 0.45, land: 0.3, spill: 0.9 };
const RECOIL_SECS = 0.12;          // a robot kicks back this long after a shot
const RECOIL_M = 0.03;             // and this far
const TRAIL = [0.05, 0.1, 0.15];   // ghost balls this far behind a flying ball, metres
const CANOPY_ALPHA = 0.72;         // the HIVE is overhead, so robots under it show through

function makeLayout(view) {
  const worldW = 2 * (FIELD.half + ALLIANCE_STRIP);
  const worldH = 2 * FIELD.half;
  const s = Math.min(view.width / worldW, view.height / worldH) * FIT_FRACTION;
  return {
    s,                                  // device-independent pixels per metre
    cx: view.width / 2,
    cy: view.height / 2,
    dpr: view.dpr,
    width: view.width,
    height: view.height
  };
}

function setFieldTransform(ctx, L) {
  ctx.setTransform(L.dpr * L.s, 0, 0, L.dpr * L.s, L.dpr * L.cx, L.dpr * L.cy);
}

function setScreenTransform(ctx, L) {
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
}

function fieldToScreen(L, x, y) {
  return { x: L.cx + x * L.s, y: L.cy + y * L.s };
}

// A line that should be n screen pixels wide, expressed in metres for the field transform.
function pxToM(L, n) {
  return n / L.s;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);   // older browsers: square corners beat a crash
}

/* Text is always drawn in screen pixels at (sx, sy). The transform is saved and restored
   around it, so whatever transform the caller was using is left unchanged. */
function drawText(ctx, L, str, sx, sy, o = {}) {
  ctx.save();
  setScreenTransform(ctx, L);
  if (o.rotate) {
    ctx.translate(sx, sy);
    ctx.rotate(o.rotate);
    sx = 0;
    sy = 0;
  }
  ctx.font = `${o.weight || 700} ${o.size || 14}px ${FONT}`;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.baseline || 'middle';
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  ctx.fillStyle = o.color || COLORS.ink;
  if (o.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 6;
  }
  ctx.fillText(str, sx, sy);
  ctx.restore();
}

// Draws a small padlock in screen pixels, centred on (sx, sy).
function drawPadlock(ctx, L, sx, sy) {
  ctx.save();
  setScreenTransform(ctx, L);
  ctx.strokeStyle = COLORS.muted;
  ctx.fillStyle = COLORS.muted;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(sx, sy - 2, 3.5, Math.PI, 0);   // the shackle is the upper half of a circle
  ctx.stroke();
  ctx.fillRect(sx - 5, sy - 2, 10, 8);
  ctx.restore();
}

/* One ball. Pollen is a yellow ball with an edge. Nectar is a team-coloured ball with a white
   highlight, so the two read apart at a glance and nectar looks shiny. */
function drawBall(ctx, L, kind, color, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  if (kind === 'pollen') {
    ctx.fillStyle = COLORS.pollen;
    ctx.fill();
    ctx.lineWidth = pxToM(L, 1.5);
    ctx.strokeStyle = COLORS.pollenEdge;
    ctx.stroke();
    return;
  }
  ctx.fillStyle = COLORS[color] || COLORS.muted;
  ctx.fill();
  ctx.lineWidth = pxToM(L, 1);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, TAU);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fill();
}

// How far a lobbed ball is through its flight, 0 at launch, 1 at the top, 0 at landing.
function lobHeight(air) {
  const range = air.range > 0 ? air.range : 1;
  const t = Math.min(1, Math.max(0, air.flown / range));
  return 4 * t * (1 - t);
}

/* ALLIANCE AREAs are the strips beside the field. Each one shows the NECTAR still held
   in reserve, as balls stacked down the middle, with a label. */
function drawAllianceAreas(ctx, L, world) {
  const half = FIELD.half;
  for (const a of ['red', 'blue']) {
    const x0 = a === 'red' ? -half - ALLIANCE_STRIP : half;
    const x1 = a === 'red' ? -half : half + ALLIANCE_STRIP;
    const cx = (x0 + x1) / 2;
    ctx.save();
    setFieldTransform(ctx, L);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = COLORS[a];
    ctx.fillRect(x0, -half, x1 - x0, 2 * half);
    ctx.globalAlpha = 1;
    const n = world.reserve[a];
    for (let i = 0; i < n; i++) {
      const y = (i - (n - 1) / 2) * 0.13;
      drawBall(ctx, L, 'nectar', a, cx, y, ELEMENT.nectar.r);
    }
    ctx.restore();
    const label = fieldToScreen(L, cx, -1.2);
    drawText(ctx, L, `NECTAR x${n}`, label.x, label.y, { size: 14, color: COLORS[a], rotate: -Math.PI / 2 });
  }
}

// The field floor: 6 x 6 foam tiles, seams between them, and a thick perimeter wall.
function drawField(ctx, L) {
  const h = FIELD.half;
  ctx.save();
  setFieldTransform(ctx, L);
  ctx.fillStyle = COLORS.tile;
  ctx.fillRect(-h, -h, 2 * h, 2 * h);
  ctx.strokeStyle = COLORS.tileLine;
  ctx.lineWidth = pxToM(L, 1.5);
  ctx.beginPath();
  // Seams sit on multiples of one tile. The loop runs past the edge, and the check drops
  // the lines that fall outside the inside face of the wall.
  for (let k = -3; k <= 3; k++) {
    const p = k * FIELD.tile;
    if (Math.abs(p) >= h) continue;
    ctx.moveTo(p, -h);
    ctx.lineTo(p, h);
    ctx.moveTo(-h, p);
    ctx.lineTo(h, p);
  }
  ctx.stroke();
  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = 0.06;
  ctx.strokeRect(-h, -h, 2 * h, 2 * h);
  ctx.restore();
}

// LOADING ZONES are outlined tape with a faint fill. GARDENS are solid tape strips.
function drawZones(ctx, L) {
  for (const a of ['red', 'blue']) {
    const loading = ZONES.loading[a];
    const garden = ZONES.garden[a];
    ctx.save();
    setFieldTransform(ctx, L);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = COLORS[a];
    ctx.fillRect(loading.x0, loading.y0, loading.x1 - loading.x0, loading.y1 - loading.y0);
    ctx.globalAlpha = 1;
    ctx.lineWidth = pxToM(L, 2);
    ctx.strokeStyle = COLORS[a];
    ctx.strokeRect(loading.x0, loading.y0, loading.x1 - loading.x0, loading.y1 - loading.y0);
    ctx.fillStyle = COLORS[a];
    ctx.fillRect(garden.x0, garden.y0, garden.x1 - garden.x0, garden.y1 - garden.y0);
    ctx.restore();

    const lc = fieldToScreen(L, (loading.x0 + loading.x1) / 2, (loading.y0 + loading.y1) / 2);
    drawText(ctx, L, 'LOADING', lc.x, lc.y, { size: 11, color: COLORS[a] });

    // The garden strip is too thin to hold its label, so the label sits just inside the field.
    const gy = (garden.y0 + garden.y1) / 2;
    const gc = fieldToScreen(L, (garden.x0 + garden.x1) / 2, gy + (gy < 0 ? 0.1 : -0.1));
    drawText(ctx, L, 'GARDEN', gc.x, gc.y, { size: 11, color: COLORS[a] });
  }
}

/* One CELL. The UP cell is open: a bright box holding its balls, with a meter for how
   full it is against the tip threshold. The DOWN cell is closed: dimmed, hatched, with a
   chevron pointing down. */
function drawCell(ctx, L, world, a, end) {
  const r = cellRect(a, end);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const up = world.hives[a].up === end;
  const cell = world.hives[a].cells[end] || [];

  ctx.save();
  setFieldTransform(ctx, L);
  ctx.globalAlpha = CANOPY_ALPHA;
  if (up) {
    ctx.globalAlpha = CANOPY_ALPHA * (0.3);
    ctx.fillStyle = COLORS[a];
    ctx.fillRect(r.x0, r.y0, w, h);
    ctx.globalAlpha = CANOPY_ALPHA * (1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x0, r.y0, w, h);
    ctx.clip();
    cell.forEach((b, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const bx = r.x0 + 0.07 + col * 0.095;
      const by = r.y1 - 0.06 - row * 0.09;
      const rad = Math.min(b.kind === 'pollen' ? ELEMENT.pollen.r : ELEMENT.nectar.r, 0.04);
      drawBall(ctx, L, b.kind, b.color, bx, by, rad);
    });
    ctx.restore();
    ctx.lineWidth = pxToM(L, 2.5);
    ctx.strokeStyle = COLORS[a];
    ctx.strokeRect(r.x0, r.y0, w, h);

    // The meter sits on the left edge and fills from the bottom of the cell.
    const load = cell.reduce((sum, b) => sum + (b.kind === 'pollen' ? HIVE.pollenLoad : HIVE.nectarLoad), 0);
    const frac = Math.min(1, load / HIVE.tipLoad);
    const mx = r.x0 + 0.025;
    const mw = 0.028;
    ctx.globalAlpha = CANOPY_ALPHA * (0.12);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(mx, r.y0, mw, h);
    ctx.globalAlpha = CANOPY_ALPHA * (1);
    ctx.fillStyle = COLORS.pollen;
    ctx.fillRect(mx, r.y1 - frac * h, mw, frac * h);
  } else {
    ctx.fillStyle = '#181b21';
    ctx.fillRect(r.x0, r.y0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x0, r.y0, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = pxToM(L, 2);
    ctx.beginPath();
    for (let t = -h; t < w; t += 0.06) {
      ctx.moveTo(r.x0 + t, r.y0);
      ctx.lineTo(r.x0 + t + h, r.y1);
    }
    ctx.stroke();
    ctx.restore();
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    ctx.lineWidth = pxToM(L, 3);
    ctx.strokeStyle = COLORS.muted;
    ctx.beginPath();
    ctx.moveTo(cx - 0.07, cy - 0.03);
    ctx.lineTo(cx, cy + 0.04);
    ctx.lineTo(cx + 0.07, cy - 0.03);
    ctx.stroke();
  }
  ctx.restore();
}

/* The HIVE's two base bars, the only part of it on the tiles. Drawn under the robots. */
function drawHiveBars(ctx, L) {
  ctx.save();
  setFieldTransform(ctx, L);
  ctx.fillStyle = COLORS.frame;
  for (const bar of hiveBars()) ctx.fillRect(bar.x0, bar.y0, bar.x1 - bar.x0, bar.y1 - bar.y0);
  ctx.restore();
}

/* The HIVE overhead: its two halves (blue top, red bottom), and each half's tip flash. The
   flash assumes tipT counts down from HIVE.tipTime to 0, so it fades out as the tip ends. */
function drawHive(ctx, L, world) {
  const { halfW, halfD, cellInner, tipTime } = HIVE;
  ctx.save();
  setFieldTransform(ctx, L);
  ctx.globalAlpha = CANOPY_ALPHA;
  roundRectPath(ctx, -halfW - 0.03, -halfD - 0.03, 2 * halfW + 0.06, 2 * halfD + 0.06, 0.04);
  ctx.fillStyle = '#1d2128';
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = COLORS.frame;
  ctx.stroke();
  ctx.restore();

  for (const a of ['blue', 'red']) {
    for (const end of [0, 1]) drawCell(ctx, L, world, a, end);
  }

  ctx.save();
  setFieldTransform(ctx, L);
  ctx.globalAlpha = CANOPY_ALPHA;
  ctx.fillStyle = COLORS.frame;
  ctx.fillRect(-halfW, -0.01, 2 * halfW, 0.02);             // the line between the two halves
  ctx.globalAlpha = CANOPY_ALPHA * (0.5);
  ctx.fillRect(-cellInner, -halfD, 2 * cellInner, halfD);   // the see-saw pivot, blue half
  ctx.fillRect(-cellInner, 0, 2 * cellInner, halfD);        // and red half
  ctx.globalAlpha = CANOPY_ALPHA * (1);
  for (const a of ['blue', 'red']) {
    const t = world.hives[a].tipT;
    if (!(t > 0)) continue;
    ctx.globalAlpha = CANOPY_ALPHA * (0.65 * Math.min(1, t / tipTime));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-halfW, a === 'blue' ? -halfD : 0, 2 * halfW, halfD);
  }
  ctx.restore();

  // Hive labels sit just outside the frame, on the blue side (top) and red side (bottom).
  for (const a of ['blue', 'red']) {
    const p = fieldToScreen(L, 0, a === 'blue' ? -halfD - 0.09 : halfD + 0.09);
    const word = a === 'blue' ? 'BLUE' : 'RED';
    drawText(ctx, L, `${word} HIVE   x${world.hives[a].tips} tips`, p.x, p.y, { size: 14, color: COLORS[a] });
  }
}

// The NECTAR owner of a FLOWER is the alliance of its top-most NECTAR, or null if none.
function ownerOf(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === 'nectar') return stack[i].color;
  }
  return null;
}

/* FLOWERS sit on the perimeter walls. The stack sticks out into the field, bottom nearest
   the wall, top furthest out. The ring takes the owner's colour once NECTAR is open. */
function drawFlowers(ctx, L, world) {
  const lastMinute = world.teleopLeft <= LAST_MINUTE;
  world.flowers.forEach((f, i) => {
    const visitor = world.robots.find(r => r.atFlower === i);
    const owner = lastMinute ? ownerOf(f.stack) : null;

    ctx.save();
    setFieldTransform(ctx, L);
    if (visitor) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, FLOWER.r + 0.035, 0, TAU);
      ctx.lineWidth = pxToM(L, 3);
      ctx.strokeStyle = COLORS[visitor.alliance];
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(f.x, f.y, FLOWER.r, 0, TAU);
    ctx.fillStyle = '#262b33';
    ctx.fill();
    ctx.lineWidth = pxToM(L, owner ? 3.5 : 2);
    ctx.strokeStyle = owner ? COLORS[owner] : COLORS.muted;
    ctx.stroke();
    f.stack.forEach((b, k) => {
      const d = FLOWER.r + 0.02 + k * 0.034;
      drawBall(ctx, L, b.kind, b.color, f.x + f.nx * d, f.y + f.ny * d, 0.015);
    });
    ctx.restore();

    const c = fieldToScreen(L, f.x, f.y);
    drawText(ctx, L, flowerHasRoom(f.stack) ? `${f.stack.length}` : 'FULL', c.x, c.y, { size: 10 });

    if (!lastMinute) {
      // NECTAR is locked until the last minute (G410). The lock sits beside the flower, along the wall.
      const px = -f.ny;
      const py = f.nx;
      const lock = fieldToScreen(L, f.x + px * (FLOWER.r + 0.07), f.y + py * (FLOWER.r + 0.07));
      drawPadlock(ctx, L, lock.x, lock.y);
    }
  });
}

// Balls on the tiles, drawn under the robots and the HIVE canopy.
function drawFloorBalls(ctx, L, world) {
  ctx.save();
  setFieldTransform(ctx, L);
  world.balls.forEach(b => {
    if (!b.air) drawBall(ctx, L, b.kind, b.color, b.x, b.y, b.r);
  });
  ctx.restore();
}

/* Airborne balls go over everything, the HIVE included, since they fly in above it. */
function drawFlyingBalls(ctx, L, world) {
  const flying = world.balls.filter(b => b.air);
  ctx.save();
  setFieldTransform(ctx, L);
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000000';
  flying.forEach(b => {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 1.1, 0, TAU);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  flying.forEach(b => {
    TRAIL.forEach((back, k) => {
      const flown = b.air.flown - back;
      if (flown <= 0) return;
      const h = lobHeight({ flown, range: b.air.range });
      ctx.globalAlpha = 0.35 - k * 0.1;
      drawBall(ctx, L, b.kind, b.color, b.x - b.air.dx * back, b.y - b.air.dy * back - LOB_HEIGHT * h, b.r * (0.9 - k * 0.15));
    });
    ctx.globalAlpha = 1;
    const h = lobHeight(b.air);
    // Screen up is minus y, so lifting the ball means subtracting from y.
    drawBall(ctx, L, b.kind, b.color, b.x, b.y - LOB_HEIGHT * h, b.r * (1 + 0.3 * h));
  });
  ctx.restore();
}

/* The aim line runs from the turret to the CELL it is locked on, only while the robot holds
   something and the shot is allowed (past the end of the HIVE, in range). It is solid in the
   alliance colour when that CELL is up, and grey when the CELL is down and the shot would
   miss. */
function drawAim(ctx, L, robot, world) {
  const aim = robot.aim;
  if (!aim || !aim.ok || robot.held.length === 0) return;
  const live = world.hives[robot.alliance].up === aim.end;
  const sx = robot.x + Math.cos(aim.angle) * BALL.muzzle;
  const sy = robot.y + Math.sin(aim.angle) * BALL.muzzle;
  ctx.save();
  setFieldTransform(ctx, L);
  ctx.globalAlpha = live ? 0.8 : 0.45;
  ctx.strokeStyle = live ? COLORS[robot.alliance] : COLORS.muted;
  ctx.lineWidth = pxToM(L, 2);
  ctx.setLineDash([pxToM(L, 5), pxToM(L, 5)]);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(aim.x, aim.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(aim.x, aim.y, 0.06, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(aim.x - 0.09, aim.y);
  ctx.lineTo(aim.x + 0.09, aim.y);
  ctx.moveTo(aim.x, aim.y - 0.09);
  ctx.lineTo(aim.x, aim.y + 0.09);
  ctx.stroke();
  ctx.restore();
}

/* One robot: a rounded square in its alliance colour, a light intake bar on the front edge,
   up to four held balls on the back half, the slot name in the middle, and the archetype
   letter in a badge at the front corner. The robot is drawn in its own rotated frame, so
   the front is always +x in local space. */
function drawRobot(ctx, L, robot, world) {
  const half = ROBOT.half;
  const size = ROBOT.size;
  const kick = recoilOf(world, robot);
  ctx.save();
  setFieldTransform(ctx, L);
  ctx.translate(robot.x - kick.x, robot.y - kick.y);
  ctx.rotate(robot.heading);
  roundRectPath(ctx, -half, -half, size, size, 0.04);
  ctx.fillStyle = COLORS[robot.alliance];
  ctx.fill();
  ctx.lineWidth = pxToM(L, 2.5);
  ctx.strokeStyle = COLORS[robot.alliance + 'Dark'];
  ctx.stroke();

  ctx.fillStyle = 'rgba(245, 247, 250, 0.9)';
  ctx.fillRect(half - 0.045, -half * 0.8, 0.035, size * 0.8);

  robot.held.forEach((b, k) => {
    const ly = -0.1 + k * (0.2 / 3);
    drawBall(ctx, L, b.kind, b.color, -0.13, ly, b.kind === 'pollen' ? 0.024 : 0.03);
  });
  ctx.restore();

  // The turret turns on its own, pointing wherever the auto-aim is locked.
  if (robot.aim) {
    ctx.save();
    setFieldTransform(ctx, L);
    ctx.translate(robot.x - kick.x, robot.y - kick.y);
    ctx.rotate(robot.aim.angle);
    ctx.fillStyle = '#12151a';
    ctx.fillRect(0, -0.022, BALL.muzzle, 0.044);
    ctx.beginPath();
    ctx.arc(0, 0, 0.065, 0, TAU);
    ctx.fill();
    ctx.lineWidth = pxToM(L, 2);
    ctx.strokeStyle = robot.aim.ok && robot.held.length > 0 ? COLORS.ink : COLORS[robot.alliance + 'Dark'];
    ctx.stroke();
    ctx.restore();
  }

  const c = fieldToScreen(L, robot.x, robot.y);
  drawText(ctx, L, robot.slot, c.x, c.y, { size: Math.round(ROBOT.size * L.s * 0.26), color: COLORS.ink, shadow: true });

  // The badge sits at a local point (0.12, -0.15), turned into field space by the robot's heading.
  const bx = robot.x + 0.12 * Math.cos(robot.heading) + 0.15 * Math.sin(robot.heading);
  const by = robot.y + 0.12 * Math.sin(robot.heading) - 0.15 * Math.cos(robot.heading);
  const bc = fieldToScreen(L, bx, by);
  ctx.save();
  setScreenTransform(ctx, L);
  ctx.beginPath();
  ctx.arc(bc.x, bc.y, 9, 0, TAU);
  ctx.fillStyle = '#12151a';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS[robot.alliance];
  ctx.stroke();
  ctx.restore();
  drawText(ctx, L, ARCHETYPES[robot.archetype].letter, bc.x, bc.y, { size: 11 });
}

/* How far a robot is pushed back by its latest shot, along the shot's line: RECOIL_M straight
   after firing, easing to 0 over RECOIL_SECS. Returned as an {x, y} offset. */
function recoilOf(world, robot) {
  let kick = { x: 0, y: 0 };
  let best = 0;
  for (const f of world.fx) {
    if (f.kind !== 'shot' || f.slot !== robot.slot) continue;
    const t = (world.time - f.t) / RECOIL_SECS;
    if (!(t >= 0 && t < 1)) continue;
    const m = RECOIL_M * (1 - t) * (1 - t);
    if (m > best) {
      best = m;
      kick = { x: f.dx * m, y: f.dy * m };
    }
  }
  return kick;
}

function fxColor(f) {
  if (f.kind === 'cell') return f.color === 'yellow' ? COLORS.pollen : COLORS[f.color];
  if (f.alliance) return COLORS[f.alliance];
  return '#c9ced6';
}

/* The short animations world.fx asks for. Each one is a function of its age only, so a
   paused game freezes them mid-play rather than skipping them. */
function drawFx(ctx, L, world) {
  ctx.save();
  setFieldTransform(ctx, L);
  for (const f of world.fx) {
    const dur = FX_SECS[f.kind];
    const t = (world.time - f.t) / dur;
    if (!(t >= 0 && t < 1)) continue;
    const fade = 1 - t;
    const color = fxColor(f);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    if (f.kind === 'shot') {
      // A muzzle flash: a bright core and three sparks fanning forward.
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 0.02 + 0.04 * t, 0, TAU);
      ctx.fillStyle = '#fff6d0';
      ctx.fill();
      ctx.lineWidth = pxToM(L, 2.5);
      const a0 = Math.atan2(f.dy, f.dx);
      for (const da of [-0.45, 0, 0.45]) {
        const a = a0 + da;
        const r0 = 0.03 + 0.05 * t;
        const r1 = r0 + 0.06 * fade;
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0);
        ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
        ctx.stroke();
      }
    } else if (f.kind === 'cell') {
      // A splash where the ball drops into the CELL: a ring and six sparkles.
      ctx.globalAlpha = fade;
      ctx.lineWidth = pxToM(L, 3 * fade + 1);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 0.03 + 0.13 * t, 0, TAU);
      ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const a = k * TAU / 6 + 0.3;
        const r = 0.05 + 0.12 * t;
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 0.012 * fade, 0, TAU);
        ctx.fill();
      }
    } else if (f.kind === 'land') {
      // A dust puff where a ball touches down.
      ctx.globalAlpha = 0.5 * fade;
      ctx.lineWidth = pxToM(L, 1.5);
      ctx.beginPath();
      ctx.arc(f.x, f.y, (f.r || 0.04) * (1 + 2 * t), 0, TAU);
      ctx.stroke();
    } else if (f.kind === 'spill') {
      // The tipped CELL pours out: a burst fanning outward from the frame end.
      ctx.globalAlpha = 0.7 * fade;
      ctx.lineWidth = pxToM(L, 4 * fade + 1);
      const a0 = f.sign > 0 ? 0 : Math.PI;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 0.05 + 0.4 * t, a0 - 1.1, a0 + 1.1);
      ctx.stroke();
    }
  }
  ctx.restore();

  // A "RECYCLED" label rises from each spill so players see the elements are back in play.
  for (const f of world.fx) {
    if (f.kind !== 'spill' || !(f.count > 0)) continue;
    const t = (world.time - f.t) / FX_SECS.spill;
    if (!(t >= 0 && t < 1)) continue;
    const p = fieldToScreen(L, f.x + f.sign * 0.12, f.y - 0.32);
    drawText(ctx, L, `RECYCLED x${f.count}`, p.x, p.y - 30 * t, { size: 13, color: COLORS[f.alliance], shadow: true, alpha: 1 - t * t });
  }
}

// Event toasts: the newest few recent events, stacked along the bottom edge of the field.
function drawToasts(ctx, L, world) {
  const recent = world.events
    .filter(ev => ev.t <= world.time && world.time - ev.t <= TOAST_SECS)
    .slice(-TOAST_MAX);
  const bottom = fieldToScreen(L, 0, FIELD.half).y;
  recent.forEach((ev, k) => {
    const age = world.time - ev.t;
    const alpha = Math.max(0, 1 - age / TOAST_SECS);
    // Newest toast sits lowest. Older ones stack upward above it.
    const y = bottom - 18 - (recent.length - 1 - k) * 28;
    const color = ev.alliance === 'red' ? COLORS.redSoft : ev.alliance === 'blue' ? COLORS.blueSoft : COLORS.ink;
    drawText(ctx, L, ev.text, L.cx, y, { size: 15, color, alpha, shadow: true });
  });
}

/* Big centre text for the countdown, the transition, and the first moment of TELEOP. The
   phase length comes from PHASES, so changing a phase's duration in rules.js moves the
   countdown with it. */
function drawBanner(ctx, L, world) {
  const def = PHASES.find(p => p.id === world.phase) || { dur: 0 };
  const minSide = Math.min(L.width, L.height);
  if (world.phase === 'countdown') {
    const n = Math.max(1, Math.ceil(def.dur - world.phaseTime));
    drawText(ctx, L, String(n), L.cx, L.cy, { size: minSide * 0.3, alpha: 0.9, shadow: true });
  } else if (world.phase === 'transition') {
    drawText(ctx, L, 'TRANSITION: robots stopped', L.cx, L.cy, { size: minSide * 0.07, shadow: true });
  } else if (world.phase === 'teleop' && world.phaseTime < TELEOP_BANNER_SECS) {
    const alpha = 1 - world.phaseTime / TELEOP_BANNER_SECS;
    drawText(ctx, L, 'TELEOP!', L.cx, L.cy, { size: minSide * 0.2, alpha, shadow: true });
  }
}

/* Draws one frame. `view` is {width, height, dpr}: the canvas size in CSS pixels and the
   device pixel ratio. The canvas backing store is dpr times bigger, which keeps lines sharp
   on high-density screens. */
function drawWorld(ctx, world, view) {
  const L = makeLayout(view);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  drawAllianceAreas(ctx, L, world);
  drawField(ctx, L);
  drawZones(ctx, L);
  drawHiveBars(ctx, L);
  drawFlowers(ctx, L, world);
  drawFloorBalls(ctx, L, world);
  world.robots.forEach(robot => drawRobot(ctx, L, robot, world));
  drawHive(ctx, L, world);
  world.robots.forEach(robot => drawAim(ctx, L, robot, world));
  drawFlyingBalls(ctx, L, world);
  drawFx(ctx, L, world);
  drawToasts(ctx, L, world);
  drawBanner(ctx, L, world);
}
