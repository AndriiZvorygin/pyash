### Example: this-registers

- **id**: this-registers
- **status**: ready
- **intent**: Show `this fromindex` and `this toindex` access inside a ceremony body, with registers living on the evoker.
- **type**: REPL
- **REPL input**:
  ```
  su name inspector be ceremony def
  su name seen-fromindex ob this fromindex be number ya
  su name seen-toindex ob this toindex be number ya
  this ret
  su name inspector be ceremony prah
  to name sink fromindex num 2 toindex num 2 be inspector do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "def", "su": { "name": "inspector" }, "be": "ceremony" },
    { "mood": "ya", "su": { "name": "seen-fromindex" }, "ob": { "num": 2 }, "be": "number" },
    { "mood": "ya", "su": { "name": "seen-toindex" }, "ob": { "num": 2 }, "be": "number" },
    { "mood": "ret" },
    { "mood": "prah", "su": { "name": "inspector" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "sink" }, "fromindex": { "num": 2 }, "toindex": { "num": 2 }, "be": "inspector" },
    { "su": { "name": "sink" }, "fromindex": { "num": 2 }, "toindex": { "num": 2 }, "be": "inspector", "mood": "ya" },
    { "su": { "name": "result" }, "fromindex": { "num": 2 }, "toindex": { "num": 2 }, "be": "inspector", "mood": "ya" }
  ]
  ```
- **Notes**: The body copies `this fromindex`/`this toindex` into facts (`seen`, `seen toindex`) and returns the evoker via `ret`. No standalone register facts appear; registers remain on the evoker/result.
