# Example: mind-config-call

- **id**: mind-config-call
- **status**: ready
- **intent**: Register a mind configuration (`be mind ya/def`) and invoke it via `be mind do`.
- **type**: REPL
- **REPL input**:
  ```
  su generator be mind from space "http://localhost:11434" via state "qwen3:8b" via discourse "orchestrator" ya
  su question ob discourse "Hello" to generator be mind do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "generator" }
  → { "acted": "generator", "value": { "text": "MODEL=qwen3:8b\nPROMPT=orchestrator\n\nHello", "model": "qwen3:8b" } }
  Memory: [
    {
      "su": { "name": "generator" },
      "be": "mind",
      "from": { "name": "http://localhost:11434" },
      "as": { "name": "qwen3:8b" },
      "accordingto": { "name": "orchestrator" },
      "mood": "ya"
    },
    {
      "su": { "name": "question" },
      "ob": { "discourse": "Hello" },
      "to": { "name": "generator" },
      "be": "mind",
      "mood": "do"
    },
    {
      "su": { "name": "generator" },
      "be": "mind",
      "ob": { "text": "MODEL=qwen3:8b\nPROMPT=orchestrator\n\nHello", "model": "qwen3:8b" },
      "mood": "ya"
    },
    {
      "su": { "name": "result" },
      "ob": { "text": "MODEL=qwen3:8b\nPROMPT=orchestrator\n\nHello", "model": "qwen3:8b" },
      "be": "mind",
      "mood": "ya"
    }
  ]
  ```
- **Notes**: Output text matches the stubbed `ollama.generate` used in tests; update if the stub changes.
