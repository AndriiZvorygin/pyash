### Example: multiply and divide

- **id**: multiply-divide
- **status**: ready
- **intent**: Show multiplying and dividing numbers using the quantity axis (`by`) and updating targets/results.
- **type**: REPL
- **REPL input**:
  ```
  ob num 2 by num 3 be multiply do
  su name result ob what que
  reset
  su name acc ob num 20 be number ya
  ob name acc by num 4 to name acc be divide do
  su name acc ob what que
  ```
- **Expected output**:
  ```
  su name result ob num 6 be number ya
  su name acc ob num 5 be number ya
  ```
- **Notes**: `by` carries the second operand for both `multiply` and `divide`. Imperatives store both the command and a `result` fact; targeting `acc` updates that fact in place.
