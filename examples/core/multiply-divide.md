### Example: multiply and divide

- **id**: multiply-divide
- **status**: ready
- **intent**: Show multiplying and dividing numbers using the quantity axis (`by`) and updating targets/results.
- **type**: REPL
- **REPL input**:
  ```
  obj num 2 by num 3 be multiply do
  subj name result obj what que
  reset
  subj name acc obj num 20 be number ya
  obj name acc by num 4 to name acc be divide do
  subj name acc obj what que
  ```
- **Expected output**:
  ```
  subj name result obj num 6 be number ya
  subj name acc obj num 5 be number ya
  ```
- **Notes**: `by` carries the second operand for both `multiply` and `divide`. Imperatives store both the command and a `result` fact; targeting `acc` updates that fact in place.
