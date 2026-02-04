---
name: pyash-alias
description: "Add or update Pyash aliases (verbs or compositional tokens) and verify parser/behavior."
---

# Pyash Alias Maintenance

Use this skill when adding alias words like `add -> plus` or `tostate -> become`.

## Where aliases live

- Verb aliases: `program/library/verb_aliases.json`
  - Used by `program/library/verbAliases.mjs` and resolved during interpretation.
- Compositional token aliases: `program/library/grammar/keywords.mjs`
  - `COMPOSITIONAL_ALIASES` maps tokens (e.g. `tostate`) to canonical compositional keywords.
  - Aliases must also be treated as boundaries; update `ROLE_KEYS` to include alias keys.

## Workflow

1. Add the alias in the correct file:
   - verbs: `program/library/verb_aliases.json`
   - compositional/context: `program/library/grammar/keywords.mjs`
2. If compositional, ensure alias tokens are treated as boundaries (update `ROLE_KEYS`).
3. Add a small parser test in `quiz/` proving the alias maps to the canonical case.
4. If behavior changes affect specs, update the relevant spec file.

## Example (compositional alias)

- `tostate` → `become` in `COMPOSITIONAL_ALIASES`
- `ROLE_KEYS` includes alias tokens
- Test: `quiz/parse_tostate_alias.test.mjs`
