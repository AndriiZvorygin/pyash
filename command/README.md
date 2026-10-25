# Commands

Utility scripts for working with Pyash from the shell:

- `pyash.mjs [subcommand]` — top-level CLI wrapper:
  - `run <file.pya> [flags...]`
  - `<file.pya> [flags...]` (backward-compatible shorthand)
  - `repl`
  - `configure`
  - `configure intro`
  - `configure orchestrator`
  - `configure channel`
  - `configure channel list`
  - `configure channel matrix`
  - `configure channel matrix test`
  - `configure channel matrix doctor`
  - `configure mind`
  - `configure agent`
  - `calendar health|begin|stop|restart|list`
  - `channel poll`
  - `channel log`
- `run_pya_program.mjs [--full] [--gross] [--result] <path>` — run a `.pya` program, print Outputs/Result (or JSON with `--gross`). Use `--result` to print the final result sentence in non-`--full` mode.
- `read_pya_trace.mjs [--gross] <path>` — interpret a `.pya` file and show memory/sandpit traces (beautiful by default).
- `pya_to_json.mjs <path> [--memory-only] [--pretty]` — interpret a `.pya` file and print JSON (`memory`, `sandpits`, and `index` by `su name`).
- `list_pyash_words.mjs` — print a comma-separated list of English entries from `pyashWords.json`.
- `anchor_words_add.mjs --anchor <name> --form <text> --role <role>` — append a new anchor word mapping to `anchor_words.pya`.
- `vocab_suggest.mjs "word"` — check a proposed token/phrase; pass a file/dir to scan `.pya` files.
- `vocab_atom_suggest.mjs "concept"` — propose a non-overlapping lexical atom from weighted phonetic evidence.
- `vocab_grammar_suggest.mjs "concept"` — propose a non-overlapping trailing-underscore grammar word from the same evidence.
- `english30k_coverage.mjs [summary|covered|unresolved|candidates|pya]` — measure ranked Gutenberg English30k coverage against executable Pyash atoms, aliases, grammar mappings, and accepted compounds; `candidates` emits bounded compound candidates for the existing verifier.
- `english30k_coverage_verify.mjs [summary|pya] [mind] [output.pya]` — verify English30k compound candidates through the existing queued GPU/housekeeper mind path.
- `translate_document.mjs <language> <source.txt> <translation.pya> <catalog.pya> <pack.pyac>` — preserve sentence-level translation evidence, submit unresolved vocabulary through the existing future GPU mind queue, and lower resolved canonical Pyash sentences through the existing Pyac database path.
- `android_default_device.mjs [--yes] [--serial <id>] [--file <path>]` — detect attached ADB device(s) and set `su name android device id ...` in `configure/secret.pya` (prompts before writing).
- `codex_account.mjs <read|login|cancel|logout|rate-limits|models> ...` — Codex App Server account/auth helper for `openai-codex` setup.
- `work_supervisor.mjs [--world <path>] [--repository <path>]` — manage durable autonomous work items. Use `background --watch` for a live human-readable run view, `report <task-id>` to regenerate a completed task report, and `--email-report <address>` to submit that same report through the configured mail transport.
- `run_work_supervisor_smoke.mjs` — explicitly run the real Codex supervisor smoke against a temporary fixture repository; never part of `npm test`.
- `push_all.sh` — pushes the current clean branch to both the configured `origin` and the Pyash GitHub mirror.

Run with `node command/<file>.mjs ...`.
