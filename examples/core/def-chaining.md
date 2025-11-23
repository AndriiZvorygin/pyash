### Example: def-chaining

- **id**: def-chaining
- **status**: ready
- **intent**: Chain two ceremony calls where the first sets `result` and the second consumes/updates it.
- **type**: REPL
- **REPL input**:
  ```
  subj name add one be ceremony def
  obj num 1 to name result be add do
  this ret
  subj name add one be ceremony prah

  subj name add two be ceremony def
  obj num 2 to name result be add do
  this ret
  subj name add two be ceremony prah

  to name result be add one do
  to name result be add two do
  subj name result obj what que
  ```
- **Expected output**:
  ```
  subj name result obj num 3 be add two ya
  ```
- **Notes**: The first ceremony initializes/updates `result` (defaulting to 0), the second builds on it. Shows chaining of definitions via the `result` fact.
