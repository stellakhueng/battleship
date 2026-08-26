import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_SIZE, FLEET, createSeededRng, isOnBoard, shipCells } from '../src/rules.js';
import { HORIZONTAL, VERTICAL } from '../src/rules.js';
import { createOpponent } from '../src/ai.js';
import { benchmark, playGame } from '../tools/play.js';

const GAMES = 300;
const SHOT_LIMIT = 100;

const key = ({ x, y }) => `${x},${y}`;
const touching = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

test('the opponent is given no way to see the board', () => {
  const opponent = createOpponent({ rng: createSeededRng(1) });
  assert.deepEqual(Object.keys(opponent).sort(), ['knowledge', 'nextShot', 'record']);
  assert.throws(() => createOpponent(), TypeError);
  assert.throws(() => createOpponent({ rng: createSeededRng(1) }).record({ x: 0, y: 0 }, { result: 'sploosh' }), RangeError);
});

test('a sinking must say which squares the ship occupied', () => {
  const opponent = createOpponent({ rng: createSeededRng(1) });
  assert.throws(
    () => opponent.record({ x: 0, y: 0 }, { result: 'hit', sunk: true, shipName: 'Destroyer', shipSize: 2 }),
    TypeError,
  );
});

test('the opponent never stalls, repeats a shot or fires off the board', () => {
  let total = 0;
  const counts = [];

  for (let seed = 1; seed <= GAMES; seed += 1) {
    const game = playGame({ seed, maxShots: SHOT_LIMIT });
    const fired = new Set();

    for (const { square } of game.shots) {
      assert.ok(isOnBoard(square, BOARD_SIZE), `seed ${seed}: fired off the board at ${square.x},${square.y}`);
      assert.ok(!fired.has(key(square)), `seed ${seed}: fired twice at ${square.x},${square.y}`);
      fired.add(key(square));
    }

    assert.ok(game.finished, `seed ${seed}: fleet still afloat after ${game.shotCount} shots`);
    assert.ok(game.shotCount <= SHOT_LIMIT, `seed ${seed}: took ${game.shotCount} shots`);

    counts.push(game.shotCount);
    total += game.shotCount;
  }

  const sorted = [...counts].sort((a, b) => a - b);
  console.log(
    `\n${GAMES} seeded games: mean ${(total / GAMES).toFixed(1)} shots, median ${sorted[GAMES / 2 - 1]}, ` +
      `best ${sorted[0]}, worst ${sorted[GAMES - 1]}\n`,
  );
});

test('after sinking a ship the opponent never fires next to it', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    playGame({
      seed,
      maxShots: SHOT_LIMIT,
      onShot({ square, sunkShips }) {
        for (const ship of sunkShips) {
          for (const cell of ship.cells) {
            assert.ok(
              !touching(square, cell),
              `seed ${seed}: fired at ${square.x},${square.y}, touching the sunk ${ship.name}`,
            );
          }
        }
      },
    });
  }
});

/**
 * Rebuilt here from the outcomes alone — deliberately not using the
 * opponent's own possibility test, so a broken deduction cannot excuse
 * its own shot.
 */
function placementsExplainingDamage({ misses, sunkShips, outstandingHits, afloatSizes }) {
  const forbidden = new Set(misses.map(key));
  for (const ship of sunkShips) {
    for (const cell of ship.cells) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          forbidden.add(key({ x: cell.x + dx, y: cell.y + dy }));
        }
      }
    }
  }

  const placements = [];
  for (const shipSize of new Set(afloatSizes)) {
    for (const orientation of [HORIZONTAL, VERTICAL]) {
      for (let y = 0; y < BOARD_SIZE; y += 1) {
        for (let x = 0; x < BOARD_SIZE; x += 1) {
          const cells = shipCells({ x, y, size: shipSize, orientation });
          if (!cells.every((cell) => isOnBoard(cell, BOARD_SIZE) && !forbidden.has(key(cell)))) continue;
          if (!outstandingHits.some((hit) => cells.some((cell) => key(cell) === key(hit)))) continue;
          placements.push(cells);
        }
      }
    }
  }
  return placements;
}

test('with hits outstanding, the shot always fits a placement that explains one', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    playGame({
      seed,
      maxShots: SHOT_LIMIT,
      onShot({ square, opponent, sunkShips }) {
        const { shots, outstandingHits, afloat } = opponent.knowledge;
        if (outstandingHits.length === 0) return;

        const misses = [...shots.entries()]
          .filter(([, result]) => result === 'miss')
          .map(([k]) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }));

        const placements = placementsExplainingDamage({
          misses,
          sunkShips,
          outstandingHits,
          afloatSizes: afloat.map((ship) => ship.size),
        });

        assert.ok(
          placements.some((cells) => cells.some((cell) => key(cell) === key(square))),
          `seed ${seed}: shot ${square.x},${square.y} fits no placement covering an outstanding hit`,
        );
      },
    });
  }
});

test('a miss is remembered and never fired at again', () => {
  const opponent = createOpponent({ rng: createSeededRng(4) });
  opponent.record({ x: 3, y: 3 }, { result: 'miss' });
  opponent.record({ x: 4, y: 4 }, { result: 'hit' });

  const { shots, impossible, outstandingHits } = opponent.knowledge;
  assert.equal(shots.get('3,3'), 'miss');
  assert.ok(impossible.has('3,3'));
  assert.ok(!impossible.has('4,4'), 'a hit is not empty water');
  assert.deepEqual(outstandingHits, [{ x: 4, y: 4 }]);

  for (let i = 0; i < 20; i += 1) {
    const square = opponent.nextShot();
    assert.notDeepEqual(square, { x: 3, y: 3 });
    assert.notDeepEqual(square, { x: 4, y: 4 });
  }
});

test('a sunk ship takes its squares and their neighbours out of consideration', () => {
  const opponent = createOpponent({ rng: createSeededRng(5) });
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  opponent.record({ x: 0, y: 0 }, { result: 'hit' });
  opponent.record({ x: 1, y: 0 }, { result: 'hit', sunk: true, shipName: 'Destroyer', shipSize: 2, shipCells: cells });

  const { impossible, afloat, outstandingHits } = opponent.knowledge;
  assert.deepEqual(outstandingHits, [], 'the sunk ship explains both hits');
  assert.deepEqual(afloat.map((ship) => ship.name), ['Carrier', 'Battleship', 'Cruiser', 'Submarine']);
  for (const k of ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1']) {
    assert.ok(impossible.has(k), `${k} should be ruled out`);
  }
  assert.ok(!impossible.has('3,0'));
  assert.ok(!impossible.has('0,2'));
});

test('the opponent still fires when nothing scores', () => {
  const opponent = createOpponent({ rng: createSeededRng(6), fleet: [] });
  const square = opponent.nextShot();
  assert.ok(isOnBoard(square, BOARD_SIZE));
});

test('the same seed replays the same game', () => {
  const a = benchmark({ games: 5 });
  const b = benchmark({ games: 5 });
  assert.deepEqual(a.counts, b.counts);
  assert.equal(a.counts.length, 5);
  assert.equal(FLEET.length, 5);
});
