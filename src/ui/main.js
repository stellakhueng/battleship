/**
 * Wiring. Owns the one mutable game state, hands it to the view, and
 * re-renders after every move. Firing and the turn loop are not built
 * yet, so a click on the enemy grid does nothing for now.
 */

import { createGame, handlePlayerSquare, scatterFleet, startGame } from './state.js';
import { render } from './view.js';

export function mount(root, { rng } = {}) {
  let state = createGame({ rng });

  const handlers = {
    onSquare(side, square) {
      if (side !== 'player') return;
      handlePlayerSquare(state, square);
      draw();
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
      state = createGame({ rng });
      draw();
    },
  };

  function draw() {
    render(root, state, handlers);
  }

  draw();
  return {
    draw,
    get state() {
      return state;
    },
  };
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  mount(document.getElementById('app'));
}
