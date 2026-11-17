# Structured tool prompt trim

- **Run:** `node command/pyash_saddle.mjs`; run id `20261112T000744556Z-3924984-coding-saddle`; model `SparkLLM/Spark-X2.6-4B:q4_k_m` via GPU Housekeeper at `mriczo:18886`.
- **Turn:** first request used 3,325 prompt tokens, versus 4,394 in the comparable prior smoke (1,069 fewer, 24.3%).
- **Calls:** `terminal_start` ran `/usr/bin/printf` and exited 0; `terminal_read` returned `SPARKX_PTY_OK` and exit code 0.
- **Evidence:** `world/coding-saddle-projects/169f43eeadf72e6294c1398f/newspaper/20261112-0001-coding-saddle.pya`, tool events 000001–000002; session turn `turn-000001-d360112b6eef`, checkpoint hash `d360112b6eef505f11114ab8fd3b824dbee44818a99b33aeff191a0d1bb75848`.
- **Finding:** the provider request already carries structured function schemas, so repeating the tool list and descriptions in system text adds prompt tokens without adding capability information.
- **Next action:** retain one concise usage rule with structured schemas; keep textual tool descriptions only for callers that lack structured schemas.
