mod build_support;

use std::{env, fs, path::PathBuf};

fn main() {
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"))
        .join("fixed_array_access.rs");
    fs::write(output, build_support::generate_fixed_array_accessors())
        .expect("write fixed array accessors");
}
