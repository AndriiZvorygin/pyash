# Pyash Control Model: `fromindex` / `toindex`

Loops now use the sequence context instead of the old `tloh`/`until` registers.
`fromindex` seeds the current counter, `toindex` is an optional bound, and
`times` (via `quantity`/`by`) is available for simple countdowns. Registers
stay on the evoking sentence; no standalone loop facts are written.

## 1) Registers live on the evoking sentence

* The evoker (the `do` sentence that calls a ceremony) carries all control data.
* `fromindex`, `toindex`, and `atindex` are **fields on that sentence**, not
  standalone facts in memory.
* The parser treats them like other roles:
  * `fromindex num 1 toindex num 10 be worker do`
  * `fromindex num 5 be countdown do` (implicit decrement toward zero)
* No `subj fromindex ... ya` or `subj toindex ... ya` facts are written.

## 2) Supervisor defaults

When an evoker includes `fromindex`:

1. Seed `currentFrom` from `evoke.fromindex` (number or `{ num }`). Seed
   `currentTo` from `evoke.toindex` if present.
2. Run the ceremony body in a sandpit with `currentEvoke` (including
   `fromindex`/`toindex`) available as `this`.
3. After the body:
   * Pull the latest `fromindex` / `toindex` from the evoker (as mutated via
     `ya`/`ret`). If none were set, keep the previous values.
   * Terminate when `fromindex === toindex` (or `fromindex === 0` when
     `toindex` is absent).
   * Otherwise, advance `fromindex` one step toward `toindex` (decrement if
     `toindex` is absent, increment/decrement toward `toindex` if present) and
     loop.
4. Write back the final evoker (with its `fromindex`/`toindex`) to main memory,
   plus any target/result facts. No register facts are emitted.

## 3) How ceremonies interact

* To steer the loop, body sentences update the evoker via `this`:
  * `this fromindex num 0 ret` stops immediately.
  * `this fromindex num 1 ya` cancels the default decrement (net no change if
    the supervisor would subtract 1).
  * `this toindex num 10 ya` reshapes the goal mid-loop.
* `ret` merges into the evoker only; it does not create separate register facts.
* Body commands stay sandpit-local; only the merged evoker and result facts land
  in main memory.

## 4) Examples

* `examples/pyash/compile-loop.txt`: countdown loop with `fromindex`/`toindex`,
  no register facts.
* `examples/pyash/insertion-sort.pya`: nested loops with vector reads/writes
  (shared interpreter/JS/C).
* `quiz/loop.test.mjs` and `quiz/until.test.mjs` cover sequence registers and
  their defaults.
