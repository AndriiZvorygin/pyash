//! Compilation targets for the Pyash VLIW codelet format.
//!
//! A codelet is a fixed-width vector of sixteen 16-bit words. A destination
//! turns that vector into the machine code that computes the same result the
//! interpreter produces.

pub mod riscv;
