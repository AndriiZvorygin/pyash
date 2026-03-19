# 07. IO And Scripts

Purpose: define filesystem/process/network IO surfaces and script execution boundaries.

## 1. Verb keyword table

| Verb/family | Meaning | Application |
| --- | --- | --- |
| `be read` | ingest file/source into typed value | load text/map/json/etc. |
| `be write` | persist typed value | file output and exports |
| `be list` | directory listing | inspect workspace state |
| `be exists` | path existence check | guards before IO |
| `be command` | external command execution | shell/tool bridge |
| `be download` | fetch from URL/source | web/media retrieval |
| `be input` | declare runtime program interface ports | program input/output contract |
| interpret script | execute `.pya` program source | batch run mode |

## 2. Canonical sentence patterns

Read text file:
```pyash
from filename "note.txt" to name text out become text "text" be read do
```

Write text file:
```pyash
ob text "hello" to filename "note.txt" be write do
```

List directory:
```pyash
at filename "." be list do
```

Run command:
```pyash
la ob text "ls -la" to name text output be command do
```

Download web page:
```pyash
from filename "https://example.com" to filename "example.html" as wo web be download do
```

## 3. Determinism and safety

- sentence-shaped I/O only,
- explicit path/cwd semantics,
- no hidden mutations,
- command safety policy governed by `19-ops-safety.md`.

## 4. Agent cwd note

Agent runs may use task cwd while preserving policy-controlled access to agent house files.

## 5. Conformance

Implementation conforms when IO surfaces are deterministic, sentence-shaped, and policy bounded.

## 6. Full draft reference

`documentation/recipes/spec-archive/07-io-and-scripts.full.md`

## 7. Runtime Interface Declaration (`be input ya`)

### 7.1 Purpose

Programs may declare runtime-facing ports in source, so runner behavior is driven by sentence contracts (not ad hoc flags).

Canonical declaration:
```pyash
ob filename text manuscript to filename video short be input ya
```

Meaning:
- `ob ... manuscript` declares an input port handle `manuscript`.
- `to ... short` declares an output port handle `short`.
- `filename` is transport shape.
- `text` / `video` are content-kind tags for validation and tooling.

### 7.2 Port tuple form

Port tuple unit shape is:
`<transport-type> <content-type> <handle-name>`

Single-port declaration:
```pyash
ob filename text manuscript be input ya
```

Input+output declaration:
```pyash
ob filename text manuscript to filename video short be input ya
```

Multi-port form uses `ve` with repeated triples:
```pyash
ob ve filename text manuscript filename text outline
to ve filename video short filename text metadata
be input ya
```

### 7.3 Runner binding rules (normative)

Runner loads declarations before execution, then binds runtime values to declared handles.

Accepted runtime binding forms after `<program.pya>`:
1. Explicit sentence-shaped binding tail.
2. Single-argument shorthand for unambiguous single filename input.

Examples:
```bash
./run program.pya ob filename "know/input/topic.txt" to name manuscript
./run program.pya "know/input/topic.txt"
```

Shorthand is valid only when exactly one required input port exists and it is `filename`.

When a run finishes and one of its bound filename inputs resolves under `know/input/`, runner also mirrors the final runner result into `know/produce/` using the same relative stem and an appropriate extension for the output type.

Current generic runner behavior:
- final text result: mirror to `.txt`
- final filename result: mirror the primary file with its own extension
- final filename result with sidecars sharing the same basename (for example `final.metadata.txt`, `final.metadata.pya`, `final.srt`): mirror those companions too using the same produce stem
- if a mirrored target already exists, runner allocates one shared bundle suffix such as `-02`, `-03`, ... across the whole mirrored output set
- intermediate refinery files, manifests, checks, and other run artifacts stay under `artifacts/`; runner does not mirror them into `know/produce/`

Internal pipeline composition rule:
- when one refinery or command shells another `./run` invocation, the canonical machine result is `artifacts/<run id>/produce.txt`
- human-facing `stdout`/`stderr` chatter, including verbose mind traces, timing lines, and `produce file:` hints, is presentation only and MUST NOT be treated as the semantic transport channel between parent and child stages
- parent pipelines MAY mirror child verbose output live for observability, but they MUST read the child result from the artifact path keyed by the child run id
- when a child stage is part of a parent run, its child run id SHOULD nest under the parent run artifact tree (for example `artifacts/<parent-run-id>/learn-pipeline/<stage>/produce.txt`) rather than creating a sibling top-level run folder

Examples:
```bash
./run program.pya "know/input/topic.txt"
# writes artifacts/<run id>/produce.txt
# also writes know/produce/topic.txt

./run program.pya "know/input/history/solon.md"
# writes know/produce/history/solon.txt
# if that file already exists, runner allocates solon-02.txt, solon-03.txt, ...

./run video-program.pya "know/input/history/solon.txt"
# final result is build/final.mp4 with build/final.metadata.txt
# writes know/produce/history/solon.mp4
# writes know/produce/history/solon.metadata.txt
```

### 7.4 Validation and failures

Runner MUST fail fast when:
- required input ports are missing,
- provided bindings target undeclared handles,
- provided value transport shape does not match declared transport type,
- shorthand is ambiguous (more than one candidate input port).

### 7.5 Runtime memory materialization

Before executing program sentences, runner materializes bound ports as facts keyed by handle name.

For a filename binding:
- `su name <handle> ob filename "<path>" be filename ya`

Implementations may additionally materialize typed aliases for ergonomic lookup, but the canonical handle fact is required.

### 7.6 Determinism constraints

- Declarations in source are the single source of truth for accepted runtime ports.
- No hidden fallback to hardcoded file paths when a declared port exists.
- Same declarations + same bindings => same bound handle map at execution start.
