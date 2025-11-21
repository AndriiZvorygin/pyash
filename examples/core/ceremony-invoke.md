# Example: ceremony-invoke

- **id**: ceremony-invoke
- **status**: ready
- **intent**: Define a simple paragraph/ceremony with `def ... prah` and invoke it as a verb to update state.
- **type**: REPL
- **REPL input**:
  ```
  subj name result obj num 5 be number ya
  subj name add_two be ceremony def
  obj num 2 to name result be add do
  subj name add_two be ceremony prah
  to name result be add_two do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "result" }
  → { "stored": "add_two" }
  → { "recorded": true }
  → { "paragraphEnd": true }
  → { "invoked": "add_two", "result": { "acted": "result", "value": 7 } }
  Memory: [
    { "subj": { "name": "result" }, "obj": { "num": 5 }, "be": "number", "mood": "ya" },
    { "subj": { "name": "add_two" }, "be": "ceremony", "mood": "def" },
    { "obj": { "num": 2 }, "to": { "name": "result" }, "be": "add", "mood": "do" },
    { "subj": { "name": "add_two" }, "be": "ceremony", "mood": "prah" },
    { "obj": { "num": 2 }, "to": { "name": "result" }, "be": "add", "mood": "do" },
    { "subj": { "name": "result" }, "be": "number", "obj": { "num": 7 }, "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 7 }, "be": "add", "mood": "ya" },
    { "to": { "name": "result" }, "be": "add_two", "mood": "do" }
  ]
  ```
- **Notes**: Demonstrates definition indexing (`def`...`prah`) and invocation of the stored paragraph via `be add_two do`; memory shows recorded body, closing marker, and executed body on call.
