### Example: neuron

- **id**: neuron
- **status**: ready
- **intent**: Compute a single neuron output from weights, inputs, and bias using dot product + sigmoid.
- **type**: REPL
- **REPL input**:
  ```
  su name weights ob vec num 1 2 3 be vector ya
  su name inputs ob vec num 4 5 6 be vector ya
  su name bias ob num 0 be number ya
  from name weights by name inputs fromstate name bias to name output be neuron do
  su name output ob what que
  ```
- **Expected output**:
  ```
  su name output ob num 0.9999999999999873 be number ya
  ```
- **Notes**: `neuron` pulls vectors from `from`/`by`, scalar bias from `fromstate`, and writes the activated result (sigmoid of dot + bias) to the `to` target and `result`. Activation defaults to `twice crescent` (sigmoid).
