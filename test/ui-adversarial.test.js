/**
 * A bug hunt, not a demonstration. Each test names an assumption the
 * interface makes and tries to break it: restart racing a queued shot,
 * state surviving a New game, input arriving in the wrong phase, and
 * focus landing on controls that do nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { FLEET, createSeededRng, isFleetSunk, shipAt } from '../src/rules.js';
import { mount } from '../src/ui/main.js';

const SHIP_SQUARES = FLEET.reduce((total, ship) => total + ship.size, 0); // 17

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
    flush() {
      for (const [id, fn] of [...queued]) {
        queued.delete(id);
        fn();
      }
    },
  };
}

function open(seed = 1) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  const doc = dom.window.document;
  const root = doc.getElementById('app');
  const timers = manualTimers();
  const app = mount(root, { rng: createSeededRng(seed), timers });
  return { dom, doc, root, app, timers };
}

function play(seed = 1) {
  const game = open(seed);
  game.root.querySelector('#start').click();
  return game;
}

const grid = (root, side) => root.querySelector(`.grid[data-side="${side}"]`);
const squares = (root, side) => [...grid(root, side).querySelectorAll('.square')];
const square = (root, side, label) => grid(root, side).querySelector(`.square[data-square="${label}"]`);
const firstEnabled = (root, side) => squares(root, side).find((node) => !node.disabled);
const labelOf = ({ x, y }) => `${'ABCDEFGHIJ'[x]}${y + 1}`;
const marks = (root, side) =>
  squares(root, side).filter((node) => node.querySelector('.mark, .cross, .miss') || node.classList.contains('newest'));
const rings = (root, side) => squares(root, side).filter((node) => node.classList.contains('newest'));
const escape = (doc) => doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));

/** Every mark drawn on a board, however it is drawn. */
const drawn = (state, side) => {
  const board = side === 'player' ? state.player : state.enemy;
  return board.shots.size;
};

/* Restart and timing -------------------------------------------------- */

test('a shot queued when New game is pressed never lands on the new board', () => {
  const { root, app, timers } = play(31);

  firstEnabled(root, 'enemy').click();
  assert.equal(timers.waiting, 1, 'the reply really is in flight');

  root.querySelector('#new-game').click();
  timers.flush();

  assert.equal(app.state.phase, 'setup');
  assert.equal(drawn(app.state, 'player'), 0, 'a shot landed on the fresh board');
  assert.equal(drawn(app.state, 'enemy'), 0);
  assert.equal(app.state.log.length, 0);
  assert.equal(app.state.turn, 0);
});

test('restarting mid-game leaves the computer with no memory of game one', () => {
  const { root, app, timers } = play(32);

  for (let i = 0; i < 12; i += 1) {
    firstEnabled(root, 'enemy').click();
    timers.flush();
  }
  const before = app.state.opponent.knowledge;
  assert.ok(before.shots.size > 0, 'the computer learned something worth forgetting');

  root.querySelector('#new-game').click();
  const after = app.state.opponent.knowledge;

  assert.equal(after.shots.size, 0, 'shots carried over');
  assert.equal(after.outstandingHits.length, 0, 'hits carried over');
  assert.equal(after.afloat.length, FLEET.length, 'the computer still thinks ships are sunk');
  assert.notEqual(after, before, 'the same knowledge object is still in use');
  for (const key of Object.keys(after)) {
    const value = after[key];
    const size = value?.size ?? value?.length;
    if (typeof size === 'number' && key !== 'afloat') {
      assert.equal(size, 0, `knowledge.${key} survived the restart`);
    }
  }
});

test('restart clears the counters, the log, both boards and the rings', () => {
  const { root, app, timers } = play(33);

  for (let i = 0; i < 7; i += 1) {
    firstEnabled(root, 'enemy').click();
    timers.flush();
  }
  assert.ok(rings(root, 'player').length + rings(root, 'enemy').length > 0);

  root.querySelector('#new-game').click();
  const fresh = app.state;

  assert.equal(fresh.turn, 0);
  assert.deepEqual(fresh.shots, { player: 0, enemy: 0 });
  assert.deepEqual(fresh.log, []);
  assert.deepEqual(fresh.lastShot, { player: null, enemy: null });
  assert.equal(drawn(fresh, 'player'), 0);
  assert.equal(drawn(fresh, 'enemy'), 0);
  assert.equal(fresh.winner, null);
  assert.equal(root.querySelectorAll('.square.newest').length, 0);
  assert.equal(root.querySelector('#result'), null);
  assert.equal(root.querySelector('#scoreboard'), null);
});

test('two restarts in a row leave one clean setup, not a half-built second game', () => {
  const { root, app, timers } = play(34);

  firstEnabled(root, 'enemy').click();
  // The button is gone from the screen after the first click, so the second
  // press of a double click lands on the node the browser has yet to drop.
  const button = root.querySelector('#new-game');
  button.click();
  button.click();
  timers.flush();

  assert.equal(app.state.phase, 'setup');
  assert.equal(app.state.log.length, 0);
  assert.equal(drawn(app.state, 'player'), 0);
  assert.equal(timers.waiting, 0, 'a timer outlived two restarts');
  assert.equal(root.querySelectorAll('.grid').length, 2, 'the screen was rebuilt twice over');
  assert.ok(root.querySelector('#start'));
  assert.equal(
    squares(root, 'player').filter((node) => node.classList.contains('hull')).length,
    SHIP_SQUARES,
  );
});

test('setup offers no New game button, and a stale one does no harm', () => {
  const { root, app, timers } = play(35);

  const button = root.querySelector('#new-game');
  button.click();

  // Buttons match the phase: setup has Scatter and Start, and nothing to restart.
  assert.equal(root.querySelector('#new-game'), null, 'New game is on screen during setup');
  assert.ok(root.querySelector('#start') && root.querySelector('#scatter'));

  const before = app.state.player.ships.map((ship) => ship.cells.map(labelOf).join(''));
  button.click();

  assert.equal(app.state.phase, 'setup');
  assert.equal(app.state.player.ships.length, FLEET.length);
  assert.equal(timers.waiting, 0);
  assert.equal(
    squares(root, 'player').filter((node) => node.classList.contains('hull')).length,
    SHIP_SQUARES,
  );
  assert.notDeepEqual(app.state.player.ships.map((ship) => ship.cells.map(labelOf).join('')), before);
});

test('a shot queued before a restart cannot land after the next game has begun', () => {
  const { root, app, timers } = play(47);

  firstEnabled(root, 'enemy').click();
  assert.equal(timers.waiting, 1);

  root.querySelector('#new-game').click();
  root.querySelector('#start').click();
  timers.flush();

  assert.equal(app.state.phase, 'playing');
  assert.equal(app.state.log.length, 0, 'a shot from game one landed in game two');
  assert.equal(drawn(app.state, 'player'), 0);
  assert.deepEqual(app.state.shots, { player: 0, enemy: 0 });
  assert.ok(firstEnabled(root, 'enemy'), 'and it is still your turn');
});

test('fifty games on one mount never leak state from the game before', () => {
  const { root, app, timers } = open(48);
  const rng = createSeededRng(9001);

  for (let game = 1; game <= 50; game += 1) {
    root.querySelector('#start').click();
    assert.equal(app.state.log.length, 0, `game ${game}: began with a log`);
    assert.deepEqual(app.state.shots, { player: 0, enemy: 0 }, `game ${game}: began with shots`);
    assert.equal(app.state.opponent.knowledge.shots.size, 0, `game ${game}: began with a memory`);
    assert.equal(root.querySelectorAll('.square.newest').length, 0, `game ${game}: began with a ring`);

    // Play a random part of the game, sometimes to the end, then walk out.
    const rounds = 1 + Math.floor(rng() * 40);
    for (let i = 0; i < rounds && app.state.phase === 'playing'; i += 1) {
      if (app.state.busy) {
        timers.flush();
        continue;
      }
      const open = squares(root, 'enemy').filter((node) => !node.disabled);
      assert.ok(open.length > 0, `game ${game}: nowhere left to fire on your turn`);
      open[Math.floor(rng() * open.length)].click();
    }

    const fired = [...app.state.enemy.shots.keys()];
    assert.equal(new Set(fired).size, fired.length, `game ${game}: fired at a square twice`);
    assert.equal(app.state.turn, app.state.shots.player + app.state.shots.enemy);

    root.querySelector('#new-game').click();
    timers.flush(); // whatever was in flight must find nothing to land on
    assert.equal(app.state.phase, 'setup', `game ${game}: restart did not return to setup`);
    assert.equal(app.state.log.length, 0, `game ${game}: a queued shot landed after the restart`);
  }
});

test('clicking either grid after the game ends changes nothing at all', () => {
  const { root, app, timers } = play(36);

  for (const ship of [...app.state.enemy.ships]) {
    for (const cell of ship.cells) {
      square(root, 'enemy', labelOf(cell))?.click();
      timers.flush();
    }
  }
  assert.equal(app.state.phase, 'over');

  const before = JSON.stringify({
    log: app.state.log,
    shots: app.state.shots,
    turn: app.state.turn,
    mine: [...app.state.player.shots.keys()],
    theirs: [...app.state.enemy.shots.keys()],
  });

  for (const node of [...squares(root, 'player'), ...squares(root, 'enemy')]) node.click();
  timers.flush();

  assert.equal(
    JSON.stringify({
      log: app.state.log,
      shots: app.state.shots,
      turn: app.state.turn,
      mine: [...app.state.player.shots.keys()],
      theirs: [...app.state.enemy.shots.keys()],
    }),
    before,
  );
  assert.equal(timers.waiting, 0);
});

test('a second game after a finished one behaves exactly like the first', () => {
  const { root, app, timers } = play(37);

  const runToEnd = () => {
    let rounds = 0;
    while (app.state.phase === 'playing') {
      const target = squares(root, 'enemy').find((node) => !node.disabled);
      assert.ok(target, 'nowhere left to fire');
      target.click();
      timers.flush();
      rounds += 1;
      assert.ok(rounds <= 100);
    }
    return {
      winner: app.state.winner,
      turn: app.state.turn,
      shots: { ...app.state.shots },
      log: app.state.log.length,
      sunk: [isFleetSunk(app.state.player), isFleetSunk(app.state.enemy)].filter(Boolean).length,
    };
  };

  const first = runToEnd();
  root.querySelector('#new-game').click();
  root.querySelector('#start').click();
  const second = runToEnd();

  for (const game of [first, second]) {
    assert.equal(game.sunk, 1, 'exactly one fleet went down');
    assert.equal(game.turn, game.shots.player + game.shots.enemy);
    assert.equal(game.log, game.turn);
    assert.ok(game.shots.player <= 100 && game.shots.enemy <= 100);
    assert.ok(game.winner === 'player' || game.winner === 'enemy');
  }
  assert.equal(app.state.log.length, second.turn, 'the second log kept rows from the first');
});

/* Input in the wrong phase -------------------------------------------- */

test('hammering one enemy square fires once', () => {
  const { root, app, timers } = play(38);

  const target = firstEnabled(root, 'enemy');
  for (let i = 0; i < 10; i += 1) target.click();

  assert.equal(app.state.log.length, 1);
  assert.equal(drawn(app.state, 'enemy'), 1);
  assert.equal(timers.waiting, 1, 'ten clicks queued more than one reply');
});

test('clicks during the computer’s think time are ignored, on both grids', () => {
  const { root, app, timers } = play(39);

  firstEnabled(root, 'enemy').click();
  const held = { log: app.state.log.length, enemy: drawn(app.state, 'enemy') };

  for (const node of [...squares(root, 'enemy').slice(0, 20), ...squares(root, 'player').slice(0, 20)]) node.click();

  assert.equal(app.state.log.length, held.log);
  assert.equal(drawn(app.state, 'enemy'), held.enemy);
  assert.equal(timers.waiting, 1);

  timers.flush();
  assert.equal(app.state.log.length, 2, 'the computer replied exactly once');
});

/* Setup edge cases ----------------------------------------------------- */

test('Escape twice puts the ship back once and does not clone it', () => {
  const { doc, root, app } = open(40);

  const hull = squares(root, 'player').find((node) => node.classList.contains('hull'));
  const where = hull.dataset.square;
  hull.click();
  assert.ok(app.state.selected, 'nothing was picked up');

  escape(doc);
  escape(doc);

  assert.equal(app.state.selected, null);
  assert.equal(app.state.player.ships.length, FLEET.length, 'a ship was cloned');
  assert.equal(
    squares(root, 'player').filter((node) => node.classList.contains('hull')).length,
    SHIP_SQUARES,
  );
  assert.ok(square(root, 'player', where).classList.contains('hull'), 'it did not go back where it came from');
});

test('Escape after a scatter does not resurrect the ship that was in hand', () => {
  const { doc, root, app } = open(41);

  squares(root, 'player').find((node) => node.classList.contains('hull')).click();
  assert.ok(app.state.selected);

  root.querySelector('#scatter').click();
  escape(doc);

  assert.equal(app.state.selected, null);
  assert.equal(app.state.player.ships.length, FLEET.length);
  assert.equal(
    squares(root, 'player').filter((node) => node.classList.contains('hull')).length,
    SHIP_SQUARES,
    'the held ship came back on top of a fresh fleet',
  );
  assert.equal(new Set(app.state.player.ships.map((ship) => ship.name)).size, FLEET.length);
});

test('Escape with nothing in hand is a no-op in every phase', () => {
  for (const phase of ['setup', 'playing']) {
    const game = phase === 'setup' ? open(42) : play(42);
    const { doc, root, app } = game;
    const before = JSON.stringify(app.state.player.ships.map((ship) => ship.cells.map(labelOf).join('')));

    escape(doc);
    escape(doc);

    assert.equal(app.state.phase, phase);
    assert.equal(app.state.selected, null);
    assert.equal(JSON.stringify(app.state.player.ships.map((ship) => ship.cells.map(labelOf).join(''))), before);
    assert.equal(root.querySelectorAll('.grid').length, 2);
    app.destroy();
  }
});

test('Start with a ship in hand cannot begin a four-ship game', () => {
  const { root, app } = open(43);

  squares(root, 'player').find((node) => node.classList.contains('hull')).click();
  assert.ok(app.state.selected);
  assert.equal(app.state.player.ships.length, FLEET.length - 1);

  root.querySelector('#start')?.click();

  assert.equal(app.state.phase, 'setup', 'play started with a ship in hand');
  assert.ok(squares(root, 'enemy').every((node) => node.disabled));
});

/* Standing invariants -------------------------------------------------- */

test('no square is focusable that cannot be acted on, in any phase', () => {
  const { root, app, timers } = open(44);

  const enabled = (side) => squares(root, side).filter((node) => !node.disabled);
  const actionable = (side) => {
    if (side === 'enemy') {
      return app.state.phase === 'playing' && !app.state.busy
        ? squares(root, 'enemy').filter((node) => !app.state.enemy.shots.has(`${node.dataset.x},${node.dataset.y}`))
            .length
        : 0;
    }
    return app.state.phase === 'setup' ? 100 : 0;
  };

  const check = (note) => {
    for (const side of ['player', 'enemy']) {
      assert.equal(enabled(side).length, actionable(side), `${note}: ${side} grid`);
    }
  };

  check('setup');
  root.querySelector('#start').click();
  check('your turn');

  firstEnabled(root, 'enemy').click();
  check('their turn');
  timers.flush();
  check('back to you');

  for (const ship of [...app.state.enemy.ships]) {
    for (const cell of ship.cells) {
      square(root, 'enemy', labelOf(cell))?.click();
      timers.flush();
    }
  }
  assert.equal(app.state.phase, 'over');
  check('game over');
});

test('there is never more than one newest-shot ring on a grid', () => {
  const { root, app, timers } = play(45);

  assert.equal(rings(root, 'player').length, 0, 'a ring before a shot was fired');
  assert.equal(rings(root, 'enemy').length, 0);

  for (let i = 0; i < 15 && app.state.phase === 'playing'; i += 1) {
    firstEnabled(root, 'enemy').click();
    assert.equal(rings(root, 'enemy').length, 1, 'your shot did not leave exactly one ring');
    assert.ok(rings(root, 'player').length <= 1);
    timers.flush();
    assert.equal(rings(root, 'enemy').length, 1);
    assert.equal(rings(root, 'player').length, 1, 'their shot did not leave exactly one ring');
  }

  root.querySelector('#new-game').click();
  assert.equal(rings(root, 'player').length, 0, 'a ring survived the restart');
  assert.equal(rings(root, 'enemy').length, 0);
  assert.equal(marks(root, 'player').length, 0);
});

test('a destroyed interface is inert: no shot, no timer, no state change', () => {
  const { root, app, timers } = play(49);

  const target = firstEnabled(root, 'enemy');
  app.destroy();

  target.click();

  assert.equal(app.state.log.length, 0, 'a dead interface still fired a shot');
  assert.equal(drawn(app.state, 'enemy'), 0);
  assert.equal(timers.waiting, 0, 'a dead interface queued a reply nobody can cancel');
});

test('firing with the keyboard leaves the focus somewhere useful', () => {
  const { doc, root, app, timers } = play(50);

  const target = firstEnabled(root, 'enemy');
  const where = target.dataset.square;
  target.focus();
  assert.equal(doc.activeElement.dataset.square, where);

  target.click();
  timers.flush();

  const focused = doc.activeElement;
  assert.notEqual(focused, doc.body, `focus fell off the page after firing at ${where}`);
  assert.ok(
    focused.closest?.('.grid[data-side="enemy"]'),
    'focus left the enemy grid, so the next shot needs a tab through a hundred controls',
  );
  assert.equal(app.state.log.length, 2);
});

test('the enemy grid never names a ship it has not sunk', () => {
  const { root, app, timers } = play(46);

  for (let i = 0; i < 30 && app.state.phase === 'playing'; i += 1) {
    firstEnabled(root, 'enemy').click();
    timers.flush();

    for (const node of squares(root, 'enemy')) {
      const label = node.getAttribute('aria-label');
      const named = FLEET.find(({ name }) => label.includes(name));
      if (!named) continue;
      const ship = shipAt(app.state.enemy, { x: Number(node.dataset.x), y: Number(node.dataset.y) });
      assert.ok(label.includes('sunk'), `${node.dataset.square} names ${named.name} without sinking it`);
      assert.equal(ship?.name, named.name);
    }
  }
});
