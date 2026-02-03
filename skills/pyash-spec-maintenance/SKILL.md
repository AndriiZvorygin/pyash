---
name: pyash-spec-maintenance
description: "Update Pyash specifications and doc indexes; use when changing behavior or docs that require spec/index updates."
---

# Pyash Spec Maintenance

Use this skill when you change behavior that should be reflected in specs or indexes.

## Where to update

- Specs live in `documentation/specifications/`.
- Index files:
  - `documentation/specifications/00-index.md`
  - `documentation/specifications/14-index-map.md`
  - `documentation/doc_spec.md`

## Workflow

1. Update the relevant spec section with behavior changes.
2. Update index references if files move or split.
3. Add or refresh examples/tests referenced by the spec.
4. Keep terminology aligned with the implementation (moods, surface forms, token names).

## Common specs

- Refinery + re-entry: `documentation/specifications/10-pipelines.md`
- Translation: `documentation/specifications/11-translation.md`
- Run newspaper: `documentation/specifications/05-run-recording-and-artifacts.md`
