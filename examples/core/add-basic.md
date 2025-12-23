# Example: add-basic

- **id**: add-basic
- **status**: ready
- **intent**: Minimal addition via imperative `add` storing command and result in memory.
- **type**: REPL
- **REPL input**:
  ```
  su name collector ob num 7 be number ya
  ob num 2 to name collector be add do
  su name collector ob what que
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "collector" }
  → { "acted": "collector", "value": 9 }
  → "su name collector ob num 9 be number ya"
  Memory: [
    {
      "su": { "name": "collector" },
      "ob": { "num": 7 },
      "be": "number",
      "mood": "ya"
    },
    {
      "ob": { "num": 2 },
      "to": { "name": "collector" },
      "be": "add",
      "mood": "do"
    },
    {
      "su": { "name": "collector" },
      "be": "number",
      "ob": { "num": 9 },
      "mood": "ya"
    },
    {
      "su": { "name": "result" },
      "ob": { "num": 9 },
      "be": "add",
      "mood": "ya"
    }
  ]
  ```
- **Notes**: Mirrors the `add` coverage in `test/core.test.mjs`; shows command, updated target fact, and result fact.
