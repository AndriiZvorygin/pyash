# Source Maps (JS + C)

**File:** `12-source-maps.md`  
**Status:** v0.1  
**Intent:** Provide stable, single-file source maps for compiled JS and line mapping for compiled C.

---

## 1. Goals

- Single-file outputs (no external map files).
- Line-accurate mapping from emitted code back to Pyash lines.
- Deterministic output across interpreter and compiled backends.

---

## 2. JS source maps (inline)

### 2.1 Mapping rule

- Each emitted JS statement block corresponds to one Pyash sentence.
- The compiler records the Pyash line number for each emitted line group.
- The JS emitter produces an inline source map (base64 data URL).

### 2.2 Source name + content

- `sources[0]` is the Pyash filename (basename) when compiling from filename.
- Otherwise `sources[0]` is `"<pyash>"`.
- `sourcesContent[0]` is the original Pyash text when available.

### 2.3 Internal marker

Compilers may insert a sentinel comment to mark source lines before emitting the JS for a sentence:

```js
// @pyash-line 12
```

The source map builder removes these markers and uses them to build the line mapping.

---

## 3. C line mapping (`#line`)

### 3.1 Mapping rule

When compiling from filename, the C emitter inserts `#line` directives before emitted blocks:

```c
#line 12 "example.pya"
```

This ensures compiler diagnostics and debug tooling point back to the original Pyash line.

### 3.2 Source name

Use the Pyash filename (basename) as the `#line` file string.

---

## 4. Error reporting contract

- JS uses inline source maps for runtime stack traces and tooling.
- C uses `#line` for compiler errors and debug tools.
- No special runtime error shape changes are required; the mapping is a compile-time aid.

