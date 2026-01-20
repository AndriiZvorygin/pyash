## Spec: Add `--prompt` support to `examples/stream/stream.cpp` in `caterer/whisper.cpp`

### Goal

Enable an “initial prompt” string that biases decoding for the streaming microphone example (your `whisper-stream` binary behaviour), using whisper.cpp’s `whisper_full_params.initial_prompt`, and optionally support carrying the prompt across streaming chunks.

### Non-goals

* No changes to model files, VAD logic, diarization, audio capture, or tokenization.
* No changes to `src/whisper.cpp` or library API.
* No changes to other examples (`cli`, `server`, `command`) unless required for tests.

---

## Background

`examples/stream/stream.cpp` currently parses CLI flags such as `--vad-thold`, `--keep-context`, `--flash-attn`, and builds a `whisper_full_params` instance (`wparams`) used for decoding each audio window. The library already supports an initial prompt via:

* `whisper_full_params::initial_prompt` (const char*)
* `whisper_full_params::carry_initial_prompt` (bool)

Implementation requires:

1. parsing new CLI args into a `std::string prompt`
2. setting `wparams.initial_prompt = prompt.c_str()` at the point where `wparams` is configured
3. optionally setting `wparams.carry_initial_prompt` based on new flag(s)

---

## Requirements

### R1. New CLI flags

Add to `examples/stream/stream.cpp`:

* `-p TEXT`, `--prompt TEXT`
  Sets an initial prompt string for decoding.

* `-cp`, `--carry-prompt`
  If provided, keep the initial prompt active across chunks by setting `wparams.carry_initial_prompt = true`.

Optional coupling behaviour (choose one, implement as written below):

* Default: `carry_initial_prompt = false`
* If `--carry-prompt` passed: `true`

No other behavioural changes.

### R2. Help output

Update `print_usage(...)` (or equivalent) in `examples/stream/stream.cpp` to include the new flags with aligned formatting consistent with existing help entries.

### R3. Lifetime safety

`wparams.initial_prompt` must point to memory that remains valid during decoding. Use a `std::string prompt;` declared in `main` scope (or higher) so `prompt.c_str()` remains valid for the program lifetime.

### R4. Behaviour matrix

* No `--prompt`: behaviour identical to current.
* `--prompt "..."`: prompt is applied to decoding; no forced carrying across chunks.
* `--prompt "..." --carry-prompt`: prompt is applied and carried across chunks.

### R5. Build

The change must compile with the existing build system (CMake in `build/`) and produce the `stream` binary (or the existing target that builds `examples/stream/stream.cpp`).

---

## Implementation details

### File

* Modify: `examples/stream/stream.cpp`

### Data additions

Add near other CLI variables:

```cpp
std::string prompt;
bool carry_prompt = false;
```

### Arg parsing

In the existing `for (int i = 1; i < argc; ++i)` loop (or equivalent), plus:

```cpp
else if (arg == "-p" || arg == "--prompt") {
    if (i + 1 >= argc) {
        fprintf(stderr, "error: --prompt requires an argument\n");
        return 1;
    }
    prompt = argv[++i];
}
else if (arg == "-cp" || arg == "--carry-prompt") {
    carry_prompt = true;
}
```

### Wiring into `wparams`

Locate where `whisper_full_params wparams` is created and configured (the same region that sets `wparams.tdrz_enable = params.tinydiarize;`).

Add:

```cpp
if (!prompt.empty()) {
    wparams.initial_prompt = prompt.c_str();
    wparams.carry_initial_prompt = carry_prompt;
}
```

If `prompt` is empty, do not set either field (leave defaults).

### Usage text

Add lines similar to:

```cpp
fprintf(stderr, "  -p TEXT,   --prompt TEXT     [       ] initial prompt to bias decoding\n");
fprintf(stderr, "  -cp,       --carry-prompt    [false  ] keep the initial prompt across chunks\n");
```

---

## Testing plan

### T1. Unit-style “help includes flags”

Command:

```bash
cd ~/pyac/pyash/caterer/whisper.cpp/build
./bin/stream -h | rg -n "prompt|carry-prompt"
```

Expected:

* help output includes `--prompt` and `--carry-prompt`

### T2. Smoke test: runs with prompt without crashing

Command:

```bash
./bin/stream -c 0 -m /path/to/ggml-base.bin --prompt "LiberIT ERPNext Pyash"
```

Expected:

* program starts normally, captures audio, prints transcriptions

### T3. Smoke test: missing prompt arg errors cleanly

Command:

```bash
./bin/stream --prompt
echo $?
```

Expected:

* prints “requires an argument”
* exits with non-zero status

### T4. Behavioural sanity: prompt carry flag toggles field

Add a minimal debug log gated behind an env var, so tests can observe it without changing normal output:

Implementation:

* If `getenv("WHISPER_STREAM_DEBUG") != nullptr`, print:

  * whether prompt is set
  * whether carry is set

Example debug line:

```cpp
if (getenv("WHISPER_STREAM_DEBUG")) {
    fprintf(stderr, "debug: prompt=%s carry=%s\n",
            prompt.empty() ? "empty" : "set",
            carry_prompt ? "true" : "false");
}
```

Test commands:

```bash
WHISPER_STREAM_DEBUG=1 ./bin/stream -c 0 -m /path/to/ggml-base.bin --prompt "abc" 2>&1 | rg "prompt=set"
WHISPER_STREAM_DEBUG=1 ./bin/stream -c 0 -m /path/to/ggml-base.bin --prompt "abc" --carry-prompt 2>&1 | rg "carry=true"
```

Expected:

* first shows `prompt=set carry=false`
* second shows `prompt=set carry=true`

### T5. Build regression

Command:

```bash
cmake --build . -j
```

Expected:

* clean build, no new warnings treated as errors.

---

## Acceptance criteria

* `stream -h` shows the new flags.
* Running with `--prompt` does not crash and continues streaming.
* Missing prompt argument exits with error.
* With debug env var, carry behaviour is observable.
* No changes to default output or behaviour when `--prompt` is unused.

---

## Notes for Codex

* Keep changes minimal and local to `examples/stream/stream.cpp`.
* Do not introduce new dependencies.
* Ensure prompt storage lifetime is correct (`std::string` in main scope).
* Match existing CLI parsing style and help formatting in that file.
