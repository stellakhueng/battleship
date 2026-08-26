/**
 * Drives the computer opponent against a board and reports what happened.
 *
 * This is the only place that sees both sides: it asks the opponent for a
 * square, fires it at the board through the rules layer, and hands back
 * only the outcome. The opponent object is never given the board.
 */

import { createSeededRng, fireAt, isFleetSunk, placeFleetRandomly } from '../src/rules.js';
import { createOpponent } from '../src/ai.js';

/**
 * Play one game to the end.
 *
 * @param {object} options
 * @param {number} options.seed                       seeds both the layout and the opponent
 * @param {number} [options.maxShots]                 safety net so a broken opponent cannot loop forever
 * @param {(info: object) => void} [options.onShot]   called before each shot with `{ square, opponent, shots }`
 * @param {object} [options.opponentOptions]          passed through to `createOpponent`
 */
export function playGame({ seed, maxShots = 200, onShot, opponentOptions = {} } = {}) {
  const board = placeFleetRandomly(createSeededRng(seed));
  const opponent = createOpponent({ rng: createSeededRng(seed * 7919 + 13), ...opponentOptions });

  const shots = [];
  const sunkShips = [];

  while (!isFleetSunk(board) && shots.length < maxShots) {
    const square = opponent.nextShot();
    if (onShot) onShot({ square, opponent, shots: [...shots], sunkShips: [...sunkShips] });

    const outcome = fireAt(board, square);
    const ship = outcome.sunk ? board.ships.find((s) => s.name === outcome.shipName) : null;

    opponent.record(square, {
      result: outcome.result,
      sunk: outcome.sunk,
      shipName: outcome.shipName,
      shipSize: ship?.size,
      shipCells: ship?.cells.map(({ x, y }) => ({ x, y })),
    });

    shots.push({ square, ...outcome });
    if (ship) sunkShips.push({ name: ship.name, size: ship.size, cells: ship.cells.map(({ x, y }) => ({ x, y })) });
  }

  return { board, opponent, shots, sunkShips, finished: isFleetSunk(board), shotCount: shots.length };
}

/** Shot counts for `games` seeded games, plus the usual summary statistics. */
export function benchmark({ games = 300, firstSeed = 1, opponentOptions = {} } = {}) {
  const counts = [];
  for (let seed = firstSeed; seed < firstSeed + games; seed += 1) {
    const game = playGame({ seed, opponentOptions });
    if (!game.finished) throw new Error(`seed ${seed}: game did not finish in ${game.shotCount} shots`);
    counts.push(game.shotCount);
  }

  const sorted = [...counts].sort((a, b) => a - b);
  const mean = counts.reduce((total, n) => total + n, 0) / counts.length;
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  return { games: counts.length, mean, median, best: sorted[0], worst: sorted[sorted.length - 1], counts };
}
