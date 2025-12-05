# Example: understand-text

- **id**: understand-text
- **status**: ready
- **intent**: Parse stored text into parsed sentences + JSON via `be understand do`.
- **type**: REPL
- **REPL input**:
  ```
  subj name input obj text quoted.pyash.subj name alpha obj num 1 be number ya\nsubj name beta obj num 2 be number ya.pyash.quoted be text ya
  subj name output be text ya
  obj name input from state pyash to state JSON to name output be understand do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "input" }
  → { "stored": "output" }
  → { "acted": "output", "value": { "sentences": [ { "subj": { "name": "alpha" }, "obj": { "num": 1 }, "be": "number", "mood": "ya" }, { "subj": { "name": "beta" }, "obj": { "num": 2 }, "be": "number", "mood": "ya" } ], "text": "[{\"subj\":{\"name\":\"alpha\"},\"obj\":{\"num\":1},\"be\":\"number\",\"mood\":\"ya\"},{\"subj\":{\"name\":\"beta\"},\"obj\":{\"num\":2},\"be\":\"number\",\"mood\":\"ya\"}]" } }
  Memory: [
    { "subj": { "name": "input" }, "obj": { "text": "subj name alpha obj num 1 be number ya\nsubj name beta obj num 2 be number ya" }, "be": "text", "mood": "ya" },
    { "subj": { "name": "output" }, "be": "text", "mood": "ya" },
    { "obj": { "name": "input" }, "from": { "state": "pyash" }, "to": { "state": "JSON", "name": "output" }, "be": "understand", "mood": "do" },
    { "subj": { "name": "output" }, "be": "understand", "obj": { "sentences": [ { "subj": { "name": "alpha" }, "obj": { "num": 1 }, "be": "number", "mood": "ya" }, { "subj": { "name": "beta" }, "obj": { "num": 2 }, "be": "number", "mood": "ya" } ], "text": "[{\"subj\":{\"name\":\"alpha\"},\"obj\":{\"num\":1},\"be\":\"number\",\"mood\":\"ya\"},{\"subj\":{\"name\":\"beta\"},\"obj\":{\"num\":2},\"be\":\"number\",\"mood\":\"ya\"}]" }, "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "sentences": [ { "subj": { "name": "alpha" }, "obj": { "num": 1 }, "be": "number", "mood": "ya" }, { "subj": { "name": "beta" }, "obj": { "num": 2 }, "be": "number", "mood": "ya" } ], "text": "[{\"subj\":{\"name\":\"alpha\"},\"obj\":{\"num\":1},\"be\":\"number\",\"mood\":\"ya\"},{\"subj\":{\"name\":\"beta\"},\"obj\":{\"num\":2},\"be\":\"number\",\"mood\":\"ya\"}]" }, "be": "understand", "mood": "ya" }
  ]
  ```
- **Notes**: Matches `quiz/compile.test.mjs` (using `understand`); demonstrates storing input text, placeholder output target, running understand, and the resulting structured/text payload.
