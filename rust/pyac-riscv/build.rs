//! The build step that compiles a Pyash codelet into machine code.
//!
//! The compiler is the host-side Pyash backend, so the image carries the
//! machine code the interpreter's semantics call for, not a re-implementation
//! of them.

use pyac::GOLDEN_NUMERIC_PLUS_CODELET;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let program = pyac::compile_numeric_arithmetic(&GOLDEN_NUMERIC_PLUS_CODELET)
        .expect("the golden codelet compiles");
    let out_dir = std::env::var("OUT_DIR").expect("the build sets OUT_DIR");
    let body = std::path::Path::new(&out_dir).join("body.S");
    std::fs::write(&body, program.to_assembly("pyac_body")).expect("the body is written");

    // The image is linked with the bare-metal script that places the entry
    // point and the program at a load address.
    println!("cargo:rustc-link-arg=-Tlink.ld");
}
