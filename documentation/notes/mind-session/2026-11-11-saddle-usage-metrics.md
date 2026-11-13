# Coding saddle usage metrics smoke

- **Run:** direct interactive saddle from an isolated runtime, with fixture variables unset; Spark-X2.6-4B through the configured GPU Housekeeper. Run id: `20261112T025514806Z-4048334-coding-saddle`.
- **Request/outcome:** asked for the exact response `USAGE_METRICS_SMOKE_OK`; the agent returned it. No project tools were called.
- **Metrics:** terminal displayed input `3,319`, cached `0`, output `12`, total `3,331`; context status identified the count as provider usage.
- **Durable evidence:** session `world/coding-saddle-projects/0243f83bf596554880d22f4e/house/project-coding-saddle/session/20261112-migration_usage_smoke_4.pya`; session turn `turn-000001-c258684a494a`, checkpoint hash `c258684a494ab2217bc1468a26adcecd6ff8b6ae9e0e9b910bda807d93a16495`; usage record id matches newspaper turn `21b0958d-60aa-4da2-b410-90dbd7f5e46a`.
- **Finding/fix:** Ollama places token counts at the response top level (`prompt_eval_count`, `prompt_eval_cached_count`, `eval_count`). Tool chat now forwards that envelope, the usage normalizer maps these keys, and the durable ledger falls back to the stable newspaper turn id when the session result has no id.
- **Newspaper:** run and turn identities plus provider request records are present in `world/coding-saddle-projects/0243f83bf596554880d22f4e/newspaper/20261112-0001-coding-saddle.pya`. The usage ledger parses with `pya_to_json`; converting the full coding-saddle newspaper currently errors on a quoted tool-audit sentence (`quoted.pyash`), so inspect its raw Pyash records for this run.
- **Lifecycle:** Ctrl+D exited cleanly and restored terminal mode. A populated legacy house was preserved as `house/coding saddle legacy 3`, leaving the project house active.
