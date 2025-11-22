### Example: evoke-ret

- **id**: evoke-ret
- **status**: ready
- **intent**: Show binding call-frame registers via `this` and returning via `ret` inside a ceremony.
- **type**: REPL
- **REPL input**:
  ```
  subj name add two be ceremony def
  subj name acc obj this obj be number ya
  obj num 2 to name acc be add do
  this obj name acc ret
  subj name add two be ceremony prah
  obj num 5 to name result be add two do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "add two" }
  → { "recorded": true }
  → { "recorded": true }
  → { "returned": "obj", "value": { "num": 7 } }
  → { "paragraphEnd": true }
  → { "invoked": "add two", "result": { "returned": "obj", "value": { "num": 7 } } }
  Memory: [
    { "subj": { "name": "add two" }, "be": "ceremony", "mood": "def" },
    { "subj": { "name": "acc" }, "obj": { "num": 5 }, "be": "number", "mood": "ya" },
    { "obj": { "num": 2 }, "to": { "name": "acc" }, "be": "add", "mood": "do" },
    { "mood": "ret", "ret": { "role": "obj", "name": "acc" } },
    { "subj": { "name": "add two" }, "be": "ceremony", "mood": "prah" },
    { "obj": { "num": 5 }, "to": { "name": "result" }, "be": "add two", "mood": "do" },
    { "subj": { "name": "result" }, "obj": { "num": 7 }, "be": "add two", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 7 }, "be": "add two", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 7 }, "be": "add two", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 7 }, "be": "add two", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 7 }, "be": "add two", "mood": "ya" }
  ]
  ```
- **Notes**: Memory shows the evoke (`be add two do`), local binding of `this obj` to `acc`, the `add` on `acc`, the `ret`, and the returned value applied to the caller’s target.
