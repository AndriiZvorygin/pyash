### Example: tloh-loop

- **id**: tloh-loop
- **status**: ready
- **intent**: Loop using `tloh` to repeat a ceremony until `tloh` reaches a target (`until` or zero). Default shown: countdown to zero.
- **type**: REPL
- **REPL input**:
  ```
  subj name counter obj num 0 be number ya
  subj name loop body be ceremony def
  obj num 1 to name counter be add do
  subj name loop body be ceremony prah
  subj name tloh obj num 3 be number ya
  to name counter be loop body do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "counter" }
  → { "stored": "loop body" }
  → { "recorded": true }
  → { "paragraphEnd": true }
  → { "invoked": "loop body", "result": { "acted": "counter", "value": { "obj": 1 } } }
  Memory: [
    { "subj": { "name": "loop body" }, "be": "ceremony", "mood": "def" },
    { "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add", "mood": "do" },
    { "subj": { "name": "loop body" }, "be": "ceremony", "mood": "prah" },
    { "subj": { "name": "tloh" }, "obj": { "num": 3 }, "be": "number", "mood": "ya" },
    { "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add", "mood": "do" },
    { "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add", "mood": "do" },
    { "obj": { "num": 1 }, "to": { "name": "counter" }, "be": "add", "mood": "do" },
    { "subj": { "name": "counter" }, "obj": { "num": 3 }, "be": "number", "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "num": 3 }, "be": "add", "mood": "ya" },
    { "subj": { "name": "tloh" }, "obj": { "num": 0 }, "be": "number", "mood": "ya" },
    { "to": { "name": "counter" }, "be": "loop body", "mood": "do" }
  ]
  ```
- **Notes**: Shows default supervisor decrement of `tloh` when the body doesn’t set it; loop runs three times starting from `tloh 3`, counter ends at 3.
