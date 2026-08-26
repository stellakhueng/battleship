/**
 * Battleship rules layer.
 *
 * Pure logic only: no DOM, no globals, no module-level mutable state.
 * Every function takes everything it needs as an argument, and any
 * randomness comes from an injected random-number generator so a seeded
 * generator can replay a run exactly.
 *
 * Coordinates are zero-based `{ x, y }` where x is the column (0 => 'A')
 * and y is the row (0 => '1').
 */

export const BOARD_SIZE = 10;

export const HORIZONTAL = 'horizontal';
export const VERTICAL = 'vertical';

export const HIT = 'hit';
export const MISS = 'miss';
export const ALREADY_FIRED = 'already-fired';

export const FLEET = Object.freeze([
  Object.freeze({ name: 'Carrier', size: 5 }),
  Object.freeze({ name: 'Battleship', size: 4 }),
  Object.freeze({ name: 'Cruiser', size: 3 }),
  Object.freeze({ name: 'Submarine', size: 3 }),
  Object.freeze({ name: 'Destroyer', size: 2 }),
]);

const COLUMNS = 'ABCDEFGHIJ';

/** `{ x: 0, y: 0 }` => `'A1'`. */
export function toLabel({ x, y }) {
  if (!isOnBoard({ x, y })) throw new RangeError(`off-board coordinate ${x},${y}`);
  return `${COLUMNS[x]}${y + 1}`;
}

/** `'A1'` => `{ x: 0, y: 0 }`. */
export function fromLabel(label) {
  const match = /^([A-Ja-j])(10|[1-9])$/.exec(String(label).trim());
  if (!match) throw new RangeError(`invalid coordinate label "${label}"`);
  return { x: COLUMNS.indexOf(match[1].toUpperCase()), y: Number(match[2]) - 1 };
}

export function isOnBoard({ x, y }) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

function key(x, y) {
  return `${x},${y}`;
}

/** Squares a ship of `size` occupies starting at `{x, y}` in `orientation`. */
export function shipCells({ x, y, size, orientation }) {
  const cells = [];
  for (let i = 0; i < size; i += 1) {
    cells.push(orientation === HORIZONTAL ? { x: x + i, y } : { x, y: y + i });
  }
  return cells;
}

/** The ship's own squares plus the one-square ring around them, clipped to the board. */
function blockedCells(cells) {
  const blocked = new Set();
  for (const cell of cells) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (isOnBoard({ x, y })) blocked.add(key(x, y));
      }
    }
  }
  return blocked;
}

/** A fresh empty board. */
export function createBoard(size = BOARD_SIZE) {
  return {
    size,
    ships: [],
    /** Map of `"x,y"` => HIT | MISS, holding every square fired at. */
    shots: new Map(),
  };
}

/** Squares already occupied by, or adjacent to, a placed ship. */
function occupiedAndAdjacent(board) {
  const blocked = new Set();
  for (const ship of board.ships) {
    for (const k of blockedCells(ship.cells)) blocked.add(k);
  }
  return blocked;
}

/**
 * Is this placement legal? Ships must be fully on the board, may not
 * overlap and may not touch another ship, not even diagonally.
 */
export function canPlaceShip(board, { x, y, size, orientation }) {
  if (size < 1) return false;
  if (orientation !== HORIZONTAL && orientation !== VERTICAL) return false;

  const cells = shipCells({ x, y, size, orientation });
  if (!cells.every(isOnBoard)) return false;

  const blocked = occupiedAndAdjacent(board);
  return cells.every((cell) => !blocked.has(key(cell.x, cell.y)));
}

/**
 * Place a ship, returning a new board. Throws on an illegal placement.
 */
export function placeShip(board, { name, size, x, y, orientation }) {
  if (!canPlaceShip(board, { x, y, size, orientation })) {
    throw new Error(`illegal placement for ${name} at ${x},${y} ${orientation}`);
  }
  const ship = {
    name,
    size,
    orientation,
    cells: shipCells({ x, y, size, orientation }),
    hits: new Set(),
  };
  return { ...board, ships: [...board.ships, ship] };
}

export function isShipSunk(ship) {
  return ship.hits.size >= ship.size;
}

export function isFleetSunk(board) {
  return board.ships.length > 0 && board.ships.every(isShipSunk);
}

function shipAt(board, x, y) {
  return board.ships.find((ship) => ship.cells.some((cell) => cell.x === x && cell.y === y));
}

/**
 * Fire at a square. Mutates `board`'s shot record and the hit ship.
 *
 * Returns `{ result, sunk, shipName, coordinate }` where result is
 * HIT, MISS or ALREADY_FIRED; `sunk` says whether this shot sank a ship
 * and `shipName` names the ship that was hit (null on a miss).
 */
export function fireAt(board, { x, y }) {
  if (!isOnBoard({ x, y })) throw new RangeError(`off-board shot ${x},${y}`);

  const k = key(x, y);
  const coordinate = toLabel({ x, y });
  if (board.shots.has(k)) {
    return { result: ALREADY_FIRED, sunk: false, shipName: null, coordinate };
  }

  const ship = shipAt(board, x, y);
  if (!ship) {
    board.shots.set(k, MISS);
    return { result: MISS, sunk: false, shipName: null, coordinate };
  }

  board.shots.set(k, HIT);
  ship.hits.add(k);
  const sunk = isShipSunk(ship);
  return { result: HIT, sunk, shipName: ship.name, coordinate };
}

/** Every legal placement of a ship of `size` on `board`. */
export function legalPlacements(board, size) {
  const placements = [];
  for (const orientation of [HORIZONTAL, VERTICAL]) {
    if (size === 1 && orientation === VERTICAL) continue;
    for (let y = 0; y < board.size; y += 1) {
      for (let x = 0; x < board.size; x += 1) {
        if (canPlaceShip(board, { x, y, size, orientation })) {
          placements.push({ x, y, size, orientation });
        }
      }
    }
  }
  return placements;
}

/** Uniformly pick one element using the injected generator. */
function pick(items, rng) {
  const value = rng();
  if (!(value >= 0 && value < 1)) throw new RangeError(`rng must return a value in [0, 1), got ${value}`);
  return items[Math.floor(value * items.length)];
}

/**
 * Place the whole fleet at random. Rather than guessing squares and
 * retrying, every legal position for the next ship is enumerated and one
 * is chosen from it, so this cannot spin.
 *
 * Largest ships go first; a placement can still paint the board into a
 * corner, in which case the whole layout is restarted (bounded).
 */
export function placeFleetRandomly(rng, { fleet = FLEET, size = BOARD_SIZE, maxAttempts = 100 } = {}) {
  if (typeof rng !== 'function') throw new TypeError('placeFleetRandomly requires a random-number generator');

  const ordered = [...fleet].sort((a, b) => b.size - a.size);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let board = createBoard(size);
    let ok = true;

    for (const { name, size: shipSize } of ordered) {
      const placements = legalPlacements(board, shipSize);
      if (placements.length === 0) {
        ok = false;
        break;
      }
      const spot = pick(placements, rng);
      board = placeShip(board, { name, ...spot });
    }

    if (ok) return board;
  }

  throw new Error(`could not place fleet in ${maxAttempts} attempts`);
}

/**
 * Deterministic generator (mulberry32) for tests: same seed, same layout.
 */
export function createSeededRng(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
