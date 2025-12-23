### Example: tiny-conditional

- **id**: tiny-conditional
- **status**: ready
- **intent**: Demonstrate `tiny` (less-than) controlling the next statement (`then`), alongside `giant` behaviour.
- **type**: REPL
- **REPL input**:
  ```
  su name collector ob num 3 be number ya
  ob num 3 be tiny from num 5 then
  ob num 2 to name collector be add do
  su name collector ob what que
  reset
  su name lhs ob num 2 be number ya
  su name rhs ob num 5 be number ya
  su name lhs be tiny from name rhs then
  ob num 1 to name lhs be add do
  su name lhs ob what que
  reset
  su name collector ob num 10 be number ya
  ob num 10 be tiny from num 5 then
  ob num 2 to name collector be add do
  su name collector ob what que
  ```
- **Expected output**:
  ```
  su name collector ob num 5 be number ya
  su name lhs ob num 3 be number ya
  su name collector ob num 10 be number ya
  ```
- **Notes**: `tiny` is the inverse of `giant`: true when the subject is less than `from`. The first branch uses an inline number, the second compares two stored subjects, and the third uses the inline form to skip. The `then` skip behaviour matches the existing `giant` tests. 
