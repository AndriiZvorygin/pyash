# Example: read-file

- **id**: read-file
- **status**: ready
- **intent**: Load text from a filename using `be read do` and store the text fact in memory.
- **type**: REPL
- **REPL input**:
  ```
  subj name file be read from filename "test/sandpit/compile.txt" do
  mem
  ```
- **Expected output**:
  ```
  → { "value": { "text": "subj name alpha obj num 1 be number ya\nsubj name beta obj num 2 be number ya" } }
  Memory: [
    {
      "subj": { "name": "file" },
      "be": "read",
      "from": { "filename": "test/sandpit/compile.txt" },
      "mood": "do"
    },
    {
      "subj": { "name": "file" },
      "be": "text",
      "obj": { "text": "subj name alpha obj num 1 be number ya\nsubj name beta obj num 2 be number ya" },
      "mood": "ya"
    },
    {
      "subj": { "name": "result" },
      "obj": { "text": "subj name alpha obj num 1 be number ya\nsubj name beta obj num 2 be number ya" },
      "be": "text",
      "mood": "ya"
    }
  ]
  ```
- **Notes**: Uses the `read_from_filename` handler against the bundled `test/sandpit/compile.txt` fixture.
