## Purpose

Maintain and improve parity between `./run`, `./runjs`, and `./runc`.

## Cycle Contract

1. Run parity baseline.
2. Select candidate examples where `run` is green and JS/C is red.
3. Attempt bounded fixes.
4. Run `npm test` to guard regressions.
5. Re-run parity and compute deterministic delta.
6. Emit artifacts in house and notify Matrix.
