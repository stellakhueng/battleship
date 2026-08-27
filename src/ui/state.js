/**
 * Game state and the setup-phase moves that change it.
 *
 * No DOM here. Every rule — legality, no-touching, random layouts — comes
 * from the rules layer; this module only decides what the interface is
 * allowed to do next. Randomness is injected, as everywhere else.
 *
 * Part one covers setup only: firing and the turn loop come later, but
 * the shape of the state (shot log, newest shot per grid) is already here
 * so the view can draw a game in progress.
 */

import {
  FLEET,
  HORIZONTAL,
  VERTICAL,
  canPlaceShip,
  isFleetPlaced,
  placeFleetRandomly,
  placeShip,
  removeShip,
  shipAt,
  toLabel,
} from '../rules.js';
import { createOpponent } from '../ai.js';

export const SETUP = 'setup';
export const PLAYING = 'playing';

const READY = 'Your fleet is ready. Scatter it again, click a ship to move it, or start the game.';

export function createGame({ rng = Math.random } = {}) {
  return {
    phase: SETUP,
    rng,
    player: placeFleetRandomly(rng),
    enemy: placeFleetRandomly(rng),
    /** The computer plays through this and is never handed a board. */
    opponent: createOpponent({ rng }),
    /** The ship currently picked up, waiting for somewhere to go. */
    selected: null,
    /** Newest shot per grid, so the view can ring exactly one square each. */
    lastShot: { player: null, enemy: null },
    log: [],
    message: READY,
  };
}

/** Lay the player's fleet out again from scratch. */
export function scatterFleet(state) {
  if (state.phase !== SETUP) return state;
  state.player = placeFleetRandomly(state.rng);
  state.selected = null;
  state.message = READY;
  return state;
}

/**
 * Pick up the ship under a square so it can be put down elsewhere. The
 * ship comes off the board while it is held, which is what stops a second
 * copy appearing when it is placed again.
 */
export function pickUpShip(state, square) {
  if (state.phase !== SETUP || state.selected) return state;

  const ship = shipAt(state.player, square);
  if (!ship) {
    state.message = 'No ship there. Click one of your ships to pick it up.';
    return state;
  }

  removeShip(state.player, ship.name);
  state.selected = {
    name: ship.name,
    size: ship.size,
    orientation: ship.orientation,
    /** Where it came from, so Escape can put it back untouched. */
    origin: { ...ship.cells[0] },
  };
  state.message = `${ship.name} picked up. Click a square to put it down, or press Escape to leave it where it was.`;
  return state;
}

/** Put the held ship back exactly where it was picked up from. */
export function cancelPickup(state) {
  if (!state.selected) return state;

  const { name, size, orientation, origin } = state.selected;
  placeShip(state.player, { name, size, ...origin, orientation });
  state.selected = null;
  state.message = `${name} put back. ${READY}`;
  return state;
}

/**
 * Put the held ship down. It keeps its orientation where it fits and
 * turns where it does not, so a single click is usually enough.
 */
export function dropShip(state, square) {
  if (state.phase !== SETUP || !state.selected) return state;

  const { name, size, orientation } = state.selected;
  const rotated = orientation === HORIZONTAL ? VERTICAL : HORIZONTAL;
  const fits = [orientation, rotated].find((option) =>
    canPlaceShip(state.player, { ...square, size, orientation: option }),
  );

  if (!fits) {
    state.message = `${name} will not fit at ${toLabel(square)}. Ships may not touch, not even corners.`;
    return state;
  }

  placeShip(state.player, { name, size, ...square, orientation: fits });
  state.selected = null;
  state.message = READY;
  return state;
}

/** Pick up or put down, depending on whether a ship is in hand. */
export function handlePlayerSquare(state, square) {
  return state.selected ? dropShip(state, square) : pickUpShip(state, square);
}

/** Begin play. Only possible with the whole fleet on the board. */
export function startGame(state) {
  if (state.phase !== SETUP) return state;
  if (!isFleetPlaced(state.player, FLEET)) {
    state.message = 'Put every ship down before starting.';
    return state;
  }

  state.phase = PLAYING;
  state.selected = null;
  state.message = 'Your turn. Fire at the enemy grid.';
  return state;
}
