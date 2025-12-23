# Spec: `at all` Over Vectors in Pyash (Map + In-Place Foreach)

This version defines `at all` as element-wise application where:

* **with `to`**: produce a new vector (map)
* **without `to`**: update the original vector in place (foreach-style transform)
* Each element run exposes a zero-based index via `atindex` (as a register), accessible inside the body as `this atindex` without affecting signature dispatch.

---

## 1. Syntax

### 1.1 In-place transform (no `to`)

```pyash
be <verb> ob <vector-ref> [from …] [other roles…] at all do
```

Examples:

```pyash
be invert ob name vector at all do
be add    ob name vector from num 1 at all do
```

### 1.2 Map to a new vector (`to` present)

```pyash
be <verb> ob <vector-ref> [from …] [other roles…] to <target-ref> at all do
```

Examples:

```pyash
be invert ob name vector to name out at all do
be add    ob name vector from num 1 to name out at all do
```

---

## 2. Shared semantics

Given an invoking sentence `S` containing `at all`:

1. Resolve `S.ob` to a vector `V` (length `n`).
2. For each index `i` in `0..n-1`:

   * Deep-clone the entire sentence `S` into `E`.
   * Overwrite only:

     * `E.ob = V[i]` (in your standard value form)
   * Execute the normal handler for `be <verb>` on `E`. `E.atindex` is set to `{ num: i, register: true }` and is available as a `this atindex` register inside ceremonies; it is ignored for signature derivation.
   * The per-element result value is `E.ob` after execution.

No other role fields are special-cased; they come from cloning `S`.

---

## 3. Output semantics

### 3.1 If `to` is present (map)

* Collect each per-element result into a new vector `Out`.
* Write `Out` to `S.to`.

### 3.2 If `to` is absent (in-place update)

* Collect each per-element result into a new vector `Out`.
* Write `Out` back into the original `S.ob` target **only if** `S.ob` is assignable (name or genitive lvalue).
* If `S.ob` is a literal vector (non-assignable), it is a runtime error (or compile-time error if detectable).

This keeps implementation simple (always build `Out`) and avoids per-element mutation complexity.

---

## 4. JavaScript compilation templates

Assumptions:

* Vectors are JS arrays at runtime.
* `structuredClone` exists (fallback: JSON clone if sentences are JSON-safe).
* `resolveVector(objRef)` resolves `S.ob` to a JS array value.
* `writeTarget(ref, value)` can write to a name or genitive target.
* `execVerb(be, sentence)` runs the existing verb handler.

### 4.1 Common mapping core

```js
const base = structuredClone(sentence);
const v = resolveVector(base.ob);

const out = v.map((elem, i) => {
  const s = structuredClone(base);
  s.ob = elem;
  s.atindex = { num: i };
  execVerb(s.be, s);
  return s.ob;
});
```

### 4.2 `to` present (map)

```js
{
  const base = structuredClone(sentence);
  const v = resolveVector(base.ob);

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.ob = elem;
    s.atindex = { num: i };
    execVerb(s.be, s);
    return s.ob;
  });

  writeTarget(base.to, out);
}
```

### 4.3 `to` absent (in-place update)

```js
{
  const base = structuredClone(sentence);
  const v = resolveVector(base.ob);

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.ob = elem;
    s.atindex = { num: i };
    execVerb(s.be, s);
    return s.ob;
  });

  // write back into the same target used for ob (name or genitive)
  writeTarget(base.ob, out);
}
```

---

## 5. Worked examples

### 5.0 Vector fill (repeat literal)

When declaring a vector with a single element, `by num N` repeats that element `N` times.

```pyash
exists su name doors ob ve bool lie by num 100 be vector ya
exists su name zeros ob ve num 0 by num 10 be vector ya
```

### 5.1 In-place: invert each element

Pyash:

```pyash
be invert ob name vector at all do
```

Note: In compiled JS, inside ceremony bodies only, a bare `to name` that matches a local fact binding can be used as sugar for `to num of ob of <name>` (interpreter still treats bare `to <name>` as a memory name lookup).

JS (explicit):

```js
{
  const base = structuredClone(sentence);
  const v = remember("vector");

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.ob = elem;
    s.atindex = { num: i };
    s.ob = invert(s.ob);        // or execVerb("invert", s)
    return s.ob;
  });

  store("vector", out);
}
```

### 5.2 Map: add 1 into `out`

Pyash:

```pyash
be add ob name vector from num 1 to name out at all do
```

JS (explicit):

```js
{
  const base = structuredClone(sentence);
  const v = remember("vector");

  const out = v.map((elem, i) => {
    const s = structuredClone(base);
    s.ob = elem;
    s.atindex = { num: i };
    s.ob = add(s.ob, 1);        // or execVerb("add", s)
    return s.ob;
  });

  store("out", out);
}
```

### 5.3 Single element (imperative)

You can mutate a single vector slot without `at all` by combining `at num` with a vector reference:

```pyash
ob name vector from num 5 at num 1 be add do        # vector[1] += 5
ob num 3 from name vector at num 0 be subtract do   # vector[0] -= 3
```

Interpreter signatures recognize these shapes for `add` and `subtract` and update the vector in place. Indexes are 0-based (JS-style).

---

## 6. Errors and guards

* `ob` must resolve to a vector.
* In the `to`-absent form, `ob` must be an assignable target (name or genitive). Otherwise error.

This spec keeps the compiler implementation minimal: one map core, then “store to `to`” vs “store back to `ob`”.
