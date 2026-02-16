---
name: pyash-add-modules
description: Add or update Pyash modules under `module/` and wire them into the repo. Use when creating new `.pya` modules, adding module variants (e.g., compile/read), or updating module wiring in `configure/default.pya`, tests, and specs/examples.
---

# Pyash Add Modules

## Overview

Add Pyash modules in `module/`, wire them into the default config, and verify behavior with quizzes and examples. Keep changes small, DRY, and aligned with Pyash vocabulary rules.

## Workflow

1. **Locate the existing module pattern**
- Scan `module/` for adjacent modules or variants (e.g., `read_*`, `compile_*`).
- Prefer composing existing modules or sharing helper pipelines.

2. **Author the new module**
- Create a `.pya` file under `module/` with a descriptive name.
- Use compositional roles (`fromtext`, `fromfilename`, `become`, `totext`, etc.).
- Keep modules concise and rely on existing verbs where possible.
- When resolving typed genitives in interpreter code, use `applyResolvedTypedValue` (from `program/bridge/imperative_helpers.mjs`) so genitive lvalues remain intact.
- For wrapper ceremonies that forward typed cases (especially `for name mind`), ensure `nameTypeWords` survives genitive resolution (for example `for name of for of this`). If `nameTypeWords` is lost, signature derivation may fall back to `num` and dispatch will fail.

3. **Wire the module into defaults**
- Import the module in `configure/default.pya`.
- Ensure naming and signatures match how the module will be invoked.

4. **Add or update quizzes**
- Add a quiz in `quiz/` mirroring real REPL usage.
- Include a happy path and at least one guard/edge path.
- Reset memory between cases.
- For wrapper modules that call `be write do`, include tests for both fixed-target and forwarded-target forms (for example: `for name mind ...` and `with wo tools`) to catch typed-case regressions.

5. **Update docs/examples when needed**
- Update `documentation/specifications/` if the new module affects language or pipelines.
- Update `examples/pyash/` only if requested or needed for coverage.

6. **Validate vocabulary**
- Run `node command/vocab_suggest.mjs "word"` for new Pyash tokens (verbs/names/signatures).
- Do not run this for quoted prompt text.

7. **Run tests**
- Prefer targeted tests first (`node --test quiz/<file>.test.mjs`).
- Run full suite (`npm test`) when behavior or wiring changes are broad.
