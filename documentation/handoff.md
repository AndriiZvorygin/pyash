# Fresh Codex Primer

## 1) Purpose
This primer orients a fresh Codex instance fast. For ongoing work planning and current priorities, open `documentation/roadmap.md`.

## 2) Quick start (5–10 minutes)
Run a minimal end‑to‑end demo: mind → tool call → run newspaper → artifact store.

Commands:
```bash
./run examples/pyash/mind-tool-call.pya --newspaper --run-id mind-tool-demo
```

Outputs:
- Run newspaper: `newspaper/mind-tool-demo.pya`
- Artifacts root: `artifacts/sha256/`

Confirm success:
```bash
rg "be tool ya" newspaper/mind-tool-demo.pya
```

Run a single quiz:
```bash
node --test quiz/run_newspaper_command.test.mjs
```

## 3) Canonical contracts (source of truth)
When docs disagree, these four specs win:
- `documentation/specifications/16-mind-and-tools.md` — tool calling adapter + schema rules.
- `documentation/specifications/16-mind-and-tools.md` — tool event records + request/response logging.
- `documentation/specifications/11-run-recording-and-artifacts.md` — run newspaper sentence forms + ordering.
- `documentation/specifications/11-run-recording-and-artifacts.md` — artifact sentence + content addressing.

## 4) Golden path (perennial)
1. Offer tool capabilities (`can`) in canonical order — `documentation/specifications/16-mind-and-tools.md#8-canonical-golden-path-example-normative`.
2. Emit tool request JSON (request record) — `documentation/specifications/16-mind-and-tools.md#4-canonical-golden-path-example-normative`.
3. Execute tool boundary (`do` → tool) — `documentation/specifications/16-mind-and-tools.md#7-adapter-ollama-native-tools-ollama-tools`.
4. Record tool result as `be tool ya` with `la … ko` — `documentation/specifications/16-mind-and-tools.md#3-rules-normative`.
5. Store artifact bytes via content addressing — `documentation/specifications/11-run-recording-and-artifacts.md#5-5-artifacts--newspaper-directory-contract-runner-policy`.
6. Emit artifact sentence with `to filename <locator>` — `documentation/specifications/11-run-recording-and-artifacts.md#4-1-minimum-required-fields`.
7. Preserve ordering in the run newspaper — `documentation/specifications/11-run-recording-and-artifacts.md#3-global-invariants-normative`.
8. Ensure replay determinism (again) — `documentation/specifications/11-run-recording-and-artifacts.md#10-replayable-mode-normative`.

## 5) File map (first files to open)
- `program/bridge/exchange.mjs`
- `program/verbs/exchange/compile.mjs`
- `program/verbs/exchange/compile/runtime_helpers.mjs`
- `program/verbs/exchange/compile/emit_mind.mjs`
- `program/verbs/exchange/compile/emit_command.mjs`
- `program/verbs/exchange/helpers_c.mjs`
- `program/library/grammar/keywords.mjs`
- `program/verbs/mind/mind.mjs`

## 6) Roadmap linkage
For what to do next, open `documentation/roadmap.md`.

Example milestone names (if present in roadmap):
- Tool envelope parity
- Exchange/artifact determinism
- Refinery retries/checkpoints

Note: `npm test` is pre-approved (see `AGENTS.md`).

## 7) Parity targets (perennial)
- JS runtime artifact recording behavior: `documentation/specifications/11-run-recording-and-artifacts.md#14-implementation-pointers`.
- Compiled JS helper behavior: `documentation/specifications/11-run-recording-and-artifacts.md#13-implementation-pointers`.
- Compiled C helper behavior: `documentation/specifications/11-run-recording-and-artifacts.md#13-implementation-pointers`.

## 8) Validation expectations (perennial)
- Newspaper line patterns include `be tool ya`, `be artifact ya`, `be run ya`.
- Artifact path pattern: `artifacts/sha256/<first2>/<next2>/<hex><ext>`.
- Ordering constraints are defined in `documentation/specifications/11-run-recording-and-artifacts.md#3-global-invariants-normative`.
