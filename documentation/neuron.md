Here’s a drop-in doc you can give to Codex.

````markdown
# neuron.md — Pyash neuron verb

This document tells you how to implement and reason about the **`neuron`** verb in Pyash.

A **neuron** in this slice is:

> one weighted sum of inputs plus a bias, passed through an activation function, producing a single scalar output.

It is built on top of the existing scalar RISC core plus the vector verb `produce` and an activation verb such as `twice crescent`.

---

## 0. Concepts

- **Inputs**  
  A numeric vector called `inputs`.

- **Weights**  
  A numeric vector called `weights`. Same length as `inputs`.

- **Bias**  
  A single scalar number called `bias`.

- **Activation**  
  A function that takes a scalar and squashes or reshapes it.  
  Default in this slice: `twice crescent`, a sigmoid-like curve mapping numbers into the 0–1 range.

- **Output**  
  A scalar number called `output`.

Semantically, the neuron computes:

1. `aggregation = weighted_sum(weights, inputs)`  
   using the `produce` verb (dot product).
2. `aggregation = aggregation + bias`  
   using the scalar `add` verb.
3. `output = activation(aggregation)`  
   default activation is `twice crescent`.

The implementation can be a JS verb today and later a compiled ceremony built from these primitives.

---

## 1. Pyash surface: evoking a neuron

The canonical Pyash call shape is:

```pyash
from      name weights     # weights vector (numeric)
by        name inputs      # input vector (numeric)
fromstate name bias        # bias scalar (numeric)
to        name output      # output subject
be        neuron
do
````

Cases:

* `from` (SOURCE + quantity) points at the **weights** subject.
* `by` (WAY + quantity) points at the **inputs** subject.
* `fromstate` (SOURCE + state) points at the **bias** subject.
* `to` (DESTINATION + space/state) names the **output** subject that should receive the result.

Requirements:

* `weights` and `inputs` must both be numeric vectors of the same length.
* `bias` must be a numeric scalar (`obj num`).
* `output` is any word-like subject; it will be bound to the result.

The neuron verb must:

1. Read the latest facts for `weights`, `inputs`, and `bias` from memory.
2. Compute the neuron output.
3. Store the result as a normal `ya` fact for `output` (and any `result` fact your bridge uses).

---

## 2. Internal behaviour (step-by-step)

Codex should treat `neuron` as sugar over three simpler operations.

Given an evoking sentence:

```js
{
  mood: "do",
  be: "neuron",
  from:      { name: "weights" },
  by:        { name: "inputs" },
  fromstate: { name: "bias" },
  to:        { name: "output" },
  // plus standard fields like subj if present
}
```

The neuron behaviour is:

1. **Weighted sum via `produce`**

   ```pyash
   from name weights
   by   name inputs
   to   name aggregation
   be   produce
   do
   ```

   Codex must ensure:

   * `weights` and `inputs` are vectors of equal length.
   * `aggregation` is a scalar number (`obj num`) equal to the dot product of those vectors.

   In JS pseudocode:

   ```js
   let total = 0;
   for (let i = 0; i < weights.length; i++) {
     total = total + weights[i] * inputs[i];
   }
   // aggregation.num = total
   ```

2. **Add bias with scalar `add`**

   ```pyash
   obj  num  from name aggregation
   from name bias
   to   name aggregation
   be   add
   do
   ```

   This updates `aggregation` to include the bias term:

   ```js
   aggregation.num = aggregation.num + bias.num;
   ```

3. **Apply activation (default: `twice crescent`)**

   ```pyash
   obj  num  from name aggregation
   to   name activated
   be   twice crescent
   do
   ```

   `twice crescent` is the activation verb. In JS it can be implemented as a standard sigmoid-like curve:

   ```js
   const z = aggregation.num;
   const y = 1 / (1 + Math.exp(-z));
   // activated.num = y
   ```

4. **Return via `ret` into the evoker’s `to` target**

   To hand the result back through the evoking sentence, use `this` and a proper `ret` sentence:

   ```pyash
   this obj num from name activated
   ret
   ```

   Codex must:

   * Look up the latest `activated` fact, read its `obj num`.
   * Merge that into the evoking sentence’s `obj` field.
   * Return a `ya` sentence for the `output` subject, according to your existing `ret` + bridge rules.

In summary, the neuron ceremony body is this paragraph:

```pyash
from name weights
by   name inputs
to   name aggregation
be   produce
do

obj  num  from name aggregation
from name bias
to   name aggregation
be   add
do

obj  num  from name aggregation
to   name activated
be   twice crescent
do

this obj num from name activated
ret
```

The external caller only ever writes the evoker:

```pyash
from      name weights
by        name inputs
fromstate name bias
to        name output
be        neuron
do
```

Codex can implement `neuron` directly in JS for now, while treating this paragraph as its semantic definition.

---

## 3. RISC status

For Codex:

* **Scalar RISC core** (irreducible):

  * `add`, `subtract`, `multiply`, `divide`, `negate`, `exponent`, comparisons (`giant`, `tiny`, `equally`)

* **Vector / ML macro-ops** (built from the scalar core, but treated as library-level primitives):

  * `produce` → dot product of two numeric vectors
  * `twice crescent` → sigmoid-like activation on a scalar

* **Neuron**:

  * A **ceremonial verb** built from `produce`, `add`, and `twice crescent`.
  * May be implemented as a JS verb now, and later compiled from its Pyash `prah` body.

Codex should preserve this layering: never fold neuron behaviour back into ad-hoc code elsewhere. Always treat `neuron` as a single, named unit that sits on top of the RISC and vector core.

---

## 4. Possible future extension: configurable activation

Future Codex versions may extend the evoker to carry an activation choice:

```pyash
from      name weights
by        name inputs
fromstate name bias
as        activation sigmoid      # or relu, tanh, gelu, etc.
to        name output
be        neuron
do
```

In that case:

* `as` (WAY + state) selects which activation verb to call.
* `neuron` will:

  * default to `twice crescent` when no activation is given,
  * otherwise dispatch to `sigmoid`, `relu`, `tanh`, `gelu`, or other activation verbs according to the `as activation` value.

This is optional and can be added later; the core behaviour above is the baseline Codex must support.

```
::contentReference[oaicite:0]{index=0}
```
