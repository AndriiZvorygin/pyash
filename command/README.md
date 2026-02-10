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
- `run_pya_program.mjs [--full] [--gross] [--result] <path>` — run a `.pya` program, print Outputs/Result (or JSON with `--gross`). Use `--result` to print the final result sentence in non-`--full` mode.
- `read_pya_trace.mjs [--gross] <path>` — interpret a `.pya` file and show memory/sandpit traces (beautiful by default).
- `list_pyash_words.mjs` — print a comma-separated list of English entries from `pyashWords.json`.
- `anchor_words_add.mjs --anchor <name> --form <text> --role <role>` — append a new anchor word mapping to `anchor_words.pya`.
- `vocab_suggest.mjs "word"` — check a proposed token/phrase; pass a file/dir to scan `.pya` files.

Run with `node command/<file>.mjs ...`.
