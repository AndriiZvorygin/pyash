### Example: exponential and invert

- **id**: exponential-invert
- **status**: ready
- **intent**: Show power-of (`exponential`) and numeric negation (`invert`) using numeric literals and targets.
- **type**: REPL
- **REPL input**:
  ```
  obj num 2 from num 3 to name variable be exponential do
  subj name variable obj what que
  reset
  obj num 3 be invert do
  subj name result obj what que
  ```
- **Expected output**:
  ```
  subj name variable obj num 8 be number ya
  subj name result obj num -3 be number ya
  ```
- **Notes**: `exponential` computes `obj^from` (base in `obj`, exponent in `from`); `invert` negates the provided operand. Both store a `result` fact and update any addressed target.
