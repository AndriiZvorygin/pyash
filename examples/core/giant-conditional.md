### Example: giant-conditional

- **id**: giant-conditional
- **status**: ready
- **intent**: Demonstrate `giant` (greater-than) controlling the next statement (`then`), including subject-to-subject comparison.
- **type**: REPL
- **REPL input**:
  ```
  ob num 7 be giant from num 5 then
  su name collector ob num 1 be number ya
  ob num 2 to name collector be add do
  su name collector ob what que
  reset
  su name lhs ob num 6 be number ya
  su name rhs ob num 5 be number ya
  su name lhs be giant from name rhs then
  ob num 1 to name lhs be add do
  su name lhs ob what que
  reset
  ob num 2 be giant from num 5 then
  su name collector ob num 1 be number ya
  ob num 2 to name collector be add do
  su name collector ob what que
  ```
- **Expected output**:
  ```
  su name collector ob num 3 be number ya
  su name lhs ob num 7 be number ya
  su name collector ob num 1 be number ya
  ```
- **Notes**: `giant` is true when the subject is greater than `from`. First branch uses inline numbers; second compares two stored subjects (`lhs` vs `rhs`); third shows the false branch skipping the add. `then` skip behaviour matches `tiny`/`equally`.
