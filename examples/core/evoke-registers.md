### Example: evoke-registers

- **id**: evoke-registers
- **status**: ready
- **intent**: A ceremony returns via `ret` while keeping `fromindex`/`toindex` on the evoker; no standalone register facts are emitted.
- **type**: REPL
- **REPL input**:
  ```
su name worker to name target be ceremony def
ob num 4 to name target be add do
this ob name target ret
su name worker be ceremony prah
  su name target ob num 1 fromindex num 3 toindex num 5 be number ya
  to name target be worker do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "def", "su": { "name": "worker" }, "be": "ceremony" },
    { "mood": "do", "ob": { "num": 4 }, "to": { "name": "target" }, "be": "add" },
    { "mood": "ret", "ret": { "role": "ob", "name": "target" } },
    { "mood": "prah", "su": { "name": "worker" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "target" }, "be": "worker", "ob": { "num": 5 }, "fromindex": { "num": 3 }, "toindex": { "num": 5 } },
    { "su": { "name": "target" }, "ob": { "num": 5 }, "be": "worker", "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "num": 5 }, "be": "worker", "mood": "ya" }
  ]
  ```
- **Notes**: The `ret` merges into the evoker and preserves `fromindex`/`toindex` there. No `su fromindex` or `su toindex` facts appear in memory.
