# Pyash Interpreter Adapter Recipe

Purpose: expose a single interpreter entrypoint to LLM systems while preserving Pyash as the canonical API.

This recipe is intentionally explicit so models stop inventing ad-hoc JSON tool contracts.

## 1. Canonical stance

- Canonical input/output/error are Pyash sentences.
- JSON is optional transport only.
- Adapter must preserve exact sentence text.
- Never invent JSON-only semantics that do not map to Pyash cases.

## 2. Canonical interpreter request sentence

```pyash
su name run
ob text "<program text>"
at filename "<cwd>"
accordingto text "<run id>"
by num <timeout ms>
atmost num <max output bytes>
fromstate text "<profile>"
be interpret do
```

Required in practice:
- `ob text` (program body)

Recommended:
- `at filename` (cwd)
- `accordingto text` (run correlation)
- `by num` (timeout)
- `atmost num` (output cap)

Optional:
- `fromstate text` (execution profile label)

Runner-level options (not sentence cases):
- `again` / replay-verification mode

## 3. Canonical result/error surface

Success:
- return surfaced sentence(s) from runtime as-is.

Failure:
- return surfaced `be error ya` sentence as-is.

Error sentence contract is already defined in:
- `documentation/specifications/02-core-execution.md`

Do not replace sentence error with ad-hoc JSON error object.

## 4. JSON hallucination -> Pyash mapping (full)

### 4.1 Interpreter invocation

1. Program + cwd + timeout
Bad (JSON):
```json
{"program":"...","cwd":"/workplace","timeout":120000}
```
Use (Pyash):
```pyash
su name run ob text "..." at filename "/workplace" by num 120000 be interpret do
```

2. Run id
Bad (JSON):
```json
{"run_id":"20260213-planner-01"}
```
Use (Pyash):
```pyash
accordingto text "20260213-planner-01"
```

3. Output limit
Bad (JSON):
```json
{"max_output_bytes":262144}
```
Use (Pyash):
```pyash
atmost num 262144
```

4. Again mode
Bad (JSON):
```json
{"again":true}
```
Use (Pyash):
```pyash
# no in-sentence case; map to runner flag (for example: --again)
```

5. Profile label
Bad (JSON):
```json
{"profile":"agent-safe"}
```
Use (Pyash):
```pyash
fromstate text "agent-safe"
```

### 4.2 Success/error wrappers

1. Success envelope
Bad (JSON):
```json
{"ok":true,"result":"..."}
```
Use (Pyash):
```pyash
# surfaced result sentence is canonical; do not wrap
```

2. Error envelope
Bad (JSON):
```json
{"ok":false,"error":{"name":"unknown verb","message":"..."}}
```
Use (Pyash):
```pyash
su name unknown verb ob text "..." from name interpret be error ya
```

3. File/line context
Bad (JSON):
```json
{"file":"task.pya","line":12}
```
Use (Pyash):
```pyash
from filename "task.pya" by num 12
```

### 4.3 Common tool-API hallucinations

1. Read file
Bad (JSON):
```json
{"tool":"read","path":"notes.md"}
```
Use (Pyash):
```pyash
from filename "notes.md" to name text content become text "text" be read do
```

2. Write file
Bad (JSON):
```json
{"tool":"write","path":"notes.md","text":"hello"}
```
Use (Pyash):
```pyash
ob text "hello" to filename "notes.md" be write do
```

3. List files
Bad (JSON):
```json
{"tool":"list","path":"."}
```
Use (Pyash):
```pyash
at filename "." be list do
```

4. Exists check
Bad (JSON):
```json
{"tool":"exists","path":"notes.md"}
```
Use (Pyash):
```pyash
ob filename "notes.md" be exists do
```

5. Web search
Bad (JSON):
```json
{"tool":"search","query":"pyash"}
```
Use (Pyash):
```pyash
su name found ob text "pyash" fromstate wo web by num 5 be search do
```

6. Download
Bad (JSON):
```json
{"tool":"download","url":"https://example.com/a","to":"a.html"}
```
Use (Pyash):
```pyash
from filename "https://example.com/a" to filename "a.html" as wo web be download do
```

7. Command
Bad (JSON):
```json
{"tool":"command","cmd":"ls -la"}
```
Use (Pyash):
```pyash
la ob text "ls -la" to name text output be command do
```

8. Mind evoke
Bad (JSON):
```json
{"target":"helper","input":"task","tools":"saddle tools","output":"out"}
```
Use (Pyash):
```pyash
ob text "task" for name helper with name saddle tools to name text out be evoke do
```

9. Conduct-bound invoke
Bad (JSON):
```json
{"target":"helper","input":"task","conduct":"review loop configure"}
```
Use (Pyash):
```pyash
ob text "task" for name helper under name review loop configure to name text out be evoke do
```

10. Approval gate intent
Bad (JSON):
```json
{"approval_required":true}
```
Use (Pyash):
```pyash
# use propose mood in tool/call surfaces that require ratify
```

### 4.4 Planning/refinery hallucinations

1. Multi-stage plan object
Bad (JSON):
```json
{"stages":["plan","execute","verify"],"mode":"pipeline"}
```
Use (Pyash):
```pyash
su name planner loop be refinery def
su name plan stage ... ya
su name execute stage ... ya
su name verify stage ... ya
prah
```

2. Pipeline run call
Bad (JSON):
```json
{"run_refinery":"planner loop","input":"task"}
```
Use (Pyash):
```pyash
ob text "task" from name planner loop to name text output be refinery do
```

3. Retry policy blob
Bad (JSON):
```json
{"retry":{"max":3}}
```
Use (Pyash):
```pyash
# place retry/approval policy in conduct and runner policy, not ad-hoc json payload
```

## 5. Case-level mapping table (JSON key -> Pyash case)

Use this table when converting transport payloads.

- `program`, `input`, `text` -> `ob text "..."`
- `cwd`, `workdir` -> `at filename "..."`
- `run_id`, `trace_id`, `correlation_id` -> `accordingto text "..."`
- `timeout_ms`, `timeout` -> `by num <n>`
- `max_output_bytes` -> `atmost num <n>`
- `again`, `replay` -> runner option/flag (not a sentence case)
- `profile`, `mode` -> `fromstate text "..."`
- `path`, `filename` -> `from filename "..."` or `to filename "..."` depending direction
- `target` -> `for name <target>`
- `tools` -> `with name <tools map>`
- `conduct` -> `under name <conduct name>`
- `output` -> `to name text <name>` (or typed variant)

Direction rule:
- inbound/source location uses `from ...`
- outbound/destination location uses `to ...`

## 6. Adapter implementation algorithm

1. Validate input payload keys.
2. Build one canonical request sentence in official ordering.
3. Run interpreter.
4. Capture surfaced final sentence.
5. If surfaced sentence is `be error ya`, return failure with raw error sentence.
6. Optionally project convenience JSON fields by parsing sentence cases.
7. Always include raw request/result/error sentence strings.

Never:
- fabricate missing error fields,
- mutate error name/message,
- drop `at la ... ko` when present.

## 7. Planner-oriented LLM prompt for this adapter

Use this when instructing an LLM to emit program text:

```text
Return only valid .pya program text.
Do not return JSON.
Use small deterministic stages.
For multi-step tasks, define refinery stages: plan, execute, verify, summarize.
Use existing signatures only.
If runtime returns be error ya, repair the program and rerun.
```

## 8. References

- Error contract: `documentation/specifications/02-core-execution.md`
- Pipelines: `documentation/specifications/10-pipelines.md`
- Tool/MCP surface: `documentation/specifications/08-tools-and-mcp.md`
- Planning template: `documentation/recipes/refinery-planning-llm.md`
- Existing JSON-hallucination mapping pattern: `documentation/recipes/agent-operations.md`
