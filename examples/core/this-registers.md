### Example: this-registers

- **id**: this-registers
- **status**: ready
- **intent**: Show `this tloh` and `this until` access inside a ceremony body, with registers living on the evoker.
- **type**: REPL
- **REPL input**:
  ```
  subj name inspector be ceremony def
  subj name seen-tloh obj this tloh be number ya
  subj name seen-until obj this until be number ya
  this ret
  subj name inspector be ceremony prah
  to name sink tloh num 2 until num 2 be inspector do
  mem
  ```
- **Expected output**:
  ```
  Memory: [
    { "mood": "def", "subj": { "name": "inspector" }, "be": "ceremony" },
    { "mood": "ya", "subj": { "name": "seen-tloh" }, "obj": { "num": 2 }, "be": "number" },
    { "mood": "ya", "subj": { "name": "seen-until" }, "obj": { "num": 2 }, "be": "number" },
    { "mood": "ret" },
    { "mood": "prah", "subj": { "name": "inspector" }, "be": "ceremony" },
    { "mood": "do", "to": { "name": "sink" }, "tloh": { "num": 2 }, "until": { "num": 2 }, "be": "inspector" },
    { "subj": { "name": "sink" }, "tloh": { "num": 2 }, "until": { "num": 2 }, "be": "inspector", "mood": "ya" },
    { "subj": { "name": "result" }, "tloh": { "num": 2 }, "until": { "num": 2 }, "be": "inspector", "mood": "ya" }
  ]
  ```
- **Notes**: The body copies `this tloh`/`this until` into facts (`seen`, `seen until`) and returns the evoker via `ret`. No standalone register facts appear; registers remain on the evoker/result.
