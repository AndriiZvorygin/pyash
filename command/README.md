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
- `clean_artifacts.mjs [--root <path>] [--apply]` — preview newspaper-pinned run/CAS cleanup; deletion is opt-in. Apply cleans independently verified artifact stores and preserves any store with malformed references or active runs.
- `list_pyash_words.mjs` — print a comma-separated list of English entries from `pyashWords.json`.
- `anchor_words_add.mjs --anchor <name> --form <text> --role <role>` — append a new anchor word mapping to `anchor_words.pya`.
- `vocab_suggest.mjs "word"` — check a proposed token/phrase; pass a file/dir to scan `.pya` files.
- `compound_catalog_add.mjs <name> <gloss> <atom> <atom> [atom ...]` — add a head-final compound built from existing atoms to `compound_coverage_curated.pya`; the gloss is used by dictionary and VLIW lookups. The last atom is the head, and the command checks atom membership, layer data, duplicate names, and sequence collisions.
- `pyash dict <pyash-word> to zh` — show the linked Chinese form, Hanyu Pinyin, and its English gloss or compound breakdown.
- `generate_kwon_chinese_pinyin_index.mjs` — refresh the compact Chinese Pinyin projection from the adjacent CC-CEDICT source, Kwon vocabulary, and accepted compounds.
- `generate_kwon_chinese_single_atom_csv.mjs` — export Kwon one-character, one-atom mappings with Mandarin Pinyin and Cantonese Jyutping from the local Unihan archive.
- `chinese_character_atom_refinery.mjs` — prepare frequency-ranked character-to-atom reviews, queue bounded ambiguity/translation/phonetic duties through GPU Housekeeper, and resume from local Pyash checkpoints.
- `vocab_atom_suggest.mjs "concept"` — propose a non-overlapping lexical atom from weighted phonetic evidence.
- `vocab_grammar_suggest.mjs "concept"` — propose a non-overlapping trailing-underscore grammar word from the same evidence.
- `english30k_coverage.mjs [summary|covered|unresolved|candidates|pya]` — measure ranked Gutenberg English30k coverage against executable Pyash atoms, aliases, grammar mappings, and accepted compounds; `candidates` emits bounded compound candidates for the existing verifier.
- `english30k_coverage_verify.mjs [summary|pya] [mind] [output.pya]` — verify English30k compound candidates through the existing queued GPU/housekeeper mind path.
- `translate_document.mjs <language> <source.txt> vliw` — run the source-to-VLIW refinery with one semantic destination and one `artifacts/<run-id>/` folder; `PYA_RUN_VERBOSE=1` prints stage/checkpoint progress. The explicit five-path form remains available for callers that bind artifact names themselves.
- `android_default_device.mjs [--yes] [--serial <id>] [--file <path>]` — detect attached ADB device(s) and set `su name android device id ...` in `configure/secret.pya` (prompts before writing).
- `codex_account.mjs <read|login|cancel|logout|rate-limits|models> ...` — Codex App Server account/auth helper for `openai-codex` setup.
- `work_supervisor.mjs [--world <path>] [--repository <path>]` — manage durable autonomous work items. Use `background --watch` for a live human-readable run view, `report <task-id>` to regenerate a completed task report, and `--email-report <address>` to submit that same report through the configured mail transport.

Background work uses the existing repository checkout under a single-writer lease. It refuses to claim work while that checkout has local changes. No per-task Git checkout is created; the configured automation branch is selected for background runs and the prior branch is restored when the checkout is clean.
- `run_work_supervisor_smoke.mjs` — explicitly run the real Codex supervisor smoke against a temporary fixture repository; never part of `npm test`.
- `push_all.sh` — pushes the current clean branch to both the configured `origin` and the Pyash GitHub mirror.

Run with `node command/<file>.mjs ...`.
