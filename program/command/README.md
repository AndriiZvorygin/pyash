# Commands

Utility scripts for working with Pyash from the shell:

- `run_pya_program.mjs [--full] [--gross] [--result] <path>` — run a `.pya` program, print Outputs/Result (or JSON with `--gross`). Use `--result` to print the final result sentence in non-`--full` mode.
- `read_pya_trace.mjs [--gross] <path>` — interpret a `.pya` file and show memory/sandpit traces (beautiful by default).
- `list_pyash_words.mjs` — print a comma-separated list of English entries from `pyashWords.json`.

Run with `node program/command/<file>.mjs ...`.
