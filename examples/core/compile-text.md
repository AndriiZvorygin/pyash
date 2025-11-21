# Example: compile-text

- **id**: compile-text
- **status**: ready
- **intent**: Compile stored text into parsed sentences + JSON via `be compile do`.
- **type**: REPL
- **REPL input**:
  ```
  subj name input obj text quoted.pyash.subj name alpha obj num 1 be number ya\nsubj name beta obj num 2 be number ya.pyash.quoted be text ya
  subj name output be text ya
  obj name input from state pyash to state JSON to name output be compile do
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
    { "obj": { "name": "input" }, "from": { "state": "pyash" }, "to": { "state": "JSON", "name": "output" }, "be": "compile", "mood": "do" },
    { "subj": { "name": "output" }, "be": "compile", "obj": { "sentences": [ { "subj": { "name": "alpha" }, "obj": { "num": 1 }, "be": "number", "mood": "ya" }, { "subj": { "name": "beta" }, "obj": { "num": 2 }, "be": "number", "mood": "ya" } ], "text": "[{\"subj\":{\"name\":\"alpha\"},\"obj\":{\"num\":1},\"be\":\"number\",\"mood\":\"ya\"},{\"subj\":{\"name\":\"beta\"},\"obj\":{\"num\":2},\"be\":\"number\",\"mood\":\"ya\"}]" }, "mood": "ya" },
    { "subj": { "name": "result" }, "obj": { "sentences": [ { "subj": { "name": "alpha" }, "obj": { "num": 1 }, "be": "number", "mood": "ya" }, { "subj": { "name": "beta" }, "obj": { "num": 2 }, "be": "number", "mood": "ya" } ], "text": "[{\"subj\":{\"name\":\"alpha\"},\"obj\":{\"num\":1},\"be\":\"number\",\"mood\":\"ya\"},{\"subj\":{\"name\":\"beta\"},\"obj\":{\"num\":2},\"be\":\"number\",\"mood\":\"ya\"}]" }, "be": "compile", "mood": "ya" }
  ]
  ```
- **Notes**: Matches `test/compile.test.mjs`; demonstrates storing input text, placeholder output target, running compile, and the resulting structured/text payload.
