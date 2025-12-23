### Example: vectors

- **id**: vectors
- **status**: ready
- **intent**: Show vector literals with different element types.
- **type**: REPL
- **REPL input**:
  ```
  ob ve num 1 2 3 be topic ya
  ob ve letter a b c d be topic ya
  ob ve text "apple" "red maple" "pine" be topic ya
  ```
- **Expected output**:
  ```
  ob ve num 1 2 3 be topic ya
  ob ve letter a b c d be topic ya
  ob ve text apple red maple pine be topic ya
  ```
- **Notes**: `ve <element-type>` captures the element type and the following tokens as vector values until the next role or `be`. Numeric elements are parsed into numbers; other element types keep their literal strings (quoted blocks preserve spaces).

### Dot product (`produce`)

```
ob vec num 1 2 3 by vec num 4 5 6 to name z be produce do
su name z ob what que
```

Output:

```
su name z ob num 32 be number ya
```

Use `from name w by name x` to pull stored vectors; result is the dot product stored on the target and `result`.

### Write element (`write`)

```
exists su name vec ob ve num 10 20 30 be vector ya
ob num 99 to name vec at num 1 be write do
ob ve of vec be write do
```

Output:

```
ve num 10 99 30
```
