# Battleship

Battleship against a computer opponent. Plain HTML, CSS and JavaScript. No framework, no build step.

**[Play it here](https://stellakhueng.github.io/battleship/)** · **[Bug report](./BUGS.md)**

## Rules

10x10 grid. Five ships: Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2.

Ships may not touch, not even at the corners. That is the Russian variant rather than the standard rules. It means sinking a ship also proves every square around it is empty, so there is something to work out.

Turns alternate. A hit does not earn another shot. First fleet sunk loses.

## How to play

Your fleet is placed for you when the page loads. Scatter it again, or click a ship to pick it up and move it. Escape puts it back.

Then click a square on the enemy grid to fire. You can also play with the keyboard alone.

## How it is built

Three parts, kept separate:

* `src/rules.js` is the game rules. No DOM, no shared state
* `src/ai.js` is the opponent. It never sees the board it is shooting at
* `src/ui/` is everything that draws or handles clicks

The opponent gets two functions, `nextShot()` and `record()`, and learns only from what it is told. The game holds the board and works out the shots itself, so nothing can hand the AI the board without rewriting that part.

Each turn it scores every square by how many positions the remaining ships could still sit in, and weights positions that would explain a hit it has already landed. It takes 38.6 shots on average to clear a board over 300 seeded games. Random firing takes about 95.

Every random number comes from a generator passed in as an argument, so a failing test replays the same way every time.

## Running it

```
python3 -m http.server 8123
```

Then open `http://localhost:8123`. It needs a server because browsers block module imports from a file.

## Tests

```
npm install
npm test
```

83 tests. The rules and AI run without a browser. The interface tests drive a real DOM through jsdom.

## Process

Built on the Devin platform across seven pull requests: rules, opponent, then the interface in three parts, then a round of testing aimed at breaking it. Claude was used alongside to read changes before merging and to check Devin's claims when they did not add up.

Eight bugs found and fixed. [BUGS.md](./BUGS.md) has them, including two that only turned up from playing the game.
