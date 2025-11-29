### Example: exponential and invert

- **id**: exponential-invert
- **status**: ready
- **intent**: Show natural exponent (`exponential`) and numeric negation (`invert`) using numeric literals and targets.
- **type**: REPL
- **REPL input**:
  ```
  obj num 1 to name variable be exponential do
  subj name variable obj what que
  reset
  obj num 3 be invert do
  subj name result obj what que
  ```
- **Expected output**:
  ```
  subj name variable obj num 2.718281828 be number ya
  subj name result obj num -3 be number ya
  ```
- **Notes**: `exponential` computes `e^x` from the `obj` value; `invert` negates the provided operand. Both store a `result` fact and update any addressed target.
