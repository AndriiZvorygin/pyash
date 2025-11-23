### Example: giant-conditional

- **id**: giant-conditional
- **status**: ready
- **intent**: Demonstrate `giant` (greater-than) controlling the next statement (`then`), including subject-to-subject comparison.
- **type**: REPL
- **REPL input**:
  ```
  obj num 7 be giant from num 5 then
  subj name collector obj num 1 be number ya
  obj num 2 to name collector be add do
  subj name collector obj what que
  reset
  subj name lhs obj num 6 be number ya
  subj name rhs obj num 5 be number ya
  subj name lhs be giant from name rhs then
  obj num 1 to name lhs be add do
  subj name lhs obj what que
  reset
  obj num 2 be giant from num 5 then
  subj name collector obj num 1 be number ya
  obj num 2 to name collector be add do
  subj name collector obj what que
  ```
- **Expected output**:
  ```
  subj name collector obj num 3 be number ya
  subj name lhs obj num 7 be number ya
  subj name collector obj num 1 be number ya
  ```
- **Notes**: `giant` is true when the subject is greater than `from`. First branch uses inline numbers; second compares two stored subjects (`lhs` vs `rhs`); third shows the false branch skipping the add. `then` skip behaviour matches `tiny`/`equally`.
