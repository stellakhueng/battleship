import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_SIZE, FLEET, createSeededRng, isOnBoard, placeFleetRandomly, toLabel } from '../src/rules.js';

const LAYOUTS = 2000;

/**
 * Everything that makes a layout legal, checked from scratch rather than
 * with the placement helpers the generator itself uses.
 */
function findViolation(board) {
  const expected = [...FLEET].map((s) => `${s.name}/${s.size}`).sort();
  const actual = board.ships.map((s) => `${s.name}/${s.size}`).sort();
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    return `fleet is ${actual.join(', ')}, expected ${expected.join(', ')}`;
  }

  const owner = new Map();
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

    for (const cell of ship.cells) {
      if (!isOnBoard(cell)) return `${ship.name} runs off the board at ${cell.x},${cell.y}`;
      const k = `${cell.x},${cell.y}`;
      if (owner.has(k)) return `${ship.name} overlaps ${owner.get(k)} at ${toLabel(cell)}`;
      owner.set(k, ship.name);
    }
  }

  for (const ship of board.ships) {
    for (const cell of ship.cells) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighbour = owner.get(`${cell.x + dx},${cell.y + dy}`);
          if (neighbour && neighbour !== ship.name) {
            return `${ship.name} touches ${neighbour} at ${toLabel(cell)}`;
          }
        }
      }
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
    const violation = findViolation(board);
    // The seed alone is enough to replay a failing layout exactly.
    assert.equal(violation, null, `seed ${seed}: ${violation}`);
  }
});

test('layouts vary across seeds', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed += 1) {
    const board = placeFleetRandomly(createSeededRng(seed));
    seen.add(board.ships.map((s) => `${s.name}${s.cells.map(toLabel).join('')}`).join('|'));
  }
  assert.ok(seen.size > 190, `expected near-unique layouts, got ${seen.size} of 200`);
});
