# Debugging

- Inspect memory during REPL: `mem`
- Reset memory during REPL: `reset`
- Trace a program:
  - `node program/command/read_pya_trace.mjs path/to/file.pya`
  - Inspect `{ memory, sandpits }` for evoker/register values.
- If you hit `unknown verb/signature`, check:
  - The derived signature in the error sentence (`err.sentence.obj.text`).
  - The signature declared by the ceremony (`quiz/ceremony_signature_mismatch.test.mjs`).
