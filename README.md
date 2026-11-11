# BIOBUZZ 2D

Play it: https://kyleli73.github.io/biobuzz-2d/

A top-down, 4-players-on-1-keyboard version of BIOBUZZ. Open `index.html` in a browser. No build step.

Every robot has the same drivetrain (500 RPM, 104 mm wheels, 18 in square). Players pick one of three mechanisms: **Pollen Bot** (POLLEN only), **Nectar Bot** (own NECTAR only) or **Hybrid Bot** (both). Every robot has the same rapid-fire shooter: hold fire and it empties in about a third of a second.

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

The HIVE tips the way FIRST calibrates real ones (Event Field Setup Guide section 12.3): at 8 POLLEN alone, or 3 NECTAR + 3 POLLEN. Other mixes are our fit. A FLOWER fills by height (section 9.7), which gives 8 POLLEN or 5 NECTAR, and its bottom POLLEN sits below the scoring volume, so it earns nothing. The middle ring height that both depend on is our reading of Figure 9-12, since the manual does not print it.
