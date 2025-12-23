### Example: subtract

- **id**: subtract
- **status**: ready
- **intent**: Show subtracting numbers from a named target, both inline and subject-to-subject.
- **type**: REPL
- **REPL input**:
  ```
  su name collector ob num 10 be number ya
  ob num 3 from name collector be subtract do
  su name collector ob what que
  reset
  su name lhs ob num 8 be number ya
  su name rhs ob num 5 be number ya
  ob name rhs from name lhs be subtract do
  su name lhs ob what que
  ```
- **Expected output**:
  ```
  su name collector ob num 7 be number ya
  su name lhs ob num 3 be number ya
  ```
- **Notes**: `subtract` works with inline numbers or named subjects; when using `from name lhs`, the target is inferred from `from` if `to` is omitted.
