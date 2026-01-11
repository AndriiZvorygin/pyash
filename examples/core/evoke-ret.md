### Example: evoke-ret

- **id**: evoke-ret
- **status**: ready
- **intent**: Show binding call-frame registers via `this` and returning via `ret` inside a ceremony.
- **type**: REPL
- **REPL input**:
  ```
su name plus two to name acc be ceremony def
su name acc ob this ob be number ya
ob num 2 to name acc be plus do
this ob name acc ret
su name plus two be ceremony prah
  ob num 5 to name result be plus two do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "plus two" }
  → { "recorded": true }
  → { "recorded": true }
  → { "returned": "ob", "value": { "num": 7 } }
  → { "paragraphEnd": true }
  → { "invoked": "plus two", "result": { "returned": "ob", "value": { "num": 7 } } }
  Memory: [
    { "su": { "name": "plus two" }, "be": "ceremony", "mood": "def" },
    { "su": { "name": "acc" }, "ob": { "num": 5 }, "be": "number", "mood": "ya" },
    { "ob": { "num": 2 }, "to": { "name": "acc" }, "be": "plus", "mood": "do" },
    { "mood": "ret", "ret": { "role": "ob", "name": "acc" } },
    { "su": { "name": "plus two" }, "be": "ceremony", "mood": "prah" },
    { "ob": { "num": 5 }, "to": { "name": "result" }, "be": "plus two", "mood": "do" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "plus two", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "plus two", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "plus two", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "plus two", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 7 }, "be": "plus two", "mood": "ya" }
  ]
  ```
- **Notes**: Memory shows the evoke (`be plus two do`), local binding of `this ob` to `acc`, the `plus` on `acc`, the `ret`, and the returned value applied to the caller’s target.
