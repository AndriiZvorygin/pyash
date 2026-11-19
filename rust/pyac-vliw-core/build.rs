use std::{env, fs, path::PathBuf};

const CHUNKED_LENGTH: usize = 960;

fn main() {
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"))
        .join("fixed_array_access.rs");
    let mut generated = String::from("// Generated bounded array accessors for Rust-GPU/WGSL.\n");

    for length in [7usize, 8, 13, 18, 32, 64, CHUNKED_LENGTH] {
        push_array_impl(&mut generated, length);
    }

    fs::write(output, generated).expect("write fixed array accessors");
}

fn push_array_impl(generated: &mut String, length: usize) {
    generated.push_str(&format!(
        "impl<T: Copy> FixedArrayAccess for [T; {length}] {{\n"
    ));
    generated.push_str("    type Item = T;\n");
    generated.push_str("    #[inline(never)]\n    fn first(&self) -> T { self[0] }\n");
    if length == CHUNKED_LENGTH {
        push_chunked_method(generated, false);
        push_chunked_method(generated, true);
    } else {
        push_indexed_method(generated, length, false);
        push_indexed_method(generated, length, true);
    }
    generated.push_str("}\n");
}

fn push_chunked_method(generated: &mut String, write: bool) {
    if write {
        generated.push_str("    fn write_at(&mut self, index: usize, value: T) -> bool {\n");
    } else {
        generated.push_str("    fn read_at(&self, index: usize, output: &mut T) -> bool {\n");
    }
    generated.push_str(&format!(
        "        if index >= {CHUNKED_LENGTH} {{ return false; }}\n"
    ));
    if write {
        generated.push_str("        self[index] = value;\n");
    } else {
        generated.push_str("        *output = self[index];\n");
    }
    generated.push_str("        true\n    }\n");
}

fn push_indexed_method(generated: &mut String, length: usize, write: bool) {
    if write {
        generated.push_str("    #[inline(never)]\n    fn write_at(&mut self, index: usize, value: T) -> bool {\n        match index {\n");
    } else {
        generated.push_str("    #[inline(never)]\n    fn read_at(&self, index: usize, output: &mut T) -> bool {\n        match index {\n");
    }
    for index in 0..length {
        if write {
            generated.push_str(&format!(
                "            {index} => {{ self[{index}] = value; true }},\n"
            ));
        } else {
            generated.push_str(&format!(
                "            {index} => {{ *output = self[{index}]; true }},\n"
            ));
        }
    }
    generated.push_str("            _ => false,\n        }\n    }\n");
}
