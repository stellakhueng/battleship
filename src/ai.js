/**
 * Computer opponent.
 *
 * The opponent never sees the board it is shooting at. It is given two
 * things and nothing else: `nextShot()` asks it where it wants to fire,
 * and `record(square, outcome)` tells it what happened there. Everything
 * it "knows" is built from those answers, so it cannot cheat even by
 * accident.
 *
 * Strategy is probability density. Each turn every legal position of
 * every ship still afloat is enumerated; positions ruled out by what the
 * opponent knows are discarded, and each surviving position adds to the
 * score of the unfired squares it covers. Positions covering an
 * outstanding hit — a hit not yet explained by a sunk ship — score 25x
 * higher per hit explained, which chases damaged ships without a separate
 * targeting mode.
 */

import { BOARD_SIZE, FLEET, HORIZONTAL, VERTICAL, isOnBoard, shipCells } from './rules.js';

/**
 * How much a position covering one outstanding hit is worth. A position
 * explaining several outstanding hits scales with the number it explains,
 * so a long ship lining up with a row of hits outweighs open water, where
 * a square can be covered by up to 34 unweighted positions.
 */
export const DAMAGED_SHIP_WEIGHT = 25;

function key(x, y) {
  return `${x},${y}`;
}

function parseKey(k) {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
}

/**
 * @param {object} options
 * @param {() => number} options.rng   random-number generator, [0, 1)
 * @param {number} [options.size]      board edge length
 * @param {Array<{name: string, size: number}>} [options.fleet]
 * @param {number} [options.damagedShipWeight]      set to 1 to switch the 25x weighting off
 * @param {boolean} [options.excludeAdjacentToSunk] set to false to ignore the no-touching deduction
 */
export function createOpponent({
  rng,
  size = BOARD_SIZE,
  fleet = FLEET,
  damagedShipWeight = DAMAGED_SHIP_WEIGHT,
  excludeAdjacentToSunk = true,
} = {}) {
  if (typeof rng !== 'function') throw new TypeError('createOpponent requires a random-number generator');

  /** Every square fired at, and what came back. */
  const shots = new Map();
  /** Squares known to hold no ship: misses, plus the ring around sunk ships. */
  const impossible = new Set();
  /** Squares belonging to ships already sunk. */
  const sunkCells = new Set();
  /** Ships still believed afloat. */
  let afloat = [...fleet];

  /** Hits not yet explained by a sunk ship. */
  function outstandingHits() {
    const hits = [];
    for (const [k, result] of shots) {
      if (result === 'hit' && !sunkCells.has(k)) hits.push(k);
    }
    return hits;
  }

  /**
   * Could a ship sit here, given only what the opponent has been told?
   *
   * Beyond misses and sunk ships, the no-touching rule rules out one more
   * class of position: an outstanding hit the position does not cover
   * belongs to some other ship, and ships may not touch, so a position
   * lying next to such a hit is impossible.
   */
  function positionIsPossible(cells, pending) {
    if (!cells.every((cell) => isOnBoard(cell, size) && !impossible.has(key(cell.x, cell.y)))) return false;

    const own = new Set(cells.map((cell) => key(cell.x, cell.y)));
    for (const hit of pending) {
      if (own.has(hit)) continue;
      const { x, y } = parseKey(hit);
      if (cells.some((cell) => Math.abs(cell.x - x) <= 1 && Math.abs(cell.y - y) <= 1)) return false;
    }
    return true;
  }

  /**
   * Score every unfired square by how many still-possible ship positions
   * cover it, weighting positions that would explain an outstanding hit.
   */
  function densityMap() {
    const scores = new Map();
    const pending = new Set(outstandingHits());

    for (const ship of afloat) {
      for (const orientation of [HORIZONTAL, VERTICAL]) {
        if (ship.size === 1 && orientation === VERTICAL) continue;
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const cells = shipCells({ x, y, size: ship.size, orientation });
            if (!positionIsPossible(cells, pending)) continue;

            const damageExplained = cells.filter((cell) => pending.has(key(cell.x, cell.y))).length;
            const weight = 1 + (damagedShipWeight - 1) * damageExplained;

            for (const cell of cells) {
              const k = key(cell.x, cell.y);
              if (shots.has(k)) continue; // already fired at: no point scoring it
              scores.set(k, (scores.get(k) ?? 0) + weight);
            }
          }
        }
      }
    }

    return scores;
  }

  function unfiredSquares() {
    const squares = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!shots.has(key(x, y))) squares.push({ x, y });
      }
    }
    return squares;
  }

  function pick(items) {
    const value = rng();
    if (!(value >= 0 && value < 1)) throw new RangeError(`rng must return a value in [0, 1), got ${value}`);
    return items[Math.floor(value * items.length)];
  }

  return {
    /** The square the opponent wants to fire at. */
    nextShot() {
      const scores = densityMap();

      let best = 0;
      let bestKeys = [];
      for (const [k, score] of scores) {
        if (score > best) {
          best = score;
          bestKeys = [k];
        } else if (score === best) {
          bestKeys.push(k);
        }
      }

      // Nothing scores: no legal position survives (a board that does not
      // match the fleet, say). Shoot somewhere unfired rather than stall.
      if (best === 0 || bestKeys.length === 0) {
        const remaining = unfiredSquares();
        if (remaining.length === 0) throw new Error('every square has been fired at');
        return pick(remaining);
      }

      return parseKey(pick(bestKeys));
    },

    /**
     * Tell the opponent what its shot did.
     *
     * @param {{x: number, y: number}} square
     * @param {object} outcome
     * @param {'hit'|'miss'} outcome.result
     * @param {boolean} [outcome.sunk]
     * @param {string} [outcome.shipName]  which ship went down
     * @param {number} [outcome.shipSize]  how big it was
     * @param {Array<{x: number, y: number}>} [outcome.shipCells] which squares it occupied
     */
    record({ x, y }, { result, sunk = false, shipName, shipSize, shipCells: sunkShipCells } = {}) {
      if (result !== 'hit' && result !== 'miss') throw new RangeError(`unknown outcome "${result}"`);

      const k = key(x, y);
      shots.set(k, result);
      if (result === 'miss') impossible.add(k);

      if (!sunk) return;
      if (!Array.isArray(sunkShipCells)) throw new TypeError('a sinking must say which squares the ship occupied');

      for (const cell of sunkShipCells) {
        sunkCells.add(key(cell.x, cell.y));
        impossible.add(key(cell.x, cell.y));

        // No ship may touch another, so the ring around a sunk ship is
        // empty water — deducible, not a guess.
        if (!excludeAdjacentToSunk) continue;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const neighbour = { x: cell.x + dx, y: cell.y + dy };
            if (isOnBoard(neighbour, size)) impossible.add(key(neighbour.x, neighbour.y));
          }
        }
      }

      const index = afloat.findIndex((ship) =>
        shipName === undefined ? ship.size === shipSize : ship.name === shipName,
      );
      if (index !== -1) afloat = afloat.filter((_, i) => i !== index);
    },

    /** Read-only view of what the opponent knows, for tests and the interface. */
    get knowledge() {
      return {
        shots: new Map(shots),
        impossible: new Set(impossible),
        sunkCells: new Set(sunkCells),
        afloat: [...afloat],
        outstandingHits: outstandingHits().map(parseKey),
      };
    },
  };
}
