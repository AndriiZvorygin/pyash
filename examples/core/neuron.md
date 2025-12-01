### Example: neuron

- **id**: neuron
- **status**: ready
- **intent**: Compute a single neuron output from weights, inputs, and bias using dot product + sigmoid.
- **type**: REPL
- **REPL input**:
  ```
  subj name weights obj vec num 1 2 3 be vector ya
  subj name inputs obj vec num 4 5 6 be vector ya
  subj name bias obj num 0 be number ya
  from name weights by name inputs fromstate name bias to name output be neuron do
  subj name output obj what que
  ```
- **Expected output**:
  ```
  subj name output obj num 0.9999999999999873 be number ya
  ```
- **Notes**: `neuron` pulls vectors from `from`/`by`, scalar bias from `fromstate`, and writes the activated result (sigmoid of dot + bias) to the `to` target and `result`. Activation defaults to `twice crescent` (sigmoid).
