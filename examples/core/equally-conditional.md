### Example: equally-conditional

- **id**: equally-conditional
- **status**: ready
- **intent**: Demonstrate `equally` (equality) controlling the next statement (`then`), including subject-to-subject comparison.
- **type**: REPL
- **REPL input**:
  ```
  ob num 5 be equally from num 5 then
  su name collector ob num 1 be number ya
  ob num 2 to name collector be add do
  su name collector ob what que
  reset
  su name lhs ob num 5 be number ya
  su name rhs ob num 5 be number ya
  su name lhs be equally from name rhs then
  ob num 1 to name lhs be add do
  su name lhs ob what que
  reset
  ob num 4 be equally from num 5 then
  su name collector ob num 1 be number ya
  ob num 2 to name collector be add do
  su name collector ob what que
  ```
- **Expected output**:
  ```
  su name collector ob num 3 be number ya
  su name lhs ob num 6 be number ya
  su name collector ob num 1 be number ya
  ```
- **Notes**: `equally` is true when the subject equals `from`. The first branch uses inline numbers; the second compares two stored subjects; the third shows the false branch skipping the add.
