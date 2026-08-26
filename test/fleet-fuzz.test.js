import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_SIZE, FLEET, createSeededRng, placeFleetRandomly } from '../src/rules.js';

const LAYOUTS = 2000;

/**
 * The layout checks below deliberately use no helper from the rules module
 * — no canPlaceShip, no isOnBoard — so a broken rule cannot validate its
 * own output. Bounds, overlap and touching are all recomputed here from
 * the raw cell coordinates.
 */

/** Closest pair of squares between two ships, by Chebyshev distance. */
function closestSquares(a, b) {
  let closest = null;
  for (const cellA of a.cells) {
    for (const cellB of b.cells) {
      const distance = Math.max(Math.abs(cellA.x - cellB.x), Math.abs(cellA.y - cellB.y));
      if (!closest || distance < closest.distance) closest = { cellA, cellB, distance };
    }
  }
  return closest;
}

function findViolation(board, size) {
  const expected = FLEET.map((s) => `${s.name}/${s.size}`).sort();
  const actual = board.ships.map((s) => `${s.name}/${s.size}`).sort();
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    return `fleet is [${actual.join(', ')}], expected [${expected.join(', ')}]`;
  }

  for (const ship of board.ships) {
    if (ship.cells.length !== ship.size) return `${ship.name} occupies ${ship.cells.length} squares, not ${ship.size}`;

    const sameRow = ship.cells.every((c) => c.y === ship.cells[0].y);
    const sameColumn = ship.cells.every((c) => c.x === ship.cells[0].x);
    if (!sameRow && !sameColumn) return `${ship.name} is not in a straight line`;

    for (let i = 1; i < ship.cells.length; i += 1) {
      const previous = ship.cells[i - 1];
      const current = ship.cells[i];
      if (Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y) !== 1) {
        return `${ship.name} has a gap between squares`;
      }
    }

    for (const { x, y } of ship.cells) {
      if (!(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size)) {
        return `${ship.name} is outside the ${size}x${size} board at ${x},${y}`;
      }
    }
  }

  // Every pair of ships: no square of one may be within one step of any
  // square of the other in any direction, diagonals included. Overlap is
  // the distance-zero case of the same check.
  for (let i = 0; i < board.ships.length; i += 1) {
    for (let j = i + 1; j < board.ships.length; j += 1) {
      const a = board.ships[i];
      const b = board.ships[j];
      const { cellA, distance } = closestSquares(a, b);
      if (distance === 0) return `${a.name} overlaps ${b.name} at ${cellA.x},${cellA.y}`;
      if (distance === 1) return `${a.name} touches ${b.name} at ${cellA.x},${cellA.y}`;
    }
  }

  return null;
}

test(`${LAYOUTS} random layouts are all legal`, () => {
  for (let seed = 1; seed <= LAYOUTS; seed += 1) {
    const rng = createSeededRng(seed);
    let board;
    try {
      board = placeFleetRandomly(rng);
    } catch (error) {
      assert.fail(`seed ${seed}: ${error.message}`);
    }

    assert.equal(board.size, BOARD_SIZE);
    const violation = findViolation(board, BOARD_SIZE);
    // The seed alone is enough to replay a failing layout exactly.
    assert.equal(violation, null, `seed ${seed}: ${violation}`);
  }
});

test('the validator itself catches overlapping and touching ships', () => {
  const cells = (...pairs) => pairs.map(([x, y]) => ({ x, y }));
  const base = () => ({
    size: BOARD_SIZE,
    shots: new Map(),
    ships: [
      { name: 'Carrier', size: 5, cells: cells([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]) },
      { name: 'Battleship', size: 4, cells: cells([0, 2], [1, 2], [2, 2], [3, 2]) },
      { name: 'Cruiser', size: 3, cells: cells([0, 4], [1, 4], [2, 4]) },
      { name: 'Submarine', size: 3, cells: cells([0, 6], [1, 6], [2, 6]) },
      { name: 'Destroyer', size: 2, cells: cells([0, 8], [1, 8]) },
    ],
  });

  assert.equal(findViolation(base(), BOARD_SIZE), null);

  const diagonal = base();
  diagonal.ships[4].cells = cells([3, 7], [4, 7]); // corner-to-corner with the Submarine
  assert.match(findViolation(diagonal, BOARD_SIZE), /touches/);

  const overlapping = base();
  overlapping.ships[4].cells = cells([1, 6], [1, 7]);
  assert.match(findViolation(overlapping, BOARD_SIZE), /overlaps/);

  const offBoard = base();
  offBoard.ships[4].cells = cells([9, 9], [10, 9]);
  assert.match(findViolation(offBoard, BOARD_SIZE), /outside the 10x10 board/);
});

test('layouts vary across seeds', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    const board = placeFleetRandomly(createSeededRng(seed));
    seen.add(board.ships.map((s) => `${s.name}${s.cells.map((c) => `${c.x},${c.y}`).join(' ')}`).join('|'));
  }
  assert.ok(seen.size > 190, `expected near-unique layouts, got ${seen.size} of 200`);
});
