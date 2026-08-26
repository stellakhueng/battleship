import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALREADY_FIRED,
  BOARD_SIZE,
  FLEET,
  HIT,
  HORIZONTAL,
  MAX_BOARD_SIZE,
  MISS,
  VERTICAL,
  canPlaceShip,
  createBoard,
  createSeededRng,
  fireAt,
  fromLabel,
  isFleetPlaced,
  isFleetSunk,
  isOnBoard,
  isShipSunk,
  legalPlacements,
  placeFleetRandomly,
  placeShip,
  shipCells,
  toLabel,
} from '../src/rules.js';

function sink(board, ship) {
  let last;
  for (const cell of ship.cells) last = fireAt(board, cell);
  return last;
}

test('labels map both ways across the whole grid', () => {
  assert.equal(toLabel({ x: 0, y: 0 }), 'A1');
  assert.equal(toLabel({ x: 9, y: 9 }), 'J10');
  assert.deepEqual(fromLabel('A1'), { x: 0, y: 0 });
  assert.deepEqual(fromLabel('j10'), { x: 9, y: 9 });
  assert.throws(() => fromLabel('K1'), RangeError);
  assert.throws(() => fromLabel('A11'), RangeError);
  assert.throws(() => fromLabel('A0'), RangeError);
  assert.throws(() => toLabel({ x: 10, y: 0 }), RangeError);
});

test('shipCells lays ships out horizontally and vertically only', () => {
  assert.deepEqual(shipCells({ x: 2, y: 3, size: 3, orientation: HORIZONTAL }), [
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 4, y: 3 },
  ]);
  assert.deepEqual(shipCells({ x: 2, y: 3, size: 2, orientation: VERTICAL }), [
    { x: 2, y: 3 },
    { x: 2, y: 4 },
  ]);
});

test('a fresh board has no ships and no shots', () => {
  const board = createBoard();
  assert.equal(board.size, BOARD_SIZE);
  assert.deepEqual(board.ships, []);
  assert.equal(board.shots.size, 0);
});

test('placement must stay fully on the board', () => {
  const board = createBoard();
  assert.ok(canPlaceShip(board, { x: 5, y: 9, size: 5, orientation: HORIZONTAL }));
  assert.ok(!canPlaceShip(board, { x: 6, y: 9, size: 5, orientation: HORIZONTAL }));
  assert.ok(canPlaceShip(board, { x: 9, y: 5, size: 5, orientation: VERTICAL }));
  assert.ok(!canPlaceShip(board, { x: 9, y: 6, size: 5, orientation: VERTICAL }));
  assert.ok(!canPlaceShip(board, { x: -1, y: 0, size: 2, orientation: HORIZONTAL }));
  assert.ok(!canPlaceShip(board, { x: 0, y: 0, size: 2, orientation: 'diagonal' }));
});

test('placeShip rejects an illegal placement', () => {
  const board = createBoard();
  assert.throws(
    () => placeShip(board, { name: 'Carrier', size: 5, x: 8, y: 0, orientation: HORIZONTAL }),
    /illegal placement/,
  );
});

test('placeShip mutates the board it is given and returns it', () => {
  const board = createBoard();
  const returned = placeShip(board, { name: 'Destroyer', size: 2, x: 0, y: 0, orientation: HORIZONTAL });

  assert.equal(returned, board, 'the same board object comes back, so calls can be chained');
  assert.equal(board.ships.length, 1);
  assert.equal(board.ships[0].name, 'Destroyer');

  // One board, one shot record: firing is visible however the board was reached.
  fireAt(returned, { x: 0, y: 0 });
  assert.equal(board.shots.size, 1);
  assert.equal(board.ships[0].hits.size, 1);
  assert.equal(returned.ships[0], board.ships[0]);
});

test('ships may not overlap', () => {
  const board = placeShip(createBoard(), { name: 'Cruiser', size: 3, x: 4, y: 4, orientation: HORIZONTAL });
  assert.ok(!canPlaceShip(board, { x: 4, y: 4, size: 2, orientation: VERTICAL }));
  assert.ok(!canPlaceShip(board, { x: 6, y: 4, size: 2, orientation: HORIZONTAL }));
});

test('ships may not touch side-on or diagonally', () => {
  const board = placeShip(createBoard(), { name: 'Cruiser', size: 3, x: 4, y: 4, orientation: HORIZONTAL });

  // Every square in the ring around D5-F5 is blocked...
  for (let y = 3; y <= 5; y += 1) {
    for (let x = 3; x <= 7; x += 1) {
      assert.ok(
        !canPlaceShip(board, { x, y, size: 1, orientation: HORIZONTAL }),
        `expected ${toLabel({ x, y })} to be blocked`,
      );
    }
  }

  // ...and one square further out is free again.
  assert.ok(canPlaceShip(board, { x: 4, y: 6, size: 1, orientation: HORIZONTAL }));
  assert.ok(canPlaceShip(board, { x: 2, y: 4, size: 1, orientation: HORIZONTAL }));
  assert.ok(canPlaceShip(board, { x: 8, y: 4, size: 1, orientation: HORIZONTAL }));
  assert.ok(canPlaceShip(board, { x: 4, y: 2, size: 1, orientation: HORIZONTAL }));
});

test('the no-touching rule holds at the edges and corners', () => {
  const corner = placeShip(createBoard(), { name: 'Destroyer', size: 2, x: 0, y: 0, orientation: HORIZONTAL });
  assert.ok(!canPlaceShip(corner, { x: 0, y: 1, size: 2, orientation: HORIZONTAL }));
  assert.ok(!canPlaceShip(corner, { x: 2, y: 1, size: 2, orientation: HORIZONTAL }));
  assert.ok(canPlaceShip(corner, { x: 0, y: 2, size: 2, orientation: HORIZONTAL }));
  assert.ok(canPlaceShip(corner, { x: 3, y: 0, size: 2, orientation: HORIZONTAL }));

  const farCorner = placeShip(createBoard(), { name: 'Destroyer', size: 2, x: 9, y: 8, orientation: VERTICAL });
  assert.ok(!canPlaceShip(farCorner, { x: 8, y: 7, size: 1, orientation: HORIZONTAL }));
  assert.ok(canPlaceShip(farCorner, { x: 7, y: 9, size: 1, orientation: HORIZONTAL }));
});

test('firing reports hit, miss and already-fired', () => {
  const board = placeShip(createBoard(), { name: 'Cruiser', size: 3, x: 0, y: 0, orientation: HORIZONTAL });

  const miss = fireAt(board, { x: 5, y: 5 });
  assert.deepEqual(miss, { result: MISS, sunk: false, shipName: null, coordinate: 'F6' });

  const hit = fireAt(board, { x: 0, y: 0 });
  assert.deepEqual(hit, { result: HIT, sunk: false, shipName: 'Cruiser', coordinate: 'A1' });

  assert.equal(fireAt(board, { x: 0, y: 0 }).result, ALREADY_FIRED);
  assert.equal(fireAt(board, { x: 5, y: 5 }).result, ALREADY_FIRED);

  // Repeat shots must not be recorded twice or count as damage.
  assert.equal(board.shots.size, 2);
  assert.equal(board.ships[0].hits.size, 1);
  assert.throws(() => fireAt(board, { x: 10, y: 0 }), RangeError);
});

test('the board records every square fired at', () => {
  const board = placeShip(createBoard(), { name: 'Destroyer', size: 2, x: 0, y: 0, orientation: HORIZONTAL });
  fireAt(board, { x: 0, y: 0 });
  fireAt(board, { x: 4, y: 4 });
  assert.deepEqual([...board.shots.entries()], [
    ['0,0', HIT],
    ['4,4', MISS],
  ]);
});

test('the sinking shot says which ship went down', () => {
  const board = placeShip(createBoard(), { name: 'Destroyer', size: 2, x: 3, y: 3, orientation: VERTICAL });
  const [ship] = board.ships;

  const first = fireAt(board, { x: 3, y: 3 });
  assert.equal(first.sunk, false);
  assert.ok(!isShipSunk(ship));

  const second = fireAt(board, { x: 3, y: 4 });
  assert.deepEqual(second, { result: HIT, sunk: true, shipName: 'Destroyer', coordinate: 'D5' });
  assert.ok(isShipSunk(ship));
});

test('the fleet is sunk only once every ship is down', () => {
  const board = createBoard();
  placeShip(board, { name: 'Destroyer', size: 2, x: 0, y: 0, orientation: HORIZONTAL });
  placeShip(board, { name: 'Cruiser', size: 3, x: 0, y: 2, orientation: HORIZONTAL });

  assert.equal(isFleetSunk(createBoard()), false, 'an empty board is not a sunk fleet');
  assert.equal(isFleetSunk(board), false);

  sink(board, board.ships[0]);
  assert.equal(isFleetSunk(board), false);

  const last = sink(board, board.ships[1]);
  assert.equal(last.sunk, true);
  assert.equal(last.shipName, 'Cruiser');
  assert.equal(isFleetSunk(board), true);
});

test('isFleetPlaced reports when setting up is finished', () => {
  const board = createBoard();
  const rng = createSeededRng(7);

  for (const { name, size } of FLEET) {
    assert.equal(isFleetPlaced(board), false);
    const spots = legalPlacements(board, size);
    placeShip(board, { name, ...spots[Math.floor(rng() * spots.length)] });
  }

  assert.equal(board.ships.length, 5);
  assert.equal(isFleetPlaced(board), true);
  assert.equal(isFleetPlaced(placeFleetRandomly(createSeededRng(3))), true);
});

test('bounds checking follows the board size, not a hardcoded 10', () => {
  assert.ok(isOnBoard({ x: 9, y: 9 }));
  assert.ok(isOnBoard({ x: 5, y: 5 }, 6));
  assert.ok(!isOnBoard({ x: 6, y: 0 }, 6));

  const small = createBoard(6);
  assert.ok(canPlaceShip(small, { x: 2, y: 5, size: 4, orientation: HORIZONTAL }));
  assert.ok(!canPlaceShip(small, { x: 3, y: 5, size: 4, orientation: HORIZONTAL }));
  assert.ok(!canPlaceShip(small, { x: 5, y: 3, size: 4, orientation: VERTICAL }));
  assert.throws(() => fireAt(small, { x: 6, y: 0 }), RangeError);
});

test('boards are capped at 10 a side, the largest size labels exist for', () => {
  assert.equal(MAX_BOARD_SIZE, 10);
  assert.equal(toLabel({ x: 9, y: 9 }), 'J10');

  assert.throws(() => createBoard(11), RangeError);
  assert.throws(() => createBoard(26), RangeError);
  assert.throws(() => createBoard(0), RangeError);
  assert.throws(() => createBoard(6.5), RangeError);
  assert.equal(createBoard(10).size, 10);
  assert.equal(createBoard(6).size, 6);

  // The cap is what stops fireAt accepting a square that has no label.
  assert.throws(() => toLabel({ x: 10, y: 0 }), RangeError);
});

test('a full fleet placed on a smaller board stays inside it', () => {
  const size = 8;
  for (let seed = 1; seed <= 50; seed += 1) {
    const board = placeFleetRandomly(createSeededRng(seed), { size });
    assert.equal(board.size, size);
    assert.ok(isFleetPlaced(board), `seed ${seed}: fleet incomplete`);
    for (const ship of board.ships) {
      for (const cell of ship.cells) {
        assert.ok(
          isOnBoard(cell, size),
          `seed ${seed}: ${ship.name} outside the ${size}x${size} board at ${cell.x},${cell.y}`,
        );
      }
    }
  }
});

test('legalPlacements enumerates positions and shrinks as ships land', () => {
  const empty = createBoard();
  // 10 rows x 6 starts + 10 columns x 6 starts for a size-5 ship.
  assert.equal(legalPlacements(empty, 5).length, 120);

  const board = placeShip(createBoard(), { name: 'Carrier', size: 5, x: 0, y: 0, orientation: HORIZONTAL });
  const after = legalPlacements(board, 5);
  assert.ok(after.length < 120);
  for (const spot of after) {
    assert.ok(canPlaceShip(board, spot));
  }
});

test('the same seed replays the same fleet', () => {
  const a = placeFleetRandomly(createSeededRng(12345));
  const b = placeFleetRandomly(createSeededRng(12345));
  const c = placeFleetRandomly(createSeededRng(999));

  const layout = (board) => board.ships.map((s) => `${s.name}:${s.cells.map(toLabel).join('')}`).sort();
  assert.deepEqual(layout(a), layout(b));
  assert.notDeepEqual(layout(a), layout(c));
});

test('placeFleetRandomly needs a generator', () => {
  assert.throws(() => placeFleetRandomly(), TypeError);
  assert.throws(() => placeFleetRandomly(() => 1.5), RangeError);
});
