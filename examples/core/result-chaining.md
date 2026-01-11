### Example: result-chaining

- **id**: result-chaining
- **status**: ready
- **intent**: Show using the `result` fact from one invocation as input to the next.
- **type**: REPL
- **REPL input**:
  ```
  su name a ob num 1 be number ya
  ob num 2 to name a be plus do
  ob num 4 to name result be plus do
  su name result ob what que
  ```
- **Expected output**:
  ```
  su name result ob num 7 be plus ya
  ```
- **Notes**: After the first add (1 + 2 = 3), the `result` fact is addressed by name in the next add, producing 7. Demonstrates chaining via `result`.
