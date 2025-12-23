### Example: evoke-ret

- **id**: evoke-ret
- **status**: ready
- **intent**: Show binding call-frame registers via `this` and returning via `ret` inside a ceremony.
- **type**: REPL
- **REPL input**:
  ```
su name add two to name acc be ceremony def
su name acc ob this ob be number ya
ob num 2 to name acc be add do
this ob name acc ret
su name add two be ceremony prah
  ob num 5 to name result be add two do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "add two" }
  → { "recorded": true }
  → { "recorded": true }
  → { "returned": "ob", "value": { "num": 7 } }
  → { "paragraphEnd": true }
  → { "invoked": "add two", "result": { "returned": "ob", "value": { "num": 7 } } }
  Memory: [
    { "su": { "name": "add two" }, "be": "ceremony", "mood": "def" },
    { "su": { "name": "acc" }, "ob": { "num": 5 }, "be": "number", "mood": "ya" },
    { "ob": { "num": 2 }, "to": { "name": "acc" }, "be": "add", "mood": "do" },
    { "mood": "ret", "ret": { "role": "ob", "name": "acc" } },
    { "su": { "name": "add two" }, "be": "ceremony", "mood": "prah" },
    { "ob": { "num": 5 }, "to": { "name": "result" }, "be": "add two", "mood": "do" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "add two", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "add two", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "add two", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "add two", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "add two", "mood": "ya" }
  ]
  ```
- **Notes**: Memory shows the evoke (`be add two do`), local binding of `this ob` to `acc`, the `add` on `acc`, the `ret`, and the returned value applied to the caller’s target.
