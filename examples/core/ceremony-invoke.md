# Example: ceremony-invoke

- **id**: ceremony-invoke
- **status**: ready
- **intent**: Define a simple paragraph/ceremony with `def ... prah` and invoke it as a verb to update state.
- **type**: REPL
- **REPL input**:
  ```
  su name result ob num 5 be number ya
su name add two to name result be ceremony def
ob num 2 to name result be plus do
su name add two be ceremony prah
  to name result be plus two do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "result" }
  → { "stored": "add two" }
  → { "recorded": true }
  → { "paragraphEnd": true }
  → { "invoked": "add two", "result": { "acted": "result", "value": 7 } }
  Memory: [
    { "su": { "name": "result" }, "ob": { "num": 5 }, "be": "number", "mood": "ya" },
    { "su": { "name": "add two" }, "be": "ceremony", "mood": "def" },
    { "ob": { "num": 2 }, "to": { "name": "result" }, "be": "add", "mood": "do" },
    { "su": { "name": "add two" }, "be": "ceremony", "mood": "prah" },
    { "ob": { "num": 2 }, "to": { "name": "result" }, "be": "add", "mood": "do" },
    { "su": { "name": "result" }, "be": "number", "ob": { "num": 7 }, "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "add", "mood": "ya" },
    { "to": { "name": "result" }, "be": "add two", "mood": "do" }
  ]
  ```
- **Notes**: Demonstrates definition indexing (`def`...`prah`) and invocation of the stored paragraph via `be plus two do`; memory shows recorded body, closing marker, and executed body on call.
