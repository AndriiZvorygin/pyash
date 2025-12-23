# Example: understand-text

- **id**: understand-text
- **status**: ready
- **intent**: Parse stored text into parsed sentences + JSON via `be understand do`.
- **type**: REPL
- **REPL input**:
  ```
  su name input ob text quoted.pyash.su name alpha ob num 1 be number ya\nsubj name beta ob num 2 be number ya.pyash.quoted be text ya
  su name output be text ya
  ob name input from state pyash to state JSON to name output be understand do
  mem
  ```
- **Expected output**:
  ```
  → { "stored": "input" }
  → { "stored": "output" }
  → { "acted": "output", "value": { "sentences": [ { "su": { "name": "alpha" }, "ob": { "num": 1 }, "be": "number", "mood": "ya" }, { "su": { "name": "beta" }, "ob": { "num": 2 }, "be": "number", "mood": "ya" } ], "text": "[{\"su\":{\"name\":\"alpha\"},\"ob\":{\"num\":1},\"be\":\"number\",\"mood\":\"ya\"},{\"su\":{\"name\":\"beta\"},\"ob\":{\"num\":2},\"be\":\"number\",\"mood\":\"ya\"}]" } }
  Memory: [
    { "su": { "name": "input" }, "ob": { "text": "su name alpha ob num 1 be number ya\nsubj name beta ob num 2 be number ya" }, "be": "text", "mood": "ya" },
    { "su": { "name": "output" }, "be": "text", "mood": "ya" },
    { "ob": { "name": "input" }, "from": { "state": "pyash" }, "to": { "state": "JSON", "name": "output" }, "be": "understand", "mood": "do" },
    { "su": { "name": "output" }, "be": "understand", "ob": { "sentences": [ { "su": { "name": "alpha" }, "ob": { "num": 1 }, "be": "number", "mood": "ya" }, { "su": { "name": "beta" }, "ob": { "num": 2 }, "be": "number", "mood": "ya" } ], "text": "[{\"su\":{\"name\":\"alpha\"},\"ob\":{\"num\":1},\"be\":\"number\",\"mood\":\"ya\"},{\"su\":{\"name\":\"beta\"},\"ob\":{\"num\":2},\"be\":\"number\",\"mood\":\"ya\"}]" }, "mood": "ya" },
    { "su": { "name": "result" }, "ob": { "sentences": [ { "su": { "name": "alpha" }, "ob": { "num": 1 }, "be": "number", "mood": "ya" }, { "su": { "name": "beta" }, "ob": { "num": 2 }, "be": "number", "mood": "ya" } ], "text": "[{\"su\":{\"name\":\"alpha\"},\"ob\":{\"num\":1},\"be\":\"number\",\"mood\":\"ya\"},{\"su\":{\"name\":\"beta\"},\"ob\":{\"num\":2},\"be\":\"number\",\"mood\":\"ya\"}]" }, "be": "understand", "mood": "ya" }
  ]
  ```
- **Notes**: Matches `quiz/compile.test.mjs` (using `understand`); demonstrates storing input text, placeholder output target, running understand, and the resulting structured/text payload.
