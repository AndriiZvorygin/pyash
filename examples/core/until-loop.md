### Example: toindex-loop

- **id**: toindex-loop
- **status**: ready
- **intent**: Loop climbs from a lower `fromindex` toward a higher `toindex`, stopping when they match, with registers kept on the evoker (no standalone register facts).
- **type**: REPL
- **REPL input**:
  ```
  su name counter ob num 0 be number ya
su name climb to name counter be ceremony def
ob num 1 to name counter be plus do
su name climb be ceremony prah
  to name counter fromindex num 1 toindex num 3 be climb do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "ya", "su": { "name": "counter" }, "ob": { "num": 2 }, "be": "number" },
    { "mood": "def", "su": { "name": "climb" }, "be": "ceremony" },
    { "mood": "do", "ob": { "num": 1 }, "to": { "name": "counter" }, "be": "add" },
    { "mood": "prah", "su": { "name": "climb" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "counter" }, "fromindex": 3, "toindex": 3, "be": "climb", "ob": { "num": 2 } },
    { "su": { "name": "counter" }, "ob": { "num": 2 }, "be": "climb", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 2 }, "be": "climb", "mood": "ya" }
  ]
  ```
- **Notes**: With `toindex > fromindex`, the supervisor increments `fromindex` each iteration instead of decrementing. Loop stops when `fromindex == toindex`. Registers stay on the evoker; no `fromindex`/`toindex` facts are emitted.
