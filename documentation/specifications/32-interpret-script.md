# `32-interpret-script.md` (draft v0.2)

This document defines the `interpret` verb for running embedded scripts in a **sandboxed interpreter**.

## 1. Sentence shape

```
be interpret ob text quoted.javascript.<code>.javascript.quoted as wo javascript be do
```

Notes:

* `ob text` is required and MUST be a quoted block.
* `as wo javascript` is required in v0.2.
* The quoted block contains **raw JavaScript source text**, not JSON and not an expression fragment.

## 2. Behavior (interpreter)

### 2.1 Execution model

* The runtime executes the provided JavaScript source as a **script**, not as an expression.
* Execution occurs inside a **WebAssembly (WASM) sandbox** using:

  * a WASI-compatible JavaScript engine (QuickJS)
  * a WASM runtime (for example Wasmtime)

The interpreter host:

* writes the quoted JavaScript source into a temporary script file
* executes that file inside the WASM sandbox
* captures standard output and standard error

### 2.2 Filesystem sandbox

* The script is executed with **capability-based filesystem access**.
* By default, the sandbox is granted access to **one temporary directory only**.
* The script MAY read and write files inside that directory.
* The script MUST NOT have access to:

  * the host filesystem outside the sandbox directory
  * user home directories
  * configuration directories
  * secrets or credentials

This directory preopen model corresponds to WASI `--dir=<path>` semantics.

### 2.3 Time and resource limits

* Implementations SHOULD enforce:

  * a wall-clock execution limit (for example 0.5 s)
  * an upper bound on captured output size
* Termination due to limits MUST be reported as an error (see §4).

### 2.4 Input

* In v0.2, the JavaScript source is provided **only** via the quoted block.
* Standard input piping is not required and not assumed.
* Any required input files MUST be placed in the sandbox directory by the host prior to execution.

## 3. Output

* Standard output produced by the script is captured verbatim.
* No trimming, normalisation, or newline removal is required.

On success, the interpreter returns:

```
su name result ob text "<stdout>" be interpret ya
```

Notes:

* `<stdout>` MAY be empty.
* Output is treated as opaque text.

## 4. Errors

Any failure MUST return a deterministic error sentence:

```
su name interpret defective ob text "<reason>" from name interpret be error ya
```

Failures include, but are not limited to:

* JavaScript parse or runtime errors
* sandbox violations (for example filesystem access outside the allowed directory)
* execution timeout
* output size limit exceeded
* interpreter or WASM runtime failure

The `<reason>` string SHOULD be stable and human-readable.

## 5. Safety

* `interpret` executes **sandboxed code**, not arbitrary host code.
* The sandbox:

  * provides filesystem isolation via directory capabilities
  * provides execution isolation via WASM
  * provides no network access unless explicitly enabled by policy
* Runtimes MAY disable the verb entirely by policy.
* Runtimes MAY further restrict available capabilities (read-only directories, smaller limits).

## 6. Vendoring and reproducibility

Implementations SHOULD support vendoring:

* the WASM JavaScript runner (for example `qjs.wasm`)
* the WASM runtime binary (for example `wasmtime`)

To ensure reproducibility, runtimes SHOULD record:

* runner identity (hash of `qjs.wasm`)
* runtime version
* enforced limits

## 7. Future extensions (non-normative)

* Additional language runners via `as wo <language>` (for example `python`, `lua`).
* Reserved `as wo` values (for example `lua`, `python.micro`) MUST return a deterministic error until implemented.
* Structured input via `from text` or `from name`.
* Structured output via official JSON objects.
* Multiple preopened directories with explicit naming.
* Deterministic PRNG seeding for replay.

---

### Summary of what changed from v0.1

* Removed the claim that `interpret` executes arbitrary host code.
* Defined WASM + QuickJS as the **reference execution model**.
* Formalised the directory-based sandbox.
* Clarified why stdin piping is not required.
* Added vendoring and reproducibility guidance.
