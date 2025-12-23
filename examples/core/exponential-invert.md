### Example: exponential and invert

- **id**: exponential-invert
- **status**: ready
- **intent**: Show power-of (`exponential`) and numeric negation (`invert`) using numeric literals and targets.
- **type**: REPL
- **REPL input**:
  ```
  ob num 2 from num 3 to name variable be exponential do
  su name variable ob what que
  reset
  ob num 3 be invert do
  su name result ob what que
  ```
- **Expected output**:
  ```
  su name variable ob num 8 be number ya
  su name result ob num -3 be number ya
  ```
- **Notes**: `exponential` computes `ob^from` (base in `ob`, exponent in `from`); `invert` negates the provided operand. Both store a `result` fact and update any addressed target.
