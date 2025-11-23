### Example: tiny-conditional

- **id**: tiny-conditional
- **status**: ready
- **intent**: Demonstrate `tiny` (less-than) controlling the next statement (`then`), alongside `giant` behaviour.
- **type**: REPL
- **REPL input**:
  ```
  subj name collector obj num 3 be number ya
  obj num 3 be tiny from num 5 then
  obj num 2 to name collector be add do
  subj name collector obj what que
  reset
  subj name collector obj num 10 be number ya
  obj num 10 be tiny from num 5 then
  obj num 2 to name collector be add do
  subj name collector obj what que
  ```
- **Expected output**:
  ```
  subj name collector obj num 5 be number ya
  subj name collector obj num 10 be number ya
  ```
- **Notes**: `tiny` is the inverse of `giant`: true when the subject is less than `from`. In the first branch, `3 < 5` so the add runs; in the second, `10 < 5` is false so the add is skipped. The `then` skip behaviour matches the existing `giant` tests. 
