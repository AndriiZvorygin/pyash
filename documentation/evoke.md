---

## 1. Evoke sentence = call frame

An **evoke sentence** is how you call a ceremony:

```pyash
obj num 5 to name result be add two do
```

This *is* the call frame. Internally you treat it as:

```js
{
  mood: "do",
  be: "add two",       // ceremony being evoked (surface form, no underscore)
  obj: { num: 5 },
  to:  { name: "result" },
  // optional registers also live here: tloh, until, etc.
}
```

> Implementation note for JS:
> You can still map `"add two"` → `"add_two"` for module names (`verbs/add_two.mjs`), but that’s internal. On the Pyash side, it’s always `add two`.

---

## 2. `this` refers to the current evoke sentence

Inside the ceremony body for **add two**, `this` points at that evoke sentence:

* `this obj` → the `obj` register of the current evoke.
* `this to` → the `to` register.
* `this tloh` → loop/multiplicative register if present.
* etc.

You don’t use `what que` for computation; that’s just for REPL / inspection.

---

## 3. Reading a register into a variable (no `what que`)

To actually work with a value, you **bind** it into a named subject with `ya`.

Example: copy the evoke’s `obj` into a local variable `acc`:

```pyash
subj name acc obj this obj be number ya
```

Semantics:

* Read `this.obj` from the evoke sentence.
* Store a normal declarative fact like:

  ```pyash
  subj name acc obj num 5 be number ya
  ```

Now you can use existing verbs on `acc`:

```pyash
obj num 2 to name acc be add do
```

(Your JS `add` dispatcher can still live in `verbs/add.mjs` and resolve to `add_obj_num_to_num.mjs` etc; surface Pyash never sees underscores.)

---

## 4. Returning via `ret` into the evoke frame

When the ceremony is done, you **write back** into the evoke sentence using `ret`.

Example:

```pyash
this obj name acc ret
```

Meaning:

1. Resolve the latest fact about `name acc` from memory.

2. Take its payload (e.g. `{ num: 7 }`) and assign it into the evoke’s `obj` register:

   ```js
   evoke.obj = { num: 7 };
   ```

3. Mark the ceremony as finished; the **final evoke sentence** is the return value. Registers (e.g., `tloh`, `until`, `to`) travel on the evoke sentence; no extra register facts are required, and returning does not materialize standalone `tloh`/`until` facts.

So a complete ceremony flow for “add two” in Pyash surface form looks like:

```pyash
# evoke
obj num 5 to name result be add two do

# inside "add two" ceremony:

# bind argument into acc
subj name acc obj this obj be number ya

# acc := acc + 2
obj num 2 to name acc be add do

# return acc as new obj of the evoke
this obj name acc ret
```

From the outside, the modified evoke sentence now behaves like:

```pyash
obj num 7 to name result be add two do
```

---

## 5. Loops with `tloh` (multiplicative register)

Looping uses the same idea: `tloh` (and `until`, if present) live on the **evoke** as registers.

* Example evoke:

  ```pyash
  obj num 0 to name acc tloh num 10 be count up do
  ```

* Default supervisor behaviour:

  * Run the ceremony body.
  * If the ceremony didn’t explicitly change `this tloh`, move it **toward `until`**:
    * if `until` is set and greater than `tloh`, increment by 1
    * if `until` is set and less than `tloh`, decrement by 1
    * if `until` is absent, decrement toward 0
  * Stop when `tloh` equals `until` (or 0 when `until` is absent).

Inside the ceremony, you can control it with `this`:

```pyash
# explicit stop
this tloh num 0 ret
```

or fancier patterns like:

```pyash
# bump once so net effect is “no change” when supervisor subtracts 1
this tloh num 1 ya
```

Again, verb phrases stay space-separated, and registers stay attached to the evoke:

* `be count up do`
* `be add two do`
* `be subtract one do`

and your JS side is free to normalize them (e.g. `"count up"` → `count_up.mjs`) for file names.

---

If you’d like, next we can:

* Sketch how your `parser.mjs` should treat `be` + multi-word verb phrases (`be add two do`, `be count up do`) and
* Add tests to lock in that **surface Pyash never uses underscores**, while the dispatcher still finds the right JS verb modules.

## 6. Examples

See `examples/core/evoke-ret.md` and `examples/pyash/evoke-ret.pya` for a full ceremony that binds `this obj` into a local, mutates it, and returns via `ret`. Looping examples (`tloh-loop`, `until-loop`) show default supervisor behaviour with `tloh`/`until` kept on the evoke; `evoke-registers` shows registers surviving a return without leaking register facts.
