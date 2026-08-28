---
name: testing-battleship-ui
description: How to run and UI-test the plain HTML/CSS/JS Battleship app locally (setup phase, firing/turn loop, sinking, responsive layout).
---

# Testing the Battleship UI locally

## Run it
No build step. From the repo root:

```
python3 -m http.server 8123
```

Then open `http://localhost:8123/index.html`. Unit tests are `npm test` (node --test);
they do not exercise the DOM, so runtime claims need browser interaction.

## Where things live
- `src/rules.js` board/placement/firing, `src/ai.js` opponent (never sees the player board)
- `src/ui/state.js` transitions, `src/ui/view.js` rendering, `src/ui/main.js` event wiring + timers
- `AI_DELAY` in `src/ui/main.js` controls the computer's reply delay (700ms by default). The
  player grid is disabled outside SETUP and the enemy grid is disabled while `busy` is true,
  so "can't cheat during think time" is enforced by `button.disabled`.

## Useful selectors / strings
- `.grid[data-side="player"|"enemy"] .square`, `.square.newest` (amber newest-shot ring),
  `.grid.placing` (crosshair cursor while a ship is held), `.roster-row.is-held`,
  `.roster-status` (`IN HAND` / `SUNK` / `N left`), `#start`, `#scatter`, `#new-game`,
  `.log-scroll` (6 visible rows, scrolls), `#status` (banner).
- Every square button has an `aria-label` like `"B3, hit, Carrier sunk"` or
  `"G5, Battleship, unfired"`. Reading the DOM/aria labels is the fastest way to know the
  exact board state, but back visual claims (colours, rings, cursor) with screenshots.

## Efficient way to sink an enemy ship (needed for the sink/reveal flow)
Random hunting wastes many turns. Instead:
1. Fire a parity sweep (every other square) until a `HIT` appears in the log.
2. The THEIR SHIPS roster tells you which ship you hit (its "N left" count drops), so you know
   the ship length immediately.
3. Read enemy `aria-label`s to see which neighbours are already misses, deduce the orientation,
   and finish the ship. Cruiser (3) / Destroyer (2) sink fastest.
4. Screenshot **immediately after the sinking click, before waiting** — the banner
   "You sank their <Ship>! Enemy is taking their shot." is replaced ~700ms later by the
   computer's reply text.

## Testing the narrow (400px) layout
Chrome's window has a ~500 CSS px minimum width, so resizing alone cannot reach 400px.
Resize the window to its minimum (`wmctrl -r :ACTIVE: -e 0,0,0,412,1140`), then zoom the page
to 125% with `ctrl+equal` twice (xdotool's `ctrl+plus` does not register; use `ctrl+equal`),
which yields exactly `window.innerWidth === 400`. Verify with a console eval, then `ctrl+0`
and re-maximize (`wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`) afterwards.

## Devin Secrets Needed
None — the app is fully local and unauthenticated.
