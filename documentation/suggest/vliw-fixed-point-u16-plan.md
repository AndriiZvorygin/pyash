# VLIW U16 Fixed-Point Plan

## Goal

Add a compact fixed-point scalar for VLIW without changing the existing
unsigned-integer or IEEE binary32 formats. The value payload is one unsigned
16-bit numerator interpreted over a fixed scale:

```text
value = numerator / 46656
```

The scale is `6^6`, or `1,000,000` in base 6. It has 49 divisors; the u16
maximum `65,535` has 16, and 2,520 has 48. The encoded range is 0 through
`65535 / 46656` (about 1.40535), with steps of `1 / 46656`.

## Encoding And Semantics

- Introduce a distinct fixed-point quote kind, tagged through the existing
  typed-quote mechanism. Its payload is exactly one little-endian u16; the
  denominator is a fixed format constant, not repeated per value or selected
  from machine configuration.
- Keep the format distinct from unsigned integers and float32. Preserve the
  existing float32 encoding and behavior.
- Reuse Pyash's existing numeric-base marker for base-6 source conversion; do
  not add another base marker or encode payload words as base-6 digits.
- Route `plus`, `subtract`, `multiply`, and `divide` through the shared Rust
  VLIW semantics for CPU and WGSL. Multiplication and division round to
  nearest, ties to even. Underflow, overflow, and division by zero are explicit
  errors.
- Add no legacy quote sort or HNUC allocation.

## Verification

- Test typed quote encode/decode for zero, one, and the maximum numerator.
- Test base-6 source conversion through the existing marker.
- Test all four operators, ties-to-even, subtraction underflow, overflow, and
  division by zero.
- Run the same cases through Rust CPU and WGSL and require identical values
  and error codes; retain the float32 regression tests unchanged.
