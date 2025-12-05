### Example: tloh-loop

- **id**: tloh-loop
- **status**: ready
- **intent**: Loop using `tloh` to repeat a ceremony until `tloh` reaches a target (`until` or zero). Default shown: countdown to zero with registers kept on the evoker (no standalone register facts).
- **type**: REPL
- **REPL input**:
  ```
  subj name counter obj num 0 be number ya
subj name loop body to name counter be ceremony def
obj num 1 to name counter be add do
subj name loop body be ceremony prah
  to name counter tloh num 3 be loop body do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "ya", "subj": { "name": "counter" }, "obj": { "num": 3 }, "be": "number" },
    { "mood": "def", "subj": { "name": "loop body" }, "be": "ceremony" },
    { "mood": "do", "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add" },
    { "mood": "prah", "subj": { "name": "loop body" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "counter" }, "tloh": 0, "be": "loop body", "until": null, "obj": { "num": 3 } },
    { "subj": { "name": "counter" }, "obj": { "num": 3 }, "be": "loop body", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 3 }, "be": "loop body", "mood": "ya" }
  ]
  ```
- **Notes**: Shows default supervisor decrement of `tloh` when the body doesn’t set it; loop runs three times starting from `tloh 3`, counter ends at 3. Registers stay on the evoker; no `tloh` facts are emitted.
