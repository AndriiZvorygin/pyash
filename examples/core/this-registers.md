### Example: this-registers

- **id**: this-registers
- **status**: ready
- **intent**: Show `this fromindex` and `this toindex` access inside a ceremony body, with registers living on the evoker.
- **type**: REPL
- **REPL input**:
  ```
  subj name inspector be ceremony def
  subj name seen-fromindex obj this fromindex be number ya
  subj name seen-toindex obj this toindex be number ya
  this ret
  subj name inspector be ceremony prah
  to name sink fromindex num 2 toindex num 2 be inspector do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "def", "subj": { "name": "inspector" }, "be": "ceremony" },
    { "mood": "ya", "subj": { "name": "seen-fromindex" }, "obj": { "num": 2 }, "be": "number" },
    { "mood": "ya", "subj": { "name": "seen-toindex" }, "obj": { "num": 2 }, "be": "number" },
    { "mood": "ret" },
    { "mood": "prah", "subj": { "name": "inspector" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "sink" }, "fromindex": { "num": 2 }, "toindex": { "num": 2 }, "be": "inspector" },
    { "subj": { "name": "sink" }, "fromindex": { "num": 2 }, "toindex": { "num": 2 }, "be": "inspector", "mood": "ya" },
    { "subj": { "name": "result" }, "fromindex": { "num": 2 }, "toindex": { "num": 2 }, "be": "inspector", "mood": "ya" }
  ]
  ```
- **Notes**: The body copies `this fromindex`/`this toindex` into facts (`seen`, `seen toindex`) and returns the evoker via `ret`. No standalone register facts appear; registers remain on the evoker/result.
