/**
 * Wiring. Owns the one mutable game state, hands it to the view, and
 * re-renders after every move.
 *
 * The turn loop lives here: the player's click resolves at once, the
 * computer's reply is scheduled a beat later so the handoff is visible,
 * and the player is locked out in between. Every timer is tracked and
 * cancellable — a queued shot landing on a board that has been restarted
 * is exactly the bug New game would otherwise cause.
 */

import {
  ENEMY,
  PLAYER,
  PLAYING,
  cancelPickup,
  createGame,
  enemyFire,
  handlePlayerSquare,
  playerFire,
  scatterFleet,
  startGame,
} from './state.js';
import { render } from './view.js';

/** How long the computer appears to think, in milliseconds. */
export const AI_DELAY = 700;

export function mount(root, { rng, aiDelay = AI_DELAY, timers = globalThis } = {}) {
  let state = createGame({ rng });

  /** Outstanding timers, so none can fire after the game moves on. */
  const pending = new Set();

  function later(fn, delay) {
    const id = timers.setTimeout(() => {
      pending.delete(id);
      fn();
    }, delay);
    pending.add(id);
    return id;
  }

  function cancelTimers() {
    for (const id of pending) timers.clearTimeout(id);
    pending.clear();
  }

  const handlers = {
    onSquare(side, square) {
      if (side === PLAYER) {
        handlePlayerSquare(state, square);
        draw();
        return;
      }
      if (side === ENEMY) takeTurn(square);
    },
    onScatter() {
      scatterFleet(state);
      draw();
    },
    onStart() {
      startGame(state);
      draw();
    },
    onNewGame() {
      cancelTimers();
      state = createGame({ rng });
      draw();
    },
  };

  /**
   * One full round: the player's shot, then the computer's. A shot the
   * rules refuse returns null and costs nothing — no turn, no handoff.
   * A shot that sinks their last ship ends the game, so nothing is queued.
   */
  function takeTurn(square) {
    const outcome = playerFire(state, square);
    draw();
    if (!outcome || state.phase !== PLAYING) return;

    later(() => {
      enemyFire(state);
      draw();
    }, aiDelay);
  }

  function draw() {
    render(root, state, handlers);
  }

  /** Escape drops a pickup: a held ship goes back where it came from. */
  function onKeyDown(event) {
    if (event.key !== 'Escape' || !state.selected) return;
    event.preventDefault();
    cancelPickup(state);
    draw();
  }

  const doc = root.ownerDocument;
  doc.addEventListener('keydown', onKeyDown);

  draw();
  return {
    draw,
    cancelTimers,
    /** Detach from the document; nothing should outlive the interface. */
    destroy() {
      cancelTimers();
      doc.removeEventListener('keydown', onKeyDown);
    },
    get state() {
      return state;
    },
  };
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  mount(document.getElementById('app'));
}
