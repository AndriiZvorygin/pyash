### Example: def-chaining

- **id**: def-chaining
- **status**: ready
- **intent**: Chain two ceremony calls where the first sets `result` and the second consumes/updates it.
- **type**: REPL
- **REPL input**:
  ```
su name add one to name result be ceremony def
ob num 1 to name result be plus do
this ret
su name add one be ceremony prah

su name add two to name result be ceremony def
ob num 2 to name result be plus do
this ret
su name add two be ceremony prah

  to name result be plus one do
  to name result be plus two do
  su name result ob what que
  ```
- **Expected output**:
  ```
  su name result ob num 3 be plus two ya
  ```
- **Notes**: The first ceremony initializes/updates `result` (defaulting to 0), the second builds on it. Shows chaining of definitions via the `result` fact.
