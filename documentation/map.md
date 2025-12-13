# Spec: `at all` Over Vectors in Pyash (Map + In-Place Foreach)

This version defines `at all` as element-wise application where:

* **with `to`**: produce a new vector (map)
* **without `to`**: update the original vector in place (foreach-style transform)
* Each element run exposes a zero-based index via `by` (as a register), accessible inside the body as `this by` without affecting signature dispatch.

---

## 1. Syntax

### 1.1 In-place transform (no `to`)

```pyash
be <verb> obj <vector-ref> [from …] [other roles…] at all do
```

Examples:

```pyash
be invert obj name vector at all do
be add    obj name vector from num 1 at all do
```

### 1.2 Map to a new vector (`to` present)

```pyash
be <verb> obj <vector-ref> [from …] [other roles…] to <target-ref> at all do
```

Examples:

```pyash
be invert obj name vector to name out at all do
be add    obj name vector from num 1 to name out at all do
```

---

## 2. Shared semantics

Given an invoking sentence `S` containing `at all`:

1. Resolve `S.obj` to a vector `V` (length `n`).
2. For each index `i` in `0..n-1`:

   * Deep-clone the entire sentence `S` into `E`.
   * Overwrite only:

     * `E.obj = V[i]` (in your standard value form)
   * Execute the normal handler for `be <verb>` on `E`. `E.by` is set to `{ num: i, register: true }` and is available as a `this by` register inside ceremonies; it is ignored for signature derivation.
   * The per-element result value is `E.obj` after execution.

No other role fields are special-cased; they come from cloning `S`.

---

## 3. Output semantics

### 3.1 If `to` is present (map)

* Collect each per-element result into a new vector `Out`.
* Write `Out` to `S.to`.

### 3.2 If `to` is absent (in-place update)

* Collect each per-element result into a new vector `Out`.
* Write `Out` back into the original `S.obj` target **only if** `S.obj` is assignable (name or genitive lvalue).
* If `S.obj` is a literal vector (non-assignable), it is a runtime error (or compile-time error if detectable).

This keeps implementation simple (always build `Out`) and avoids per-element mutation complexity.

---

## 4. JavaScript compilation templates

Assumptions:

* Vectors are JS arrays at runtime.
* `structuredClone` exists (fallback: JSON clone if sentences are JSON-safe).
* `resolveVector(objRef)` resolves `S.obj` to a JS array value.
* `writeTarget(ref, value)` can write to a name or genitive target.
* `execVerb(be, sentence)` runs the existing verb handler.

### 4.1 Common mapping core

```js
const base = structuredClone(sentence);
const v = resolveVector(base.obj);

const out = v.map((elem, i) => {
  const s = structuredClone(base);
  s.obj = elem;
  s.tloh = { num: i };
  execVerb(s.be, s);
  return s.obj;
});
```

### 4.2 `to` present (map)

```js
{
  const base = structuredClone(sentence);
  const v = resolveVector(base.obj);

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.obj = elem;
    s.tloh = { num: i };
    execVerb(s.be, s);
    return s.obj;
  });

  writeTarget(base.to, out);
}
```

### 4.3 `to` absent (in-place update)

```js
{
  const base = structuredClone(sentence);
  const v = resolveVector(base.obj);

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.obj = elem;
    s.tloh = { num: i };
    execVerb(s.be, s);
    return s.obj;
  });

  // write back into the same target used for obj (name or genitive)
  writeTarget(base.obj, out);
}
```

---

## 5. Worked examples

### 5.1 In-place: invert each element

Pyash:

```pyash
be invert obj name vector at all do
```

JS (explicit):

```js
{
  const base = structuredClone(sentence);
  const v = remember("vector");

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.obj = elem;
    s.tloh = { num: i };
    s.obj = invert(s.obj);        // or execVerb("invert", s)
    return s.obj;
  });

  store("vector", out);
}
```

### 5.2 Map: add 1 into `out`

Pyash:

```pyash
be add obj name vector from num 1 to name out at all do
```

JS (explicit):

```js
{
  const base = structuredClone(sentence);
  const v = remember("vector");

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.obj = elem;
    s.tloh = { num: i };
    s.obj = add(s.obj, 1);        // or execVerb("add", s)
    return s.obj;
  });

  store("out", out);
}
```

---

## 6. Errors and guards

* `obj` must resolve to a vector.
* In the `to`-absent form, `obj` must be an assignable target (name or genitive). Otherwise error.

This spec keeps the compiler implementation minimal: one map core, then “store to `to`” vs “store back to `obj`”.
