# Battleship — bug report

Stella Nguyen · SDR challenge submission

[Play the game](https://stellakhueng.github.io/battleship/) · [GitHub repo](https://github.com/stellakhueng/battleship)

Built on the Devin platform, with Claude alongside it for reviewing changes and
checking its claims. Eight bugs, listed by the pull request they came from.

## How I looked for them

- Reviewing each pull request before merging, using Devin Review and Claude to read the changes
- Breaking the code on purpose to check the tests notice. When I suspected the fuzz test might be validating its own output, I deleted the no-touching rule and confirmed three tests failed
- Playing the deployed game myself

## PR #1 (rules layer)

### 1. Ships could be placed off the edge of the board

- Found by Devin Review, and separately by Claude reading the same change
- The fit check compared against a fixed width of 10 instead of the board's actual width, so on any smaller board ships hung off the edge
- The fuzz test missed it because all 2000 layouts used the default size
- Fixed to check the real width. Same mistake turned up in the square labels, so board sizes above 10 are now rejected

### 2. A function said it made a copy but didn't

- Found by Claude reading the change before I merged it
- `placeShip` was supposed to return a new board. It copied the outer object but left everything inside shared, so the new board and the old one used the same shot record. Firing at one changed both
- A test claimed to catch this, but it only checked the ship list, which was the one part that had been copied
- Fixed by having the function change the board directly instead of pretending to copy it. The test now checks the shot record too

## PR #2 (AI opponent)

### 3. The AI abandoned damaged ships to shoot open water

- Flagged by Devin during implementation, before it shipped
- The AI scores each square by how many ship positions could cover it, and multiplies that by 25 for positions that would explain an existing hit
- But a middle square can be covered by 34 positions, so plain water scored 34 and beat a chase square at 25
- Fixed by scaling the multiplier with how many hits a position explains. Getting it wrong costs about 3 shots a game across 300 seeded games

## PR #4 (interface: firing and the turn loop)

### 4. Couldn't tell when a ship was being held

- Found by playing the deployed game
- Clicking one of your own ships picks it up so you can move it, but nothing on the board changes to show that
- The banner above the boards did say "Destroyer picked up". While moving a ship you're looking at the grid, so it went unseen
- Fixed by highlighting that ship's row in the roster and changing the cursor over the grid. Escape now puts it back

### 5. Two different things drew the same amber box

- Found reviewing screenshots
- Keyboard focus used the same amber outline as the marker for the most recent shot
- Both were tested on their own and both were correct. The clash only showed up with them on screen at the same time
- Focus is now dashed teal outside the square, newest shot stays solid amber inside it

### 6. The game named the ship you'd hit before it sank

- Found by playing the deployed game
- One hit and the enemy roster showed which ship it was and how many squares it had left. You're only meant to learn that when it sinks
- Knowing you'd hit a Carrier meant knowing it ran five squares, which made the search much easier. It was also one-sided, since the AI only learns a ship's identity from sinking one
- The roster shows ship length and damage. That's fine for your own fleet, since you can already see your board. It got copied to the enemy side without asking what the player is allowed to know there
- Fixed so enemy ships read "afloat" until they sink. A test walks 20 games checking no unsunk enemy ship shows damage, and fails if the fix is reverted

## PR #7 (adversarial bug hunt)

The last pass was a batch of tests written to fail rather than to pass, aimed at
restart, turn timing, and anything clickable that shouldn't be. None of the fifteen
cases failed — those guards had been written into the spec before the code existed.
Going past the list found two.

### 7. Squares stayed clickable after a game was torn down

- Starting a new game tears down the old one, but every square kept its click handler
- A click on a dead board still fired a shot and queued a timer nothing could cancel
- Fixed by removing the handlers on teardown, with a test that clicks after teardown and asserts nothing happens

### 8. Keyboard focus fell off the page after every shot

- Firing at a square disables it, and a disabled square can't hold focus, so focus jumped back to the top of the page each turn
- Playing with the keyboard meant tabbing back down to the board after every shot
- Fixed by moving focus to the next live square. Reverting the fix brings it back

## Worth noting

- Two of these came from playing the game rather than from tests, and in both the code did exactly what it was told
- The bug hunt's fifteen cases all passed. The two bugs it did find were ones I hadn't thought to ask for
