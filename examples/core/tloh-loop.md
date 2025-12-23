### Example: fromindex-loop

- **id**: fromindex-loop
- **status**: ready
- **intent**: Loop using `fromindex` to repeat a ceremony toindex `fromindex` reaches a target (`toindex` or zero). Default shown: countdown to zero with registers kept on the evoker (no standalone register facts).
- **type**: REPL
- **REPL input**:
  ```
  su name counter ob num 0 be number ya
su name loop body to name counter be ceremony def
ob num 1 to name counter be add do
su name loop body be ceremony prah
  to name counter fromindex num 3 be loop body do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "ya", "su": { "name": "counter" }, "ob": { "num": 3 }, "be": "number" },
    { "mood": "def", "su": { "name": "loop body" }, "be": "ceremony" },
    { "mood": "do", "ob": { "num": 1 }, "to": { "name": "counter" }, "be": "add" },
    { "mood": "prah", "su": { "name": "loop body" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "counter" }, "fromindex": 0, "be": "loop body", "toindex": null, "ob": { "num": 3 } },
    { "su": { "name": "counter" }, "ob": { "num": 3 }, "be": "loop body", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 3 }, "be": "loop body", "mood": "ya" }
  ]
  ```
- **Notes**: Shows default supervisor decrement of `fromindex` when the body doesn’t set it; loop runs three times starting from `fromindex 3`, counter ends at 3. Registers stay on the evoker; no `fromindex` facts are emitted.
