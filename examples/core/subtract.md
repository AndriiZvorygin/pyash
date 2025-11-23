### Example: subtract

- **id**: subtract
- **status**: ready
- **intent**: Show subtracting numbers from a named target, both inline and subject-to-subject.
- **type**: REPL
- **REPL input**:
  ```
  subj name collector obj num 10 be number ya
  obj num 3 from name collector be subtract do
  subj name collector obj what que
  reset
  subj name lhs obj num 8 be number ya
  subj name rhs obj num 5 be number ya
  obj name rhs from name lhs be subtract do
  subj name lhs obj what que
  ```
- **Expected output**:
  ```
  subj name collector obj num 7 be number ya
  subj name lhs obj num 3 be number ya
  ```
- **Notes**: `subtract` works with inline numbers or named subjects; when using `from name lhs`, the target is inferred from `from` if `to` is omitted.
