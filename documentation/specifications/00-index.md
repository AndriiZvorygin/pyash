# Specifications Index

Purpose: normative spec set for Pyash. This folder is intentionally compact: <=20 files, each <=16KB.

## Core order

1. `01-sentence-and-grammar.md` — sentence shape, cases, canonical emission.
2. `02-core-execution.md` — dispatch/signatures, ceremonies, execution semantics.
3. `03-vyah-and-aspect.md` — aspect/lifecycle vocabulary and recurrence normalization.
4. `04-runtime-primitives.md` — runtime primitive and IR boundary contracts.
5. `05-run-recording-and-artifacts.md` — newspaper/event/artifact replay requirements.
6. `06-data-formats.md` — canonical maps/series and JSON/CSV/YAML/INI contracts.

## Feature order

7. `07-io-and-scripts.md` — IO, command, download, script execution boundaries.
8. `08-tools-and-mcp.md` — mind tool envelope and MCP mapping.
9. `09-speech-and-hear.md` — speech/hear contracts and metadata.
10. `10-pipelines.md` — refinery/re-entry pipeline contracts.
11. `11-translation.md` — translation pipeline.
12. `11-modules.md` — module system and runner contract.
13. `12-web-and-browser.md` — web search + browser automation.
14. `15-world.md` — world layout and shared runtime surfaces.
15. `17-content-ingest.md` — ingest/chunk/abridge pipeline contract.
16. `18-pyash-agent.md` — agent loop, session, memory, scheduler, channels.
17. `19-ops-safety.md` — repair/command safety and coding harness requirements.
18. `23-configure.md` — configure routes and managed write contract.
19. `24-channel-contract.md` — channel/router input-produce-health contract.
20. `25-teaching-video.md` — teaching-video refinery pipeline contract.

## Reference docs (non-normative)

Moved out of `specifications/` to keep core spec compact:
- `documentation/reference/cheat-sheet.md`
- `documentation/reference/android-executive-lifecycle.md`
- `documentation/reference/spec-index-map.md`
- `documentation/reference/spec-implementation-map.md`
- `documentation/reference/instead-replacement.md`
- `documentation/reference/music-module.md`

Archived long-form drafts:
- `documentation/recipes/spec-archive/`

## Quick lookup

- unknown signature/dispatch issue -> `02-core-execution.md`
- case ordering/grammar issue -> `01-sentence-and-grammar.md`
- tool/MCP routing issue -> `08-tools-and-mcp.md`
- scheduler/agent/session/memory issue -> `18-pyash-agent.md`
- command approval/sandbox issue -> `19-ops-safety.md`
- channel routing issue -> `24-channel-contract.md`
- android orchestration lane and executive lifecycle issue -> `documentation/reference/android-executive-lifecycle.md`
