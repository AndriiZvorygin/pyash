### Example: evoke-registers

- **id**: evoke-registers
- **status**: ready
- **intent**: A ceremony returns via `ret` while keeping `fromindex`/`toindex` on the evoker; no standalone register facts are emitted.
- **type**: REPL
- **REPL input**:
  ```
subj name worker to name target be ceremony def
obj num 4 to name target be add do
this obj name target ret
subj name worker be ceremony prah
  subj name target obj num 1 fromindex num 3 toindex num 5 be number ya
  to name target be worker do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "def", "subj": { "name": "worker" }, "be": "ceremony" },
    { "mood": "do", "obj": { "num": 4 }, "to": { "name": "target" }, "be": "add" },
    { "mood": "ret", "ret": { "role": "obj", "name": "target" } },
    { "mood": "prah", "subj": { "name": "worker" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "target" }, "be": "worker", "obj": { "num": 5 }, "fromindex": { "num": 3 }, "toindex": { "num": 5 } },
    { "subj": { "name": "target" }, "obj": { "num": 5 }, "be": "worker", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 5 }, "be": "worker", "mood": "ya" }
  ]
  ```
- **Notes**: The `ret` merges into the evoker and preserves `fromindex`/`toindex` there. No `subj fromindex` or `subj toindex` facts appear in memory.
