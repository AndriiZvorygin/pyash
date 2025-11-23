### Example: equally-conditional

- **id**: equally-conditional
- **status**: ready
- **intent**: Demonstrate `equally` (equality) controlling the next statement (`then`), including subject-to-subject comparison.
- **type**: REPL
- **REPL input**:
  ```
  obj num 5 be equally from num 5 then
  subj name collector obj num 1 be number ya
  obj num 2 to name collector be add do
  subj name collector obj what que
  reset
  subj name lhs obj num 5 be number ya
  subj name rhs obj num 5 be number ya
  subj name lhs be equally from name rhs then
  obj num 1 to name lhs be add do
  subj name lhs obj what que
  reset
  obj num 4 be equally from num 5 then
  subj name collector obj num 1 be number ya
  obj num 2 to name collector be add do
  subj name collector obj what que
  ```
- **Expected output**:
  ```
  subj name collector obj num 3 be number ya
  subj name lhs obj num 6 be number ya
  subj name collector obj num 1 be number ya
  ```
- **Notes**: `equally` is true when the subject equals `from`. The first branch uses inline numbers; the second compares two stored subjects; the third shows the false branch skipping the add.
