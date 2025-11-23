# Pyash Control Model: `tloh` and `until`

This documents the current, evoker-only register model for loops in Pyash.

## 1) Registers live on the evoking sentence

* The evoker (the `do` sentence that calls a ceremony) carries all control data.
* `tloh` (multiplicative register) and `until` (goal) are **fields on that sentence**, not standalone facts in memory.
* The parser treats `tloh` / `until` like other roles: `to name counter tloh num 3 be loop body do`.
* No `subj tloh ... ya` or `subj until ... ya` facts are written during invocation or return.

## 2) Supervisor defaults

When an evoker includes `tloh`:

1. Seed `currentTloh` from `evoke.tloh` (number or `{ num }`). Seed `currentUntil` from `evoke.until` if present.
2. Run the ceremony body in a sandpit with `currentEvoke` (including `tloh`/`until`) available as `this`.
3. After the body:
   * Pull the latest `tloh` / `until` from the evoker (as mutated via `ya`/`ret`). If none were set, keep the previous values.
   * Terminate when `tloh === until` (or `tloh === 0` when `until` is absent).
   * Otherwise, advance `tloh` one step toward `until` (decrement if no `until`, increment/decrement toward `until` if present) and loop.
4. Write back the final evoker (with its `tloh`/`until`) to main memory, plus any target/result facts. No register facts are emitted.

## 3) How ceremonies interact

* To steer the loop, body sentences update the evoker via `this`:
  * `this tloh num 0 ret` stops immediately.
  * `this tloh num 1 ya` cancels the default decrement (net no change if supervisor would subtract 1).
  * `this until num 10 ya` reshapes the goal mid-loop.
* `ret` merges into the evoker only; it does not create separate register facts.
* Body commands stay sandpit-local; only the merged evoker and result facts land in main memory.

## 4) Examples

* `examples/core/tloh-loop.md` / `examples/pyash/tloh-loop.pya`: countdown loop with `tloh` on the evoker, no register facts.
* `examples/core/until-loop.md` / `examples/pyash/until-loop.pya`: loop climbs toward `until`, registers remain on the invoke sentence.
* `examples/core/evoke-registers.md` / `examples/pyash/evoke-registers.pya`: returning from a ceremony preserves `tloh`/`until` on the evoker without emitting standalone register facts. ***!
