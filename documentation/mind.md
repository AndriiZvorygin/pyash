````markdown
# mind.md — Pyash Mind Integration

This document defines how a **mind** (an LLM endpoint) is:

1. configured once as a participant,  
2. called from Pyash,  
3. and how its reply is represented back in Pyash,  

so Codex can implement the plumbing without guessing.

It assumes:

- the compositional case system is already implemented (`compositionalCases.md`),  
- `pyashWords.json` and `compositionalCases.mjs` exist and are wired up.

We’ll focus only on **how to use that system for the mind**.

---

## 0. Concepts

- A **mind** is an LLM endpoint plus configuration.
- Once configured, the mind is treated like a **person** in the conversation space.
- The heavy case stuff (`from space`, `via state`, `via discourse`) is used **once** when setting the mind up.
- Later turns only use **discourse / interior / time + mood**.

We use:

- `space` context for engine location (URL).
- `state` context for model name / mode.
- `discourse` context for text (system prompt, questions, answers).
- `interior` context for internal reasoning (`message.thinking`).
- `time` context for timestamps.
- Mood `ya` for “no further action required”.

---

## 1. Phase 1 — Configure the mind (done once)

We bind:

- engine URL (Ollama) → **from space**  
- model name        → **via state**  
- system prompt key → **via discourse**

### 1.1 Pyash

Example: register a mind bound to Ollama at localhost with `qwen3:8b` and a `pyash_orchestrator` system prompt.

```pyash
subj system
  be mind
    from space "http://localhost:11434"
    via  state "qwen3:8b"
    via  discourse "pyash_orchestrator"
  ya
````

Interpretation:

* `from space "http://localhost:11434"`
  → engine lives at that URL (SPACE context, source axis).
* `via state "qwen3:8b"`
  → this mind operates **via** that model state (STATE context, way axis).
* `via discourse "pyash_orchestrator"`
  → this mind acts according to that prompt (DISCOURSE context, way axis).
* `subj system … ya`
  → system performs this registration and no further action is needed from this clause.

After this is in history, the **mind is considered present** in the conversation and doesn’t need to be re-specified on each call unless you’re changing engine/model/prompt.


---

## 2. Phase 2 — Asking the mind a question

Once the mind is configured, we **do not** repeat `from space` / `via state` / `via discourse` on every call.

From here on, the mind is “already in the room” or in memory.

We only need to send it **discourse** (the user’s question).

### 2.1 Pyash

From the questioner’s perspective:

```pyash
subj questioner
  be say
    obj discourse "What trees should I plant in zone 5b?"
  do
```

This means:

* `subj questioner` → the human questioner is the subject of this communicative event.
* `be say` → perform a speech/ask act.
* `obj discourse "…"` → the actual text to send as the user message content.

The runtime, seeing this with a configured mind in scope, should:

1. Take the current mind config (engine URL, model, system prompt).

2. Call Ollama (or similar) with something equivalent to:

   ```bash
   curl http://localhost:11434/api/chat -d '{
     "model": "qwen3:8b",
     "stream": false,
     "messages": [
       { "role": "system", "content": "<resolved pyash_orchestrator prompt>" },
       { "role": "user",   "content": "What trees should I plant in zone 5b?" }
     ]
   }'
   ```

3. Wait for the reply JSON (see next section).

You *can* add routing like `to person mind` if your grammar supports it, but the key part for Codex is:

* `obj discourse` → goes to the user message content in the API call.

---

## 3. Phase 3 — Representing the mind’s reply

When Ollama replies, you get a JSON object like:

```json
{
  "model": "qwen3:8b",
  "created_at": "2025-11-21T16:15:08.043485835Z",
  "message": {
    "role": "assistant",
    "content": "Planting trees in USDA Hardiness Zone 5b ...",
    "thinking": "Okay, the user is asking about trees ..."
  },
  "done": true,
  "done_reason": "stop",
  "total_duration": 11259879809,
  "load_duration": 77352796,
  "prompt_eval_count": 36,
  "prompt_eval_duration": 29518930,
  "eval_count": 1227,
  "eval_duration": 10801446253
}
```

Only some fields get mapped into Pyash; the rest stay as runtime metadata.

### 3.1 Pyash reply clause

Your grammar for a completed “no further action” reply is:

```pyash
subj questioner
  be say
    obj discourse message.content
    obj interior  message.thinking
    via time      time
  ya
```

Where:

* `obj discourse message.content`
  → main visible answer text (maps from `message.content` in JSON).

* `obj interior message.thinking`
  → internal reasoning, chain-of-thought (maps from `message.thinking`).
  → *interior* marks it as inside the mind, not external speech.

* `via time time`
  → temporal tag from `created_at` (TIME context).
  → `time` is your chosen representation of that timestamp.

* `ya` (deontic mood)
  → “no further action required”: this is a completed response, not a command.

* `subj questioner`
  → still framed from the questioner’s side: this event is “the questioner receiving a say” with both visible discourse and interior content packaged.

### 3.2 What Codex should map

Given the JSON, Codex/runtime should:

* Bind:

  ```text
  message.content  → some local label / string for reply text
  message.thinking → some local label / string for interior text
  created_at       → some local label / string for time
  ```

* Fill the Pyash clause:

  ```pyash
  subj questioner
    be say
      obj discourse "<message.content>"
      obj interior  "<message.thinking>"
      via time      "<created_at or normalised time>"
    ya
  ```

* Keep everything else (`done`, durations, counts) as raw metadata attached to this event, not grammatically encoded.

---

## 4. Summary for Codex

**Phase 1 — Configure mind (one-time):**

```pyash
subj system
  be mind
    from space "http://localhost:11434"
    via  state "qwen3:8b"
    via  discourse "pyash_orchestrator"
  ya
```

* Use compositional cases to map:

  * `from space`   → engine URL.
  * `via state`    → model name.
  * `via discourse`→ system prompt key.

Store this in JSON; do not re-emit it every call.

---

**Phase 2 — Ask the mind:**

```pyash
subj questioner
  be say
    obj discourse "What trees should I plant in zone 5b?"
  do
```

* Map `obj discourse` → user message content sent to Ollama.

---

**Phase 3 — Represent the reply:**

```pyash
subj questioner
  be say
    obj discourse message.content
    obj interior  message.thinking
    via time      time
  ya
```

* `message.content`  ← JSON `message.content` (assistant’s answer).
* `message.thinking` ← JSON `message.thinking` (internal reasoning).
* `time`             ← JSON `created_at` (or normalised timestamp).
* `ya`               ← complete reply, no further action.

With these three stages, Codex has everything needed to:

* set up a mind once,
* route questions to it from Pyash,
* and fold the Ollama reply back into Pyash in a way that respects your grammar.

```
```
