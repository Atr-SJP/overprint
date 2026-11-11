# Overprint

A four-ink territory game, printed risograph-style. Lay your pieces corner to corner, grab ink drops to bend the rules, and run your rivals out of room.

**Play:** open `index.html` in Chrome, Safari, Edge or Firefox. No install, no build step.
**Put it online:** `dist/index.html` is the whole game in one file. Drop the `dist` folder on any static host (for example Netlify Drop) to get a public link. After changing the game, rebuild it with `python3 .claude/build_standalone.py . dist/index.html`.
Fonts (Archivo, Martian Mono) load from Google Fonts when online. Everything else, including art, animation, sound and music, is generated in code.

## Rules
- Four seats. On the title screen, set each colour to **Player** or a **CPU** at its own level:
  - **Amateur** grabs big pieces and ignores everyone else.
  - **Intermediate** is a solid one-move thinker with a personality (blocker, sprawler, collector or even-handed).
  - **Expert** shortlists moves, plays each one out to check what it leaves everyone, and saves its ink drops for when they count.
  - In head-to-head CPU games, Expert beats Intermediate about 80% of the time, and Intermediate beats Amateur almost every time.
- Your first piece must cover your corner square.
- Every new piece must touch your own ink **at a corner**, never along a side. Touching rivals is fine.
- One point per square you own. Print all 21 pieces for **+10**. The game ends when nobody can move.
- The first turn moves one seat clockwise every sheet, and the third and fourth printers start with a spare ink drop. This was balance-tested over hundreds of CPU games, because moving late otherwise costs about two points.

## What's new
- **Ink drops.** Cover a drop to collect it. Each one breaks one rule, once:
  - **Overprint**: print over up to two rival squares and take them (the inks really mix).
  - **Bleed**: your piece may touch your own sides.
  - **Offset**: place your piece anywhere, no corner needed.
- **Die-cut sheets.** Every game punches a different, rotationally symmetric set of holes.
- **CPU printers** at three levels, set per colour. In-game, the pips beside "CPU" show the level.
- **Print run replay.** When the game ends, the whole sheet reprints in order before the results.

## Controls
| Input | Action |
| --- | --- |
| Click a piece, then the sheet | Pick up, then print (or drag and drop) |
| Scroll, `R` / `E`, `Q` | Rotate |
| Right-click, `F` | Flip |
| `1` `2` `3` | Arm an ink drop |
| `Tab`, arrows, `Enter` | Keyboard play: cycle pieces, nudge, print |
| `Esc` | Put the piece back, or open the menu |
| `M` | Music on/off |

On touch screens, tap a piece, drag anywhere on the sheet to aim it, and confirm with ✓.

## Files
- `js/engine.js`: rules, sheet generation, move generation
- `js/ai.js`: CPU players
- `js/render.js`: canvas renderer (paper, inks, halftones, misregistration)
- `js/audio.js`: synthesized sound effects and the generative soundtrack
- `js/game.js`: turn flow, input, HUD and screens
