# Example: add-basic

- **id**: add-basic
- **status**: ready
- **intent**: Minimal addition via imperative `add` storing command and result in memory.
- **type**: REPL
- **REPL input**:
  ```
  subj name collector obj num 7 be number ya
  obj num 2 to name collector be add do
  subj name collector obj what que
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "collector" }
  → { "acted": "collector", "value": 9 }
  → "subj name collector obj num 9 be number ya"
  Memory: [
    {
      "subj": { "name": "collector" },
      "obj": { "num": 7 },
      "be": "number",
      "mood": "ya"
    },
    {
      "obj": { "num": 2 },
      "to": { "name": "collector" },
      "be": "add",
      "mood": "do"
    },
    {
      "subj": { "name": "collector" },
      "be": "number",
      "obj": { "num": 9 },
      "mood": "ya"
    },
    {
      "subj": { "name": "result" },
      "obj": { "num": 9 },
      "be": "add",
      "mood": "ya"
    }
  ]
  ```
- **Notes**: Mirrors the `add` coverage in `test/core.test.mjs`; shows command, updated target fact, and result fact.
