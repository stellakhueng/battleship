import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { FLEET, createSeededRng, isFleetPlaced, isFleetSunk, shipAt } from '../src/rules.js';
import { mount } from '../src/ui/main.js';

const SHIP_SQUARES = FLEET.reduce((total, ship) => total + ship.size, 0); // 17

/** A mounted interface driven through the real DOM, with a seeded layout. */
function open(seed = 1, options = {}) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  const root = dom.window.document.getElementById('app');
  const app = mount(root, { rng: createSeededRng(seed), ...options });
  return { dom, root, app, doc: dom.window.document };
}

/**
 * Timers the test drives by hand, so the computer's reply happens exactly
 * when the test says so and the game runs synchronously.
 */
function manualTimers() {
  const queued = new Map();
  let next = 1;
  return {
    setTimeout(fn) {
      const id = next;
      next += 1;
      queued.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      queued.delete(id);
    },
    get waiting() {
      return queued.size;
    },
    /** Let the computer take its turn. */
    flush() {
      for (const [id, fn] of [...queued]) {
        queued.delete(id);
        fn();
      }
    },
  };
}

/** A game already under way, with the computer's replies under test control. */
function play(seed = 1) {
  const timers = manualTimers();
  const opened = open(seed, { timers });
  opened.root.querySelector('#start').click();
  return { ...opened, timers };
}

const grid = (root, side) => root.querySelector(`.grid[data-side="${side}"]`);
const squares = (root, side) => [...grid(root, side).querySelectorAll('.square')];
const square = (root, side, label) => grid(root, side).querySelector(`.square[data-square="${label}"]`);
const firstEnabled = (root, side) => squares(root, side).find((node) => !node.disabled);
const shotsBy = (state, who) => state.log.filter((entry) => entry.who === who);

test('both grids are drawn as 100 squares with rulers A-J and 1-10', () => {
  const { root } = open();

  for (const side of ['player', 'enemy']) {
    assert.equal(squares(root, side).length, 100, `${side} grid`);
  }

  const rulers = [...grid(root, 'player').querySelectorAll('.ruler')].map((node) => node.textContent);
  assert.deepEqual(rulers.slice(1, 11), [...'ABCDEFGHIJ']);
  assert.deepEqual(
    rulers.slice(11).filter((text) => text !== ''),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  );
});

test('every square is a button carrying its coordinate and state in an aria-label', () => {
  const { root } = open();

  for (const side of ['player', 'enemy']) {
    for (const node of squares(root, side)) {
      assert.equal(node.tagName, 'BUTTON');
      const label = node.getAttribute('aria-label');
      assert.ok(label, `${side} ${node.dataset.square} has no aria-label`);
      assert.match(label, /^[A-J](10|[1-9]), /);
      assert.match(label, /(unfired|hit|miss)/);
    }
  }

  // Your own ships are named in the label; the enemy's are not.
  const shipSquare = squares(root, 'player').find((node) => node.classList.contains('hull'));
  assert.match(shipSquare.getAttribute('aria-label'), /Carrier|Battleship|Cruiser|Submarine|Destroyer/);
});

test('during setup the enemy grid is disabled outright, not merely inert', () => {
  const { root } = open();

  assert.ok(squares(root, 'enemy').every((node) => node.disabled), 'enemy squares must be disabled');
  assert.ok(squares(root, 'player').every((node) => !node.disabled), 'own squares stay usable for moving ships');
});

test('scattering 200 times always draws exactly 17 ship squares', () => {
  const { root, app } = open(7);

  for (let i = 0; i < 200; i += 1) {
    root.querySelector('#scatter').click();

    const hulls = squares(root, 'player').filter((node) => node.classList.contains('hull'));
    assert.equal(hulls.length, SHIP_SQUARES, `scatter ${i}: drew ${hulls.length} ship squares`);
    assert.ok(isFleetPlaced(app.state.player), `scatter ${i}: fleet incomplete`);
  }
});

test('a roster row draws one block per square of that ship', () => {
  const { root } = open();

  for (const side of ['player', 'enemy']) {
    for (const { name, size } of FLEET) {
      const row = root.querySelector(`.roster[data-side="${side}"] .roster-row[data-ship="${name}"]`);
      assert.ok(row, `${side} roster is missing ${name}`);
      assert.equal(row.querySelectorAll('.roster-block').length, size, `${side} ${name}`);
      assert.equal(row.querySelector('.roster-status').textContent, side === 'player' ? `${size} left` : 'afloat');
    }
  }

  assert.equal(root.querySelector('.roster[data-side="player"] .roster-count').textContent, '0 of 5 lost');
  assert.equal(root.querySelector('.roster[data-side="enemy"] .roster-count').textContent, '0 of 5 sunk');
});

test('clicking one of your ships picks it up instead of adding a second copy', () => {
  const { root, app } = open(3);

  const occupied = squares(root, 'player').find((node) => node.classList.contains('hull'));
  const picked = shipAt(app.state.player, { x: Number(occupied.dataset.x), y: Number(occupied.dataset.y) });

  occupied.click();

  assert.equal(app.state.selected.name, picked.name);
  assert.equal(app.state.player.ships.length, FLEET.length - 1, 'the ship is off the board while held');
  assert.ok(!app.state.player.ships.some((ship) => ship.name === picked.name));
  assert.equal(root.querySelector('#start').disabled, true, 'cannot start with a ship in hand');

  // Put it back down somewhere legal: still five ships, still no duplicate.
  let placed = false;
  for (const candidate of squares(root, 'player')) {
    candidate.click();
    if (!app.state.selected) {
      placed = true;
      break;
    }
  }

  assert.ok(placed, `nowhere to put the ${picked.name} back down`);
  assert.equal(app.state.player.ships.length, FLEET.length);
  assert.equal(new Set(app.state.player.ships.map((ship) => ship.name)).size, FLEET.length);
  assert.ok(isFleetPlaced(app.state.player));
  assert.equal(root.querySelector('#start').disabled, false);
});

test('a held ship is marked on its roster row and the grid, not only in the banner', () => {
  const { root, app } = open(11);

  const occupied = squares(root, 'player').find((node) => node.classList.contains('hull'));
  const picked = shipAt(app.state.player, { x: Number(occupied.dataset.x), y: Number(occupied.dataset.y) });
  occupied.click();

  const held = [...root.querySelectorAll('.roster[data-side="player"] .roster-row.is-held')];
  assert.equal(held.length, 1, 'exactly one row is marked as held');
  assert.equal(held[0].dataset.ship, picked.name);
  assert.equal(held[0].querySelector('.roster-status').textContent, 'IN HAND');
  assert.ok(grid(root, 'player').classList.contains('placing'), 'the grid says a ship is in hand');
});

test('Escape puts a held ship back exactly where it came from', () => {
  const { root, app, doc } = open(11);

  const occupied = squares(root, 'player').find((node) => node.classList.contains('hull'));
  const picked = shipAt(app.state.player, { x: Number(occupied.dataset.x), y: Number(occupied.dataset.y) });
  const before = picked.cells.map(labelOf);

  occupied.click();
  assert.equal(app.state.selected.name, picked.name);

  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.equal(app.state.selected, null, 'nothing is in hand after Escape');
  assert.equal(app.state.player.ships.length, FLEET.length);
  const after = shipAt(app.state.player, picked.cells[0]);
  assert.equal(after.name, picked.name);
  assert.deepEqual(after.cells.map(labelOf), before, 'back on its old squares');
  assert.equal(root.querySelector('.roster-row.is-held'), null);
});

test('the buttons on screen match the phase', () => {
  const { root } = open();

  assert.ok(root.querySelector('#scatter'));
  assert.ok(root.querySelector('#start'));
  assert.equal(root.querySelector('#new-game'), null);

  root.querySelector('#start').click();

  assert.equal(root.querySelector('#scatter'), null, 'scatter does nothing once play begins');
  assert.equal(root.querySelector('#start'), null);
  assert.ok(root.querySelector('#new-game'));
  assert.ok(squares(root, 'player').every((node) => node.disabled), 'ships cannot be moved mid-game');
  assert.ok(squares(root, 'enemy').every((node) => !node.disabled), 'the enemy grid opens up for firing');
});

test('the status banner says what to do next', () => {
  const { root } = open(3);
  const status = () => root.querySelector('#status').textContent;

  assert.match(status(), /Scatter|start the game/i);

  const occupied = squares(root, 'player').find((node) => node.classList.contains('hull'));
  occupied.click();
  assert.match(status(), /picked up/i);
});

test('hits, misses and sunk ships are drawn by shape, not colour alone', () => {
  const { root, app } = open(5);

  // Part one has no firing, so drive the rules layer directly and redraw.
  const carrier = app.state.player.ships.find((ship) => ship.name === 'Carrier');
  for (const cell of carrier.cells) {
    app.state.player.shots.set(`${cell.x},${cell.y}`, 'hit');
    carrier.hits.add(`${cell.x},${cell.y}`);
  }
  const [head] = carrier.cells;
  app.state.lastShot.player = head;
  app.draw();

  const cellNode = square(root, 'player', labelOf(head));
  assert.ok(cellNode.querySelector('.mark-hit line'), 'a hit is a cross, drawn with two strokes');
  assert.equal(cellNode.querySelectorAll('.mark-hit line').length, 2);
  assert.ok(cellNode.classList.contains('sunk'));
  assert.ok(cellNode.classList.contains('hull-sunk'));
  assert.match(cellNode.getAttribute('aria-label'), /Carrier sunk$/);

  const ringed = squares(root, 'player').filter((node) => node.classList.contains('newest'));
  assert.equal(ringed.length, 1, 'exactly one amber ring per grid');

  const water = squares(root, 'player').find((node) => !node.classList.contains('hull'));
  app.state.player.shots.set(`${water.dataset.x},${water.dataset.y}`, 'miss');
  app.draw();
  const missNode = square(root, 'player', water.dataset.square);
  assert.ok(missNode.querySelector('.mark-miss circle'), 'a miss is a disc, not a red-versus-blue wash');
  assert.equal(missNode.querySelector('.mark-hit'), null);

  const row = root.querySelector('.roster[data-side="player"] .roster-row[data-ship="Carrier"]');
  assert.ok(row.classList.contains('is-sunk'));
  assert.equal(row.querySelector('.roster-status').textContent, 'SUNK');
  assert.equal(row.querySelectorAll('.roster-block.is-hit').length, 5);
  assert.equal(root.querySelector('.roster[data-side="player"] .roster-count').textContent, '1 of 5 lost');
});

test('an empty shot log says so rather than showing bare headings', () => {
  const { root, app } = open(7);

  assert.equal(root.querySelector('.log-table'), null, 'no table until there is something in it');
  assert.equal(root.querySelector('.log-empty').textContent, 'No shots yet');

  app.state.log.push({ turn: 1, who: 'player', square: 'A1', result: 'miss', sunkShip: null });
  app.draw();

  assert.equal(root.querySelector('.log-empty'), null);
  assert.deepEqual(
    [...root.querySelectorAll('.log-table th')].map((node) => node.textContent),
    ['Turn', 'Who', 'Square', 'Result'],
  );
  assert.equal(root.querySelector('.log-scroll').style.getPropertyValue('--log-rows'), '6');
});

/* Firing and the turn loop ------------------------------------------- */

test('firing an enemy square records exactly one shot, and firing it again records nothing', () => {
  const { root, app, timers } = play(2);

  const target = square(root, 'enemy', 'D5');
  target.click();
  target.click(); // a fast double click, on the node the finger already had

  assert.equal(app.state.enemy.shots.size, 1);
  assert.deepEqual(shotsBy(app.state, 'player').map((entry) => entry.square), ['D5']);

  timers.flush();

  const fired = square(root, 'enemy', 'D5');
  assert.equal(fired.disabled, true, 'a spent square is disabled, not merely ignored');
  fired.click();
  assert.equal(app.state.enemy.shots.size, 1, 'clicking it again costs nothing');
  assert.equal(shotsBy(app.state, 'player').length, 1, 'and takes no turn');
});

test('a rapid second and third click during the computer’s turn do nothing', () => {
  const { root, app, timers } = play(4);

  const [a, b, c] = squares(root, 'enemy').filter((node) => !node.disabled);
  a.click();
  b.click();
  c.click();

  assert.equal(app.state.enemy.shots.size, 1, 'only the first click fired');
  assert.equal(app.state.turn, 1);
  assert.ok(app.state.busy, 'input is locked from the moment the shot resolves');
  assert.ok(squares(root, 'enemy').every((node) => node.disabled), 'the whole enemy grid is shut');
  assert.equal(timers.waiting, 1, 'exactly one reply is queued');

  timers.flush();
  assert.equal(app.state.turn, 2);
  assert.ok(!app.state.busy, 'unlocked once the reply is drawn');
});

test('the turn counter increments once per shot and the log alternates', () => {
  const { root, app, timers } = play(6);

  for (let i = 0; i < 8; i += 1) {
    firstEnabled(root, 'enemy').click();
    timers.flush();
  }

  assert.equal(app.state.turn, 16);
  assert.deepEqual(
    app.state.log.map((entry) => entry.turn),
    Array.from({ length: 16 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    app.state.log.map((entry) => entry.who),
    Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 'player' : 'enemy')),
  );

  // Newest first on screen, so the top row is the computer's latest shot.
  const rows = [...root.querySelectorAll('.log-table tbody tr')];
  assert.equal(rows[0].querySelector('.log-turn').textContent, '16');
  assert.equal(rows[0].querySelector('.log-who').textContent, 'Enemy');
  assert.equal(rows[1].querySelector('.log-who').textContent, 'You');
});

test('the amber ring follows the newest shot, one per grid', () => {
  const { root, app, timers } = play(8);

  square(root, 'enemy', 'C3').click();
  timers.flush();

  const ringed = (side) => squares(root, side).filter((node) => node.classList.contains('newest'));
  assert.equal(ringed('enemy').length, 1);
  assert.equal(ringed('enemy')[0].dataset.square, 'C3');
  assert.equal(ringed('player').length, 1, 'their shot is ringed on your grid');
  assert.equal(ringed('player')[0].dataset.square, shotsBy(app.state, 'enemy').at(-1).square);

  square(root, 'enemy', 'H8').click();
  timers.flush();

  assert.equal(ringed('enemy').length, 1, 'the old ring is gone');
  assert.equal(ringed('enemy')[0].dataset.square, 'H8');
  assert.equal(ringed('player')[0].dataset.square, shotsBy(app.state, 'enemy').at(-1).square);
});

test('sinking an enemy ship updates the roster, the count and the grid', () => {
  const { root, app, timers } = play(9);

  const target = app.state.enemy.ships.find((ship) => ship.name === 'Destroyer');
  for (const cell of target.cells) {
    square(root, 'enemy', labelOf(cell)).click();
    // The banner names the ship before the computer replies over the top of it.
    if (cell === target.cells.at(-1)) {
      assert.match(root.querySelector('#status').textContent, /You sank their Destroyer!/);
    }
    timers.flush();
  }

  const row = root.querySelector('.roster[data-side="enemy"] .roster-row[data-ship="Destroyer"]');
  assert.ok(row.classList.contains('is-sunk'));
  assert.equal(row.querySelector('.roster-status').textContent, 'SUNK');
  assert.equal(row.querySelectorAll('.roster-block.is-hit').length, target.size);
  assert.equal(root.querySelector('.roster[data-side="enemy"] .roster-count').textContent, '1 of 5 sunk');

  // A sunk enemy ship is revealed: grey hull on a pink wash.
  for (const cell of target.cells) {
    const node = square(root, 'enemy', labelOf(cell));
    assert.ok(node.classList.contains('hull-sunk'), `${labelOf(cell)} shows the hull`);
    assert.ok(node.classList.contains('sunk'));
    assert.match(node.getAttribute('aria-label'), /Destroyer sunk$/);
  }

  const badge = root.querySelector('.log-table tbody .badge.is-sank');
  assert.equal(badge.textContent, 'SANK DESTROYER');

  // Ships that are still afloat stay hidden.
  const afloat = app.state.enemy.ships.find((ship) => ship.hits.size === 0);
  assert.equal(square(root, 'enemy', labelOf(afloat.cells[0])).classList.contains('hull'), false);
});

test('the player cannot fire on their own grid or move ships once play has started', () => {
  const { root, app } = play(10);

  assert.ok(squares(root, 'player').every((node) => node.disabled));

  const before = app.state.player.ships.map((ship) => ship.cells.map(labelOf).join(''));
  squares(root, 'player')[0].click();

  assert.equal(app.state.selected, null, 'no pickups mid-game');
  assert.equal(app.state.player.shots.size, 0, 'and no firing at your own fleet');
  assert.deepEqual(app.state.player.ships.map((ship) => ship.cells.map(labelOf).join('')), before);
});

test('a queued computer shot is cancelled rather than landing on a fresh board', () => {
  const { root, app, timers } = play(12);

  firstEnabled(root, 'enemy').click();
  assert.equal(timers.waiting, 1);

  app.cancelTimers();
  timers.flush();

  assert.equal(app.state.turn, 1, 'the cancelled reply never fired');
  assert.equal(app.state.player.shots.size, 0);
});

test('their roster shows no damage on a ship until it sinks', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const { root, app, timers } = play(seed);
    const rng = createSeededRng(seed + 900);

    for (let shot = 0; shot < 40 && app.state.phase === 'playing'; shot += 1) {
      const open = squares(root, 'enemy').filter((node) => !node.disabled);
      open[Math.floor(rng() * open.length)].click();
      timers.flush();

      for (const ship of app.state.enemy.ships) {
        const row = root.querySelector(`.roster[data-side="enemy"] .roster-row[data-ship="${ship.name}"]`);
        const sunk = ship.hits.size === ship.size;
        const shown = row.querySelectorAll('.roster-block.is-hit').length;

        if (sunk) {
          assert.equal(shown, ship.size, `seed ${seed}: a sunk ${ship.name} should be all red`);
          assert.equal(row.querySelector('.roster-status').textContent, 'SUNK');
        } else {
          assert.equal(shown, 0, `seed ${seed}: ${ship.name} leaks ${ship.hits.size} hits before sinking`);
          assert.equal(row.querySelector('.roster-status').textContent, 'afloat');
        }
      }

      // The total is fair game: it says nothing about which ship was hit.
      const landed = app.state.enemy.ships.reduce((total, ship) => total + ship.hits.size, 0);
      const line = root.querySelector('.roster[data-side="enemy"] .roster-hits').textContent;
      assert.equal(line, `${landed} hit${landed === 1 ? '' : 's'} landed`);
    }

    // Your own fleet is yours to see, so it keeps per-ship damage.
    const damaged = app.state.player.ships.find((ship) => ship.hits.size > 0 && ship.hits.size < ship.size);
    if (damaged) {
      const row = root.querySelector(`.roster[data-side="player"] .roster-row[data-ship="${damaged.name}"]`);
      assert.equal(row.querySelectorAll('.roster-block.is-hit').length, damaged.hits.size);
      assert.equal(row.querySelector('.roster-status').textContent, `${damaged.size - damaged.hits.size} left`);
    }

    app.destroy();
  }
});

test('a focused square and the newest-shot square are told apart', () => {
  const { root, doc, dom, app, timers } = play(14);

  square(root, 'enemy', 'E4').click();
  timers.flush();

  const newest = grid(root, 'enemy').querySelector('.square.newest');
  const focused = square(root, 'enemy', 'H8');
  focused.focus();

  assert.equal(newest.dataset.square, 'E4');
  assert.equal(doc.activeElement, focused);
  assert.ok(!focused.classList.contains('newest'), 'the two are different squares here');
  assert.equal(grid(root, 'enemy').querySelectorAll('.square.newest').length, 1);

  // The two rings must not look alike: different colour and different stroke.
  const style = doc.createElement('style');
  style.textContent = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  doc.head.append(style);

  const rules = [...style.sheet.cssRules];
  const outlineOf = (selector) => {
    const rule = rules.find((entry) => entry.selectorText === selector);
    assert.ok(rule, `${selector} has no rule`);
    return {
      colour: rule.style.getPropertyValue('outline-color') || rule.style.getPropertyValue('outline'),
      style: rule.style.getPropertyValue('outline-style') || rule.style.getPropertyValue('outline'),
      offset: rule.style.getPropertyValue('outline-offset'),
    };
  };

  const focus = outlineOf('.square:focus-visible');
  const ring = outlineOf('.square.newest');
  const colourOf = (declaration) => /var\((--[a-z-]+)\)/.exec(declaration.colour)?.[1];

  assert.notEqual(colourOf(focus), colourOf(ring), 'focus and the newest shot share a colour');
  assert.match(focus.style, /dashed/);
  assert.match(ring.style, /solid/);
  assert.ok(focus.offset.startsWith('-') === false && ring.offset.startsWith('-'), 'focus sits outside, the ring inside');

  dom.window.close();
  app.destroy();
});

/* The endgame --------------------------------------------------------- */

/** Fire at every square the enemy fleet sits on, in order, and win. */
function sinkTheirFleet({ root, app, timers }) {
  for (const ship of [...app.state.enemy.ships]) {
    for (const cell of ship.cells) {
      square(root, 'enemy', labelOf(cell)).click();
      timers.flush();
    }
  }
}

/** Fire only at open water, so the computer gets there first. */
function loseTheGame({ root, app, timers }) {
  const wet = (node) => !shipAt(app.state.enemy, { x: Number(node.dataset.x), y: Number(node.dataset.y) });

  while (app.state.phase === 'playing') {
    const target = squares(root, 'enemy').find((node) => !node.disabled && wet(node));
    assert.ok(target, 'ran out of water to fire at');
    target.click();
    timers.flush();
  }
}

test('sinking their last ship wins the game on the spot', () => {
  const { root, app, timers } = play(21);

  sinkTheirFleet({ root, app, timers });

  assert.equal(app.state.phase, 'over');
  assert.equal(app.state.winner, 'player');
  assert.equal(timers.waiting, 0, 'no reply is queued after the winning shot');
  assert.equal(app.state.shots.player, SHIP_SQUARES, 'seventeen shots, every one a hit');

  const result = root.querySelector('#result');
  assert.equal(result.querySelector('.result-headline').textContent, 'You won');
  assert.equal(
    result.querySelector('.result-detail').textContent,
    `You won in ${app.state.shots.player} shots. Computer: ${app.state.shots.enemy}.`,
  );

  // The whole enemy fleet is shown, not only the ships that were sunk.
  for (const ship of app.state.enemy.ships) {
    for (const cell of ship.cells) {
      assert.ok(square(root, 'enemy', labelOf(cell)).classList.contains('hull'), `${labelOf(cell)} is revealed`);
    }
  }
});

test('the computer sinking your last ship ends the game and does not hand the turn back', () => {
  const { root, app, timers } = play(22);

  loseTheGame({ root, app, timers });

  assert.equal(app.state.winner, 'enemy');
  assert.equal(timers.waiting, 0);
  assert.ok(isFleetSunk(app.state.player));
  assert.equal(shotsBy(app.state, 'enemy').at(-1).sunkShip !== null, true, 'the last shot was the sinking one');

  const banner = root.querySelector('#status').textContent;
  assert.doesNotMatch(banner, /Your turn/, 'a loss does not hand the turn back');
  assert.match(banner, /You lost\./);
  assert.equal(root.querySelector('#result .result-headline').textContent, 'The computer won');
  assert.equal(
    root.querySelector('#result .result-detail').textContent,
    `The computer won in ${app.state.shots.enemy} shots. You: ${app.state.shots.player}.`,
  );
});

test('no shot is possible on either grid once the game is over', () => {
  for (const finish of [sinkTheirFleet, loseTheGame]) {
    const game = play(23);
    const { root, app, timers } = game;
    finish(game);

    assert.ok(squares(root, 'enemy').every((node) => node.disabled), 'the enemy grid is shut');
    assert.ok(squares(root, 'player').every((node) => node.disabled), 'and so is yours');

    const before = { turn: app.state.turn, mine: app.state.enemy.shots.size, theirs: app.state.player.shots.size };
    for (const node of [...squares(root, 'enemy'), ...squares(root, 'player')].slice(0, 40)) node.click();
    timers.flush();

    assert.equal(app.state.turn, before.turn, 'nothing moved');
    assert.equal(app.state.enemy.shots.size, before.mine);
    assert.equal(app.state.player.shots.size, before.theirs);
    app.destroy();
  }
});

test('the shot counts on screen match the log, for both sides', () => {
  const { root, app, timers } = play(24);

  const shown = (side) => root.querySelector(`.scoreboard .score[data-side="${side}"] .score-value`).textContent;

  for (let i = 0; i < 6; i += 1) {
    firstEnabled(root, 'enemy').click();
    // Counted the moment the shot lands, before the reply as well as after.
    assert.equal(shown('player'), String(shotsBy(app.state, 'player').length));
    assert.equal(shown('enemy'), String(shotsBy(app.state, 'enemy').length));
    timers.flush();
    assert.equal(shown('player'), String(shotsBy(app.state, 'player').length));
    assert.equal(shown('enemy'), String(shotsBy(app.state, 'enemy').length));
  }

  assert.equal(shown('player'), '6');
  assert.equal(shown('enemy'), '6');
});

test('New game clears the boards, the log, the counters and the computer’s memory', () => {
  const { root, app, timers } = play(25);

  for (let i = 0; i < 5; i += 1) {
    firstEnabled(root, 'enemy').click();
    timers.flush();
  }

  const oldLayout = app.state.enemy.ships.map((ship) => ship.cells.map(labelOf).join(''));
  const remembered = app.state.opponent.knowledge.shots.size;
  assert.ok(remembered > 0, 'the computer knows something to forget');

  root.querySelector('#new-game').click();
  const fresh = app.state;

  assert.equal(fresh.phase, 'setup');
  assert.equal(fresh.turn, 0);
  assert.deepEqual(fresh.shots, { player: 0, enemy: 0 });
  assert.equal(fresh.winner, null);
  assert.deepEqual(fresh.log, []);
  assert.equal(fresh.player.shots.size, 0);
  assert.equal(fresh.enemy.shots.size, 0);
  assert.deepEqual(fresh.lastShot, { player: null, enemy: null });
  assert.equal(fresh.opponent.knowledge.shots.size, 0, 'a new opponent, with no memory of the last game');
  assert.notDeepEqual(
    fresh.enemy.ships.map((ship) => ship.cells.map(labelOf).join('')),
    oldLayout,
    'a fresh enemy layout',
  );

  assert.equal(root.querySelector('#result'), null, 'no result left on screen');
  assert.equal(root.querySelector('#scoreboard'), null, 'and no counters during setup');
  assert.equal(root.querySelector('.log-empty').textContent, 'No shots yet');
  assert.equal(root.querySelectorAll('.square.newest').length, 0, 'no rings from the last game');
  assert.ok(root.querySelector('#start'), 'back at setup, ready to start again');
});

test('a computer shot queued when New game is pressed never lands on the new board', () => {
  const { root, app, timers } = play(26);

  firstEnabled(root, 'enemy').click();
  assert.equal(timers.waiting, 1, 'a reply is in flight');

  root.querySelector('#new-game').click();
  timers.flush();

  assert.equal(app.state.turn, 0, 'the queued shot was cancelled, not merely ignored');
  assert.equal(app.state.player.shots.size, 0);
  assert.equal(app.state.log.length, 0);
  assert.equal(app.state.phase, 'setup');
});

test('200 games played end to end finish with exactly one winner and no repeated shot', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const { root, app, timers } = play(seed);
    const rng = createSeededRng(seed + 5000);

    let rounds = 0;
    while (app.state.phase === 'playing') {
      const open = squares(root, 'enemy').filter((node) => !node.disabled);
      assert.ok(open.length > 0, `seed ${seed}: nowhere left to fire`);
      open[Math.floor(rng() * open.length)].click();
      timers.flush();

      rounds += 1;
      assert.ok(rounds <= 100, `seed ${seed}: ran past 100 rounds`);
    }

    // Exactly one fleet went down, and the game agrees on whose.
    const lost = [isFleetSunk(app.state.player), isFleetSunk(app.state.enemy)].filter(Boolean).length;
    assert.equal(lost, 1, `seed ${seed}: ${lost} fleets sunk`);
    assert.equal(app.state.phase, 'over', `seed ${seed}: the game did not end`);
    assert.equal(
      app.state.winner,
      isFleetSunk(app.state.enemy) ? 'player' : 'enemy',
      `seed ${seed}: wrong winner`,
    );
    assert.equal(timers.waiting, 0, `seed ${seed}: a shot was still queued after the end`);
    assert.equal(root.querySelectorAll('#result').length, 1, `seed ${seed}: no result shown`);

    const mine = shotsBy(app.state, 'player');
    const theirs = shotsBy(app.state, 'enemy');
    assert.equal(new Set(mine.map((entry) => entry.square)).size, mine.length, `seed ${seed}: repeated a shot`);
    assert.equal(new Set(theirs.map((entry) => entry.square)).size, theirs.length, `seed ${seed}: computer repeated a shot`);
    assert.ok(mine.length <= 100 && theirs.length <= 100, `seed ${seed}: more than 100 shots`);
    assert.equal(app.state.turn, mine.length + theirs.length, `seed ${seed}: turn counter drifted`);
    assert.deepEqual(
      app.state.shots,
      { player: mine.length, enemy: theirs.length },
      `seed ${seed}: the counters disagree with the log`,
    );

    app.destroy();
  }
});

function labelOf({ x, y }) {
  return `${'ABCDEFGHIJ'[x]}${y + 1}`;
}
