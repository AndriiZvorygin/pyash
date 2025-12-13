### Example: fromindex-loop

- **id**: fromindex-loop
- **status**: ready
- **intent**: Loop using `fromindex` to repeat a ceremony toindex `fromindex` reaches a target (`toindex` or zero). Default shown: countdown to zero with registers kept on the evoker (no standalone register facts).
- **type**: REPL
- **REPL input**:
  ```
  subj name counter obj num 0 be number ya
subj name loop body to name counter be ceremony def
obj num 1 to name counter be add do
subj name loop body be ceremony prah
  to name counter fromindex num 3 be loop body do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "ya", "subj": { "name": "counter" }, "obj": { "num": 3 }, "be": "number" },
    { "mood": "def", "subj": { "name": "loop body" }, "be": "ceremony" },
    { "mood": "do", "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add" },
    { "mood": "prah", "subj": { "name": "loop body" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "counter" }, "fromindex": 0, "be": "loop body", "toindex": null, "obj": { "num": 3 } },
    { "subj": { "name": "counter" }, "obj": { "num": 3 }, "be": "loop body", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 3 }, "be": "loop body", "mood": "ya" }
  ]
  ```
- **Notes**: Shows default supervisor decrement of `fromindex` when the body doesn’t set it; loop runs three times starting from `fromindex 3`, counter ends at 3. Registers stay on the evoker; no `fromindex` facts are emitted.
