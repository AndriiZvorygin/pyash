### Example: toindex-loop

- **id**: toindex-loop
- **status**: ready
- **intent**: Loop climbs from a lower `fromindex` toward a higher `toindex`, stopping when they match, with registers kept on the evoker (no standalone register facts).
- **type**: REPL
- **REPL input**:
  ```
  subj name counter obj num 0 be number ya
subj name climb to name counter be ceremony def
obj num 1 to name counter be add do
subj name climb be ceremony prah
  to name counter fromindex num 1 toindex num 3 be climb do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "ya", "subj": { "name": "counter" }, "obj": { "num": 2 }, "be": "number" },
    { "mood": "def", "subj": { "name": "climb" }, "be": "ceremony" },
    { "mood": "do", "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add" },
    { "mood": "prah", "subj": { "name": "climb" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "counter" }, "fromindex": 3, "toindex": 3, "be": "climb", "obj": { "num": 2 } },
    { "subj": { "name": "counter" }, "obj": { "num": 2 }, "be": "climb", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 2 }, "be": "climb", "mood": "ya" }
  ]
  ```
- **Notes**: With `toindex > fromindex`, the supervisor increments `fromindex` each iteration instead of decrementing. Loop stops when `fromindex == toindex`. Registers stay on the evoker; no `fromindex`/`toindex` facts are emitted.
