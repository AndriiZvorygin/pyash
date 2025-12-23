# Example: read-file

- **id**: read-file
- **status**: ready
- **intent**: Load text from a filename using `be read do` and store the text fact in memory.
- **type**: REPL
- **REPL input**:
  ```
  su name file be read from filename "test/sandpit/compile.txt" do
  mem
  ```
- **Expected output**:
  ```
  → { "value": { "text": "su name alpha ob num 1 be number ya\nsubj name beta ob num 2 be number ya" } }
  Memory: [
    {
      "su": { "name": "file" },
      "be": "read",
      "from": { "filename": "test/sandpit/compile.txt" },
      "mood": "do"
    },
    {
      "su": { "name": "file" },
      "be": "text",
      "ob": { "text": "su name alpha ob num 1 be number ya\nsubj name beta ob num 2 be number ya" },
      "mood": "ya"
    },
    {
      "su": { "name": "result" },
      "ob": { "text": "su name alpha ob num 1 be number ya\nsubj name beta ob num 2 be number ya" },
      "be": "text",
      "mood": "ya"
    }
  ]
  ```
- **Notes**: Uses the `read_from_filename` handler against the bundled `test/sandpit/compile.txt` fixture.
