### Example: until-loop

- **id**: until-loop
- **status**: ready
- **intent**: Loop climbs from a lower `tloh` toward a higher `until`, stopping when they match.
- **type**: REPL
- **REPL input**:
  ```
  subj name counter obj num 0 be number ya
  subj name climb be ceremony def
  obj num 1 to name counter be add do
  subj name climb be ceremony prah
  subj name tloh obj num 1 be number ya
  subj name until obj num 3 be number ya
  to name counter be climb do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "counter" }
  → { "stored": "climb" }
  → { "recorded": true }
  → { "paragraphEnd": true }
  → { "invoked": "climb", "result": { "acted": "counter", "value": { "obj": 1 } } }
  Memory: [
    { "subj": { "name": "climb" }, "be": "ceremony", "mood": "def" },
    { "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add", "mood": "do" },
    { "subj": { "name": "climb" }, "be": "ceremony", "mood": "prah" },
    { "subj": { "name": "tloh" }, "obj": { "num": 1 }, "be": "number", "mood": "ya" },
    { "subj": { "name": "until" }, "obj": { "num": 3 }, "be": "number", "mood": "ya" },
    { "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add", "mood": "do" },
    { "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add", "mood": "do" },
    { "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add", "mood": "do" },
    { "subj": { "name": "counter" }, "obj": { "num": 3 }, "be": "number", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 3 }, "be": "add", "mood": "ya" },
    { "subj": { "name": "tloh" }, "obj": { "num": 3 }, "be": "number", "mood": "ya" },
    { "subj": { "name": "until" }, "obj": { "num": 3 }, "be": "number", "mood": "ya" },
    { "to": { "name": "counter" }, "be": "climb", "mood": "do" }
  ]
  ```
- **Notes**: With `until > tloh`, the supervisor increments `tloh` each iteration instead of decrementing. Loop stops when `tloh == until`.
