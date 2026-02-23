## Purpose

Maintain and improve parity between `./run`, `./runjs`, and `./runc`.

## Cycle Contract

1. Run parity baseline.
2. Call Codex full-auto with the parity-gap skill workflow.
3. Select candidate examples where `run` is green and JS/C is red.
4. Attempt bounded fixes with targeted reruns only.
5. Emit artifacts in house and notify Matrix.
