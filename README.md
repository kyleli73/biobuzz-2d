# BIOBUZZ 2D

Play it: https://kyleli73.github.io/biobuzz-2d/

A top-down, 4-players-on-1-keyboard version of BIOBUZZ. Open `index.html` in a browser. No build step.

Every robot has the same drivetrain (312 RPM, 104 mm wheels, 18 in square). Players pick one of three mechanisms: **Pollen Bot** (POLLEN only), **Nectar Bot** (own NECTAR only) or **Hybrid Bot** (both, but shoots at half speed).

| Seat | Drive | Fire |
|---|---|---|
| Red 1 | W A S D | Q |
| Red 2 | T F G H | R |
| Blue 1 | I J K L | U |
| Blue 2 | Arrow keys | Enter |

Gamepads also work (left stick drives, right stick turns, A or RT fires); pad 1 takes Red 1, and so on.

| File | What's in it |
|---|---|
| `js/rules.js` | The field, scoring and robot types as data, from the TU02 manual |
| `js/world.js` | The game itself: physics, HIVE tipping, FLOWERS, NECTAR entry, scoring. No drawing |
| `js/input.js` | Keyboard and gamepad |
| `js/render.js` | Draws one frame on the canvas |
| `js/main.js` | Setup screen, scoreboard, results, the game loop |
| `test/world.test.js` | Rule tests: run `node test/world.test.js` |

Two numbers are not in the manual and are marked as guesses in `rules.js`: how full a CELL must be to tip (15 load units, POLLEN 2, NECTAR 3, the same fit as the 3D sim) and FLOWER capacity (8).
