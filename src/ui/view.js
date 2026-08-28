/**
 * Rendering. Draws the whole game screen from a game state object and
 * knows nothing about how that state changes: every click is handed
 * straight back to the caller through `handlers`.
 *
 * The rules layer owns all game logic; this module only reads boards.
 */

import { BOARD_SIZE, FLEET, HIT, MISS, isShipSunk, shipAt, toLabel } from '../rules.js';
import { OVER, SETUP, canPlayerFire } from './state.js';

const COLUMNS = 'ABCDEFGHIJ';
const LOG_ROWS_VISIBLE = 6;

const PLAYER = 'player';
const ENEMY = 'enemy';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(doc, className) {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 100 100');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('class', className);
  return node;
}

/** A hit: two crossing strokes. Shape, not just colour. */
function crossMark(doc) {
  const node = svg(doc, 'mark mark-hit');
  for (const [x1, y1, x2, y2] of [[24, 24, 76, 76], [76, 24, 24, 76]]) {
    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    node.append(line);
  }
  return node;
}

/** A miss: a small filled disc. */
function missMark(doc) {
  const node = svg(doc, 'mark mark-miss');
  const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '50');
  circle.setAttribute('cy', '50');
  circle.setAttribute('r', '16');
  node.append(circle);
  return node;
}

/**
 * What one square looks like, from what this side is allowed to see.
 * Your own ships are always drawn; an enemy ship only once it is sunk.
 */
function squareView(board, square, { revealShips }) {
  const ship = shipAt(board, square);
  const sunk = ship ? isShipSunk(ship) : false;
  return {
    shot: board.shots.get(`${square.x},${square.y}`) ?? null,
    ship,
    sunk,
    hull: ship ? revealShips || sunk : false,
  };
}

/** "D5, hit, Cruiser sunk" — everything the square shows, in words. */
function squareLabel(view, square, { revealShips }) {
  const parts = [toLabel(square)];
  if (revealShips && view.ship) parts.push(view.ship.name);
  parts.push(view.shot === HIT ? 'hit' : view.shot === MISS ? 'miss' : 'unfired');
  if (view.sunk && view.ship) parts.push(`${view.ship.name} sunk`);
  return parts.join(', ');
}

/**
 * A ship is one bar across its squares, not a box per square: each end
 * square is rounded on its outer side only and the joins are square, so
 * the run reads as a single hull.
 */
function hullClasses(view, board, square) {
  if (!view.hull) return [];
  const { ship } = view;
  const horizontal = ship.cells.length > 1 && ship.cells[0].y === ship.cells[1].y;
  const index = ship.cells.findIndex((cell) => cell.x === square.x && cell.y === square.y);
  const classes = ['hull', horizontal ? 'hull-h' : 'hull-v'];
  if (index === 0) classes.push('hull-start');
  if (index === ship.cells.length - 1) classes.push('hull-end');
  if (view.sunk) classes.push('hull-sunk');
  return classes;
}

function buildGrid(doc, state, side, handlers) {
  const isPlayer = side === PLAYER;
  const board = isPlayer ? state.player : state.enemy;
  // Once it is over the enemy fleet is shown, so you can see where it all was.
  const revealShips = isPlayer || state.phase === OVER;
  const newest = state.lastShot[side];
  // Own ships move during setup only; the enemy grid opens up on your turn
  // and shuts again the moment your shot lands.
  const closed = isPlayer ? state.phase !== SETUP : !canPlayerFire(state);

  const grid = el(doc, 'div', 'grid');
  grid.dataset.side = side;
  if (state.selected && isPlayer) grid.classList.add('placing');

  grid.append(el(doc, 'div', 'ruler corner'));
  for (let x = 0; x < BOARD_SIZE; x += 1) grid.append(el(doc, 'div', 'ruler', COLUMNS[x]));

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    grid.append(el(doc, 'div', 'ruler', String(y + 1)));

    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const square = { x, y };
      const view = squareView(board, square, { revealShips });
      const button = el(doc, 'button', 'square');
      button.type = 'button';
      button.dataset.square = toLabel(square);
      button.dataset.x = String(x);
      button.dataset.y = String(y);
      // A square already fired at can never be acted on: disable it rather
      // than let a keyboard user tab through dead controls.
      const spent = !isPlayer && view.shot !== null;
      const disabled = closed || spent;
      button.disabled = disabled;
      button.setAttribute('aria-label', squareLabel(view, square, { revealShips }));

      button.classList.add(...hullClasses(view, board, square));
      if (view.sunk) button.classList.add('sunk');
      if (state.selected && isPlayer) button.classList.add('placing');
      if (newest && newest.x === x && newest.y === y) button.classList.add('newest');

      if (view.shot === HIT) button.append(crossMark(doc));
      if (view.shot === MISS) button.append(missMark(doc));

      if (!disabled && handlers?.onSquare) {
        button.addEventListener('click', () => handlers.onSquare(side, square));
      }

      grid.append(button);
    }
  }

  return grid;
}

function buildBoard(doc, state, side, handlers) {
  const isPlayer = side === PLAYER;
  const column = el(doc, 'section', 'board-column');

  const heading = el(doc, 'div', 'board-heading');
  heading.append(el(doc, 'h2', null, isPlayer ? 'Your fleet' : 'Enemy fleet'));
  const subtitle = isPlayer
    ? 'Their shots land here'
    : state.phase === OVER
      ? 'All ships shown'
      : 'Hidden until you hit it';
  heading.append(el(doc, 'p', 'subtitle', subtitle));
  column.append(heading);
  column.append(buildGrid(doc, state, side, handlers));

  return column;
}

function buildLegend(doc) {
  const legend = el(doc, 'ul', 'legend');
  const items = [
    ['hull hull-h hull-start hull-end', null, 'Your ship'],
    [null, crossMark, 'Hit'],
    [null, missMark, 'Miss'],
    ['hull hull-h hull-start hull-end hull-sunk sunk', null, 'Sunk'],
  ];

  for (const [className, mark, text] of items) {
    const item = el(doc, 'li', 'legend-item');
    const swatch = el(doc, 'span', ['legend-swatch', className].filter(Boolean).join(' '));
    if (mark) swatch.append(mark(doc));
    item.append(swatch, el(doc, 'span', 'legend-text', text));
    legend.append(item);
  }

  return legend;
}

/**
 * A roster row shows the ship's real length as blocks, so a player who
 * has never heard of a Cruiser can still see it is three squares long.
 *
 * Damage is only drawn for a fleet whose board you may see. You learn which
 * enemy ship you hit when it sinks, not before, so an enemy row stays intact
 * until then — otherwise the roster tells you what the grid deliberately does not.
 */
function buildRosterRow(doc, board, { name, size }, { held = false, damage = true } = {}) {
  const ship = board.ships.find((placed) => placed.name === name) ?? null;
  const sunk = ship ? isShipSunk(ship) : false;
  const hits = damage && ship ? ship.hits.size : 0;

  const classes = ['roster-row'];
  if (sunk) classes.push('is-sunk');
  // The banner is a long way from the grid, so say it here too.
  if (held) classes.push('is-held');

  const row = el(doc, 'li', classes.join(' '));
  row.dataset.ship = name;
  row.append(el(doc, 'span', 'roster-name', name));

  const blocks = el(doc, 'span', 'roster-blocks');
  for (let i = 0; i < size; i += 1) {
    const block = el(doc, 'span', i < hits || sunk ? 'roster-block is-hit' : 'roster-block');
    blocks.append(block);
  }
  row.append(blocks);

  const status = held ? 'IN HAND' : sunk ? 'SUNK' : damage ? `${size - hits} left` : 'afloat';
  row.append(el(doc, 'span', 'roster-status', status));
  return row;
}

function buildRoster(doc, board, { title, side, held = null, damage = true }) {
  const lost = board.ships.filter(isShipSunk).length;
  const column = el(doc, 'section', 'roster');
  column.dataset.side = side;

  const heading = el(doc, 'div', 'roster-heading');
  heading.append(el(doc, 'h3', null, title));
  heading.append(
    el(
      doc,
      'span',
      side === PLAYER ? 'roster-count is-bad' : 'roster-count is-good',
      `${lost} of ${FLEET.length} ${side === PLAYER ? 'lost' : 'sunk'}`,
    ),
  );
  column.append(heading);

  // Which enemy ships are damaged stays hidden; how many hits have landed does not.
  if (!damage) {
    const landed = board.ships.reduce((total, ship) => total + ship.hits.size, 0);
    column.append(el(doc, 'p', 'roster-hits', `${landed} hit${landed === 1 ? '' : 's'} landed`));
  }

  const list = el(doc, 'ul', 'roster-list');
  for (const ship of FLEET) list.append(buildRosterRow(doc, board, ship, { held: ship.name === held, damage }));
  column.append(list);

  return column;
}

/** Shots fired so far, per side: in this game the count is the score. */
function buildScoreboard(doc, state) {
  const scoreboard = el(doc, 'div', 'scoreboard');
  scoreboard.id = 'scoreboard';

  for (const [side, label] of [[PLAYER, 'Your shots'], [ENEMY, 'Their shots']]) {
    const item = el(doc, 'p', 'score');
    item.dataset.side = side;
    item.append(el(doc, 'span', 'score-label', label));
    item.append(el(doc, 'span', 'score-value', String(state.shots[side])));
    scoreboard.append(item);
  }

  return scoreboard;
}

/**
 * The result. The shot counts are the point of it: the computer averages
 * a little under 39, so the number says how well you did.
 */
function buildResult(doc, state) {
  const won = state.winner === PLAYER;
  const panel = el(doc, 'section', won ? 'result is-won' : 'result is-lost');
  panel.id = 'result';
  panel.setAttribute('role', 'status');
  panel.append(el(doc, 'h2', 'result-headline', won ? 'You won' : 'The computer won'));
  panel.append(
    el(
      doc,
      'p',
      'result-detail',
      won
        ? `You won in ${state.shots[PLAYER]} shots. Computer: ${state.shots[ENEMY]}.`
        : `The computer won in ${state.shots[ENEMY]} shots. You: ${state.shots[PLAYER]}.`,
    ),
  );
  return panel;
}

function resultBadge(doc, entry) {
  const text = entry.sunkShip ? `SANK ${entry.sunkShip.toUpperCase()}` : entry.result === HIT ? 'HIT' : 'MISS';
  const kind = entry.sunkShip ? 'is-sank' : entry.result === HIT ? 'is-hit' : 'is-miss';
  return el(doc, 'span', `badge ${kind}`, text);
}

/** A ruled table, newest first, so a shot can be found by scanning a column. */
function buildLog(doc, state) {
  const wrapper = el(doc, 'section', 'log');
  wrapper.append(el(doc, 'h3', 'log-heading', 'Shot log'));

  // Headings with nothing under them read as a broken table, so hold them back.
  if (state.log.length === 0) {
    wrapper.append(el(doc, 'p', 'log-empty', 'No shots yet'));
    return wrapper;
  }

  const table = el(doc, 'table', 'log-table');

  const head = el(doc, 'thead');
  const headRow = el(doc, 'tr');
  for (const heading of ['Turn', 'Who', 'Square', 'Result']) {
    headRow.append(el(doc, 'th', null, heading));
  }
  head.append(headRow);
  table.append(head);

  const body = el(doc, 'tbody');
  for (const entry of [...state.log].reverse()) {
    const row = el(doc, 'tr');
    row.append(el(doc, 'td', 'log-turn', String(entry.turn)));
    row.append(el(doc, 'td', entry.who === PLAYER ? 'log-who is-you' : 'log-who is-enemy', entry.who === PLAYER ? 'You' : 'Enemy'));
    row.append(el(doc, 'td', 'log-square', entry.square));

    const result = el(doc, 'td', 'log-result');
    result.append(resultBadge(doc, entry));
    row.append(result);

    body.append(row);
  }
  table.append(body);

  const scroller = el(doc, 'div', 'log-scroll');
  scroller.style.setProperty('--log-rows', String(LOG_ROWS_VISIBLE));
  scroller.append(table);
  wrapper.append(scroller);
  return wrapper;
}

/**
 * Only buttons that do something in this phase are drawn: a dead button
 * is worse than a missing one.
 */
function buildControls(doc, state, handlers) {
  const controls = el(doc, 'div', 'controls');

  const button = (id, label, onClick, extra) => {
    const node = el(doc, 'button', 'control', label);
    node.type = 'button';
    node.id = id;
    if (extra) Object.assign(node, extra);
    if (onClick) node.addEventListener('click', onClick);
    controls.append(node);
  };

  if (state.phase === SETUP) {
    button('scatter', 'Scatter my fleet', handlers?.onScatter);
    button('start', 'Start game', handlers?.onStart, { disabled: Boolean(state.selected) });
  } else {
    button('new-game', 'New game', handlers?.onNewGame);
  }

  return controls;
}

/**
 * Draw the whole screen into `root`, replacing whatever was there.
 * Keyboard focus is put back on the same square afterwards so scattering
 * does not throw a keyboard user back to the top of the page.
 */
export function render(root, state, handlers = {}) {
  const doc = root.ownerDocument;
  const focusedSquare = whereTheKeyboardIs(root, doc);

  root.replaceChildren();
  root.classList.add('app');

  root.append(el(doc, 'h1', 'title', 'Battleship'));

  const status = el(doc, 'p', 'status-banner', state.message);
  status.id = 'status';
  status.setAttribute('role', 'status');
  root.append(status);

  if (state.phase !== SETUP) root.append(buildScoreboard(doc, state));
  if (state.phase === OVER) root.append(buildResult(doc, state));

  const boards = el(doc, 'div', 'boards');
  boards.append(buildBoard(doc, state, PLAYER, handlers));
  boards.append(buildBoard(doc, state, ENEMY, handlers));
  root.append(boards);

  root.append(buildLegend(doc));

  const rosters = el(doc, 'div', 'rosters');
  rosters.append(
    buildRoster(doc, state.player, {
      title: 'YOUR SHIPS',
      side: PLAYER,
      held: state.selected?.name ?? null,
    }),
  );
  rosters.append(buildRoster(doc, state.enemy, { title: 'THEIR SHIPS', side: ENEMY, damage: false }));
  root.append(rosters);

  const bottom = el(doc, 'div', 'bottom');
  bottom.append(buildLog(doc, state));
  bottom.append(buildControls(doc, state, handlers));
  root.append(bottom);

  if (focusedSquare) restoreFocus(root, focusedSquare);

  return root;
}

const keyboardMemory = new WeakMap();

/**
 * Which square the keyboard is on, or was on before a redraw dropped it.
 * While the computer is thinking every enemy square is disabled, so the
 * browser hands focus back to the body; without remembering, a keyboard
 * player loses their place on every single shot.
 */
function whereTheKeyboardIs(root, doc) {
  const focused = doc.activeElement;
  if (focused?.dataset?.square) {
    const here = { side: focused.closest('.grid')?.dataset.side, square: focused.dataset.square };
    keyboardMemory.set(root, here);
    return here;
  }
  if (focused && focused !== doc.body && focused !== doc.documentElement) {
    keyboardMemory.delete(root);
    return null;
  }
  return keyboardMemory.get(root) ?? null;
}

/**
 * Put the keyboard back where it was. The square just fired at is disabled
 * afterwards, so falling back to the nearest live square on the same grid
 * is the difference between firing again and tabbing past a hundred
 * controls to get there.
 */
function restoreFocus(root, { side, square: label }) {
  const grid = root.querySelector(`.grid[data-side="${side}"]`);
  if (!grid) return;

  const all = [...grid.querySelectorAll('.square')];
  const at = all.findIndex((node) => node.dataset.square === label);
  if (at === -1) return;

  if (!all[at].disabled) {
    all[at].focus();
    return;
  }

  for (let step = 1; step < all.length; step += 1) {
    const near = [all[at + step], all[at - step]].find((node) => node && !node.disabled);
    if (near) {
      near.focus();
      return;
    }
  }
}
