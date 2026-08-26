/**
 * Mutation harness: plays the same 300 seeded games with parts of the
 * strategy switched off, so the contribution of each can be measured.
 *
 *   node tools/ai-benchmark.js [games]
 */

import { benchmark } from './play.js';

const games = Number(process.argv[2] ?? 300);

const configurations = [
  ['full strategy', {}],
  ['no 25x damaged-ship weighting', { damagedShipWeight: 1 }],
  ['no adjacent-to-sunk exclusion', { excludeAdjacentToSunk: false }],
  ['neither', { damagedShipWeight: 1, excludeAdjacentToSunk: false }],
];

console.log(`${games} seeded games per configuration\n`);
console.log('configuration                        mean  median  best  worst');
for (const [label, opponentOptions] of configurations) {
  const { mean, median, best, worst } = benchmark({ games, opponentOptions });
  console.log(
    `${label.padEnd(34)}${mean.toFixed(1).padStart(6)}${String(median).padStart(8)}` +
      `${String(best).padStart(6)}${String(worst).padStart(7)}`,
  );
}
