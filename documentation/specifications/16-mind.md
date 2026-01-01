# `16-mind.md` (draft v0.1)

Define the **mind** verb as implemented today (interpreter + compiled JS). This spec
describes the current behavior and aligns with tests in `quiz/mind.test.mjs`.

---

## 1. Purpose

`be mind` invokes a language-model backend (Ollama in the interpreter) and returns a
text response. `be write ... to name <mind>` is an alias for calling that mind.

---

## 2. Registration (config) sentence

A mind is configured by storing a fact:

```
su name <mind> be mind
from space <host>
via state <model>
via discourse <prompt>
ya
```

Current interpreter behavior:

- `from space` is stored but not used for the HTTP host (the host is `OLLAMA_HOST`).
- `via state` (`as` in memory) stores the default model.
- `via discourse` (`accordingto` in memory) stores the system prompt.
- `by num` or `ob window num` sets the history window size.

Registration is a normal `ya` sentence and updates memory for `<mind>`.

---

## 3. Invocation (tool call)

Invocation uses `be mind` or `be write ... to name <mind>`:

```
su name <result> ob discourse <text> to name <mind> be mind do
```

Prompt resolution:

1. System prompt from the config sentence (`accordingto` / `via discourse`).
2. Call prompt from the invocation:
   - `with text`, or
   - `ob text`, or
   - `ob name` (if not used as `model`).
3. Recent history (see §4).
4. Any upstream `inputs` passed by the bridge.

Model resolution:

- explicit `ob model` if provided on the call
- otherwise the config model (`as`)
- otherwise default `qwen3-vl:8b-instruct`

---

## 4. History buckets

History is stored in memory‑local logs keyed by a bucket name:

Priority (first match wins):

1. `from text` on the call
2. `fromtext name` or `fromtext text` on the call
3. `from text` or `fromtext` on the config sentence
4. `<mind> story` (default)

The history window is `by num` / `ob window num` on the call, otherwise the config
window, otherwise `8`. Each window holds `window * 2` messages (user+assistant).

---

## 5. Result sentence

After a successful call:

```
su name <mind> be mind
ob text <response>
ob model <resolved-model>
ob historyWindow <window>
ya
```

The returned value from the handler is:

```
ob text <response> be text
```

Additionally, the user prompt is recorded as a `be write` to `<mind>` to preserve
the conversation in memory.

---

## 6. Tool event recording (newspaper)

When newspaper/again mode is enabled, mind invocations are recorded as **tool events**
per `15-tool-envelope.md` and `11-run-newspaper.md`:

```
su name tool event 000001
ob la <evoked sentence> ko
to la <surfaced result> ko
be tool ya
```

This only applies to `be mind` or `be write ... to name <mind>`.

---

## 7. Tool capabilities and model adapters

From Pyash, tool capabilities are always expressed as ordinary `can` sentences.
Models may require different tool‑calling envelopes, so the runtime adapts
the same Pyash `can` list based on the mind’s configured model (`via state`
on the mind initialization sentence).

Example tool capability map (per model family):

```
su name tools be map def
be say ob text become audio can
be hear ob text from state audio can
prah
```

Runtime behavior:

- The Pyash tool list remains stable and ordered; only the adapter changes.
- The adapter is chosen by the model configured on the mind (`via state <model>`).
- The adapter converts the Pyash `can` sentences into the model’s preferred
  tool-calling representation and passes them to the model backend.

Example invocation using a tool map:

```
be write ob text "say hello world out loud" to name qwenbot with name tools do
```

---

## 8. Errors

Backend failures surface as `be error ya` (per `06-errors.md`).

---

## 9. Current limitations

- Interpreter uses `OLLAMA_HOST` only; `from space` host is stored but ignored.
- Compiled C has no mind runtime.
