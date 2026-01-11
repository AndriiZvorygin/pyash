---

## 1. Evoke sentence = call frame

An **evoke sentence** is how you call a ceremony:

```pyash
ob num 5 to name result be plus two do
```

This *is* the call frame. Internally you treat it as:

```js
{
  mood: "do",
  be: "plus two",       // ceremony being evoked (surface form, no underscore)
  ob: { num: 5 },
  to:  { name: "result" },
  // optional registers also live here: fromindex, toindex, etc.
}
```

> Implementation note for JS:
> You can still map `"plus two"` → `"add_two"` for module names (`program/verbs/add_two.mjs`), but that’s internal. On the Pyash side, it’s always `plus two`.

---

## 2. `this` refers to the current evoke sentence

Inside the ceremony body for **plus two**, `this` points at that evoke sentence:

* `this ob` → the `ob` register of the current evoke.
* `this to` → the `to` register.
* `this fromindex` → loop/multiplicative register if present.
* etc.

You don’t use `what que` for computation; that’s just for REPL / inspection.

---

## 3. Reading a register into a variable (no `what que`)

To actually work with a value, you **bind** it into a named subject with `ya`.

Example: copy the evoke’s `ob` into a local variable `acc`:

```pyash
su name acc ob this ob be number ya
```

Semantics:

* Read `this.ob` from the evoke sentence.
* Store a normal declarative fact like:

  ```pyash
  su name acc ob num 5 be number ya
  ```

Now you can use existing verbs on `acc`:

```pyash
ob num 2 to name acc be plus do
```

(Your JS `plus` dispatcher can still live in `program/verbs/plus.mjs` and resolve to `add_obj_num_to_num.mjs` etc; surface Pyash never sees underscores.)

---

## 4. Returning via `ret` into the evoke frame

When the ceremony is done, you **write back** into the evoke sentence using `ret`.

Example:

```pyash
this ob name acc ret
```

Meaning:

1. Resolve the latest fact about `name acc` from memory.

2. Take its payload (e.g. `{ num: 7 }`) and assign it into the evoke’s `ob` register:

   ```js
   evoke.ob = { num: 7 };
   ```

3. Mark the ceremony as finished; the **final evoke sentence** is the return value. Registers (e.g., `fromindex`, `toindex`, `to`) travel on the evoke sentence; no extra register facts are required, and returning does not materialize standalone `fromindex`/`toindex` facts.

So a complete ceremony flow for “plus two” in Pyash surface form looks like:

```pyash
# evoke
ob num 5 to name result be plus two do

# inside "plus two" ceremony:

# bind argument into acc
su name acc ob this ob be number ya

# acc := acc + 2
ob num 2 to name acc be plus do

# return acc as new ob of the evoke
this ob name acc ret
```

From the outside, the modified evoke sentence now behaves like:

```pyash
ob num 7 to name result be plus two do
```

---

## 5. Loops with `fromindex` (multiplicative register)

Looping uses the same idea: `fromindex` (and `toindex`, if present) live on the **evoke** as registers.

* Example evoke:

  ```pyash
  ob num 0 to name acc fromindex num 10 be count up do
  ```

* Default supervisor behaviour:

  * Run the ceremony body.
  * If the ceremony didn’t explicitly change `this fromindex`, move it **toward `toindex`**:
    * if `toindex` is set and greater than `fromindex`, increment by 1
    * if `toindex` is set and less than `fromindex`, decrement by 1
    * if `toindex` is absent, decrement toward 0
  * Stop when `fromindex` equals `toindex` (or 0 when `toindex` is absent).

Inside the ceremony, you can control it with `this`:

```pyash
# explicit stop
this fromindex num 0 ret
```

or fancier patterns like:

```pyash
# bump once so net effect is “no change” when supervisor subtracts 1
this fromindex num 1 ya
```

Again, verb phrases stay space-separated, and registers stay attached to the evoke:

* `be count up do`
* `be plus two do`
* `be subtract one do`

and your JS side is free to normalize them (e.g. `"count up"` → `count_up.mjs`) for file names.

---

If you’d like, next we can:

* Sketch how your `program/understand/index.mjs` should treat `be` + multi-word verb phrases (`be plus two do`, `be count up do`) and
* Add quizzes to lock in that **surface Pyash never uses underscores**, while the dispatcher still finds the right JS verb modules.

## 6. Examples

See `examples/core/evoke-ret.md` and `examples/pyash/evoke-ret.pya` for a full ceremony that binds `this ob` into a local, mutates it, and returns via `ret`. Looping examples (`fromindex-loop`, `toindex-loop`) show default supervisor behaviour with `fromindex`/`toindex` kept on the evoke; `evoke-registers` shows registers surviving a return without leaking register facts. `this-registers` shows accessing `this fromindex` / `this toindex` inside a ceremony body.
