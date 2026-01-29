# `90-implementation-map.md`

Short map from spec contracts → implementation locations.

| Contract | Implementation pointers |
| --- | --- |
| Sentence model + parser | `program/understand/index.mjs` (`parse`), `program/library/sentenceSplitter.mjs` (`splitSentences`, `splitSentencesWithLines`) |
| Keywords (moods/cases/types/vyah) | `program/library/grammar/keywords.mjs` |
| Compositional cases | `program/library/compositionalCases.mjs`, `program/library/grammar/keywords.mjs` (`COMPOSITIONAL_KEYWORDS`) |
| Dispatch + signatures | `program/bridge/signature.mjs` (`deriveSignatureFromCall`, `makeSignatureWords`), `program/bridge/index.mjs` (`interpret`) |
| Errors + surfacing | `program/error.mjs` (`throwErrorSentence`, `surfaceErrorSentence`) |
| Ceremonies + this | `program/bridge/sandpit.mjs`, `program/library/thisBinding.mjs`, `program/verbs/ceremony/*.mjs` |
| Control flow (then/giant/equally/loops) | `program/bridge/conditions.mjs`, `program/bridge/imperative.mjs`, `program/bridge/sandpit.mjs` |
| Runtime primitives (duty/stream/chip) | `program/library/runtimePrimitives.mjs`, `program/bridge/index.mjs` |
| Run newspaper | `program/command/run_pya_program.mjs` (`pushNewspaper`, `emitToolEvent`), `program/command/run_with_newspaper.mjs` |
| Tool envelope (tool events) | `program/command/run_pya_program.mjs` (`emitToolEvent`), `program/verbs/exchange/compile/emit_mind.mjs`, `program/verbs/exchange/compile/emit_command.mjs`, `program/verbs/exchange/compile/emit_write.mjs` (tool event emits), `program/verbs/exchange/compile/c/helpers_c.mjs` (`pya_emit_exchange`) |
| Exchange + artifacts | `program/bridge/exchange.mjs` (`recordArtifact`, `recordExchange`), `program/verbs/exchange/read.mjs`, `program/verbs/exchange/write.mjs` |
| Mind (interpreter) | `program/verbs/mind/mind.mjs` (`mind_to_name_text`, `recordMindJson`, tool adapter) |
| Mind (compiled JS/C) | `program/verbs/exchange/compile/js/mind_runtime_helper.mjs` (mind runtime JS), `program/verbs/exchange/compile/c/helpers_c.mjs` (`MIND_RUNTIME_HELPER`) |
| Refinery | `program/bridge/refinery.mjs`, `program/command/run_pya_program.mjs` (refinery runner + newspaper), compiled: `program/verbs/exchange/compile.mjs` (emits helpers from `program/verbs/exchange/compile/js/runtime_helpers.mjs`) |
| Source maps | `program/verbs/exchange/compile.mjs` (JS/C sourcemap embedding) |
| Maps (plain/json/csv/yaml) | `program/bridge/maps.mjs`, `program/verbs/exchange/json.mjs`, `program/verbs/exchange/csv.mjs`, `program/verbs/exchange/yaml.mjs`, compiled: `program/verbs/exchange/compile/c/helpers_c.mjs` |
| Modules | `program/bridge/modules.mjs`, `program/verbs/exchange/compile.mjs` (closed-world include) |
| C IR | `program/verbs/exchange/compile/c/helpers_c.mjs`, `documentation/specifications/04-runtime-primitives.md` |
| Compiler (JS/C) | `program/verbs/exchange/compile.mjs` (`transpileProgram`) |
