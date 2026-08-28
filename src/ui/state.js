/**
 * Game state and the setup-phase moves that change it.
 *
 * No DOM here. Every rule — legality, no-touching, random layouts — comes
 * from the rules layer; this module only decides what the interface is
 * allowed to do next. Randomness is injected, as everywhere else.
 *
 * Turns alternate strictly, one shot each, counted by `turn`. While the
 * computer is thinking the state is `busy` and every player move is
 * refused here as well as disabled in the view, so a stray click cannot
 * steal a turn. A shot that sinks the last ship of a fleet ends the game
 * there and then, in whichever direction it happened.
 */

import {
  ALREADY_FIRED,
  FLEET,
  HIT,
  HORIZONTAL,
  VERTICAL,
  canPlaceShip,
  fireAt,
  isFleetPlaced,
  isFleetSunk,
  placeFleetRandomly,
  placeShip,
  removeShip,
  shipAt,
  toLabel,
} from '../rules.js';
import { createOpponent } from '../ai.js';

export const SETUP = 'setup';
export const PLAYING = 'playing';
export const OVER = 'over';

export const PLAYER = 'player';
export const ENEMY = 'enemy';

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
    /** One per shot, whoever fired it: the log reads 1 You, 2 Enemy, 3 You. */
    turn: 0,
    /** Shots fired by each side, shown during play and in the result. */
    shots: { player: 0, enemy: 0 },
    /** Who lost their fleet first, once anyone has. */
    winner: null,
    /** The computer is mid-turn; the player may not move. */
    busy: false,
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
  state.busy = false;
  state.message = 'Your turn. Fire at the enemy grid.';
  return state;
}

/** May the player fire right now? */
export function canPlayerFire(state) {
  return state.phase === PLAYING && !state.busy;
}

/**
 * The last ship of a fleet has gone down. Nobody fires again: the phase
 * shuts both grids in the view and refuses every move here.
 */
function endGame(state, winner) {
  state.phase = OVER;
  state.winner = winner;
  state.busy = false;
  state.message =
    winner === PLAYER
      ? `You won in ${state.shots.player} shots. Computer: ${state.shots.enemy}.`
      : `You lost. The computer won in ${state.shots.enemy} shots. You: ${state.shots.player}.`;
  return state;
}

function logShot(state, who, square, outcome) {
  state.turn += 1;
  state.shots[who] += 1;
  state.lastShot[who === PLAYER ? ENEMY : PLAYER] = { ...square };
  state.log.push({
    turn: state.turn,
    who,
    square: outcome.coordinate,
    result: outcome.result,
    sunkShip: outcome.sunk ? outcome.shipName : null,
  });
}

/**
 * The player's shot at the enemy grid. Returns the outcome, or null when
 * the shot was refused — a refused shot costs no turn and hands nothing
 * to the computer.
 */
export function playerFire(state, square) {
  if (!canPlayerFire(state)) return null;

  const outcome = fireAt(state.enemy, square);
  if (outcome.result === ALREADY_FIRED) {
    state.message = `You have already fired at ${outcome.coordinate}. Pick another square.`;
    return null;
  }

  logShot(state, PLAYER, square, outcome);

  if (isFleetSunk(state.enemy)) {
    endGame(state, PLAYER);
    return outcome;
  }

  // Locked from here until the computer's reply has been drawn.
  state.busy = true;
  state.message = outcome.sunk
    ? `You sank their ${outcome.shipName}! Enemy is taking their shot.`
    : `${outcome.result === HIT ? `You hit ${outcome.coordinate}.` : `You missed at ${outcome.coordinate}.`} Enemy is taking their shot.`;
  return outcome;
}

/**
 * The computer's reply. It picks a square knowing only what it has been
 * told, and is told the result the same way — it never sees the board.
 */
export function enemyFire(state) {
  if (state.phase !== PLAYING) return null;

  const square = state.opponent.nextShot();
  const outcome = fireAt(state.player, square);
  if (outcome.result === ALREADY_FIRED) throw new Error(`the opponent fired at ${outcome.coordinate} twice`);

  const ship = outcome.sunk ? shipAt(state.player, square) : null;
  state.opponent.record(square, {
    result: outcome.result,
    sunk: outcome.sunk,
    shipName: outcome.shipName ?? undefined,
    shipSize: ship?.size,
    shipCells: ship?.cells,
  });

  logShot(state, ENEMY, square, outcome);

  // A loss ends the game here rather than handing the turn back.
  if (isFleetSunk(state.player)) {
    endGame(state, ENEMY);
    return outcome;
  }

  state.busy = false;
  state.message = outcome.sunk
    ? `They sank your ${outcome.shipName}! Your turn.`
    : `${outcome.result === HIT ? `They hit ${outcome.coordinate}.` : `They missed at ${outcome.coordinate}.`} Your turn.`;
  return outcome;
}
