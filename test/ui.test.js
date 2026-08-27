import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { FLEET, createSeededRng, isFleetPlaced, shipAt } from '../src/rules.js';
import { mount } from '../src/ui/main.js';

const SHIP_SQUARES = FLEET.reduce((total, ship) => total + ship.size, 0); // 17

/** A mounted interface driven through the real DOM, with a seeded layout. */
function open(seed = 1) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  const root = dom.window.document.getElementById('app');
  const app = mount(root, { rng: createSeededRng(seed) });
  return { dom, root, app, doc: dom.window.document };
}

const grid = (root, side) => root.querySelector(`.grid[data-side="${side}"]`);
const squares = (root, side) => [...grid(root, side).querySelectorAll('.square')];
const square = (root, side, label) => grid(root, side).querySelector(`.square[data-square="${label}"]`);

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
      assert.equal(row.querySelector('.roster-status').textContent, `${size} left`);
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

function labelOf({ x, y }) {
  return `${'ABCDEFGHIJ'[x]}${y + 1}`;
}
