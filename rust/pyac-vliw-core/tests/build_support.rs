#[path = "../build_support.rs"]
mod build_support;

#[test]
fn eight_element_accessor_uses_bounded_dynamic_indexing() {
    assert_dynamic_accessor(8);
}

#[test]
fn local_slot_accessor_uses_bounded_dynamic_indexing() {
    assert_dynamic_accessor(64);
}

#[test]
fn flattened_frame_accessors_use_bounded_dynamic_indexing() {
    assert_dynamic_accessor(256);
    assert_dynamic_accessor(512);
}

#[test]
fn large_persistent_word_pool_uses_guarded_unchecked_gpu_indexing() {
    let generated = build_support::generate_fixed_array_accessors();
    let array = generated
        .split("impl<T: Copy> FixedArrayAccess for [T; 960] {")
        .nth(1)
        .unwrap()
        .split("\nimpl<T: Copy>")
        .next()
        .unwrap();
    assert!(array.contains("if index >= 960 { return false; }"));
    assert!(array.contains("IndexUnchecked<T>"));
    assert!(array.contains("index_unchecked(self, index)"));
    assert!(array.contains("index_unchecked_mut(self, index)"));
}

fn assert_dynamic_accessor(length: usize) {
    let generated = build_support::generate_fixed_array_accessors();
    let marker = format!("impl<T: Copy> FixedArrayAccess for [T; {length}] {{");
    let array = generated
        .split(&marker)
        .nth(1)
        .unwrap()
        .split("\nimpl<T: Copy>")
        .next()
        .unwrap();
    assert!(array.contains(&format!("if index >= {length} {{ return false; }}")));
    assert!(array.contains("spirv_std::arch::IndexUnchecked<T>"));
    assert!(array.contains("index_unchecked(self, index)"));
    assert!(!array.contains("match index"));
}

#[test]
fn other_small_arrays_keep_their_indexed_accessor() {
    let generated = build_support::generate_fixed_array_accessors();
    let array_seven = generated
        .split("impl<T: Copy> FixedArrayAccess for [T; 7] {")
        .nth(1)
        .unwrap()
        .split("\nimpl<T: Copy>")
        .next()
        .unwrap();
    assert!(array_seven.contains("match index"));
    assert!(!array_seven.contains("self[index]"));
}

#[test]
fn signature_dispatch_arrays_have_bounded_indexed_accessors() {
    let generated = build_support::generate_fixed_array_accessors();
    for length in [2, 9, 10, 12] {
        let marker = format!("impl<T: Copy> FixedArrayAccess for [T; {length}] {{");
        let array = generated
            .split(&marker)
            .nth(1)
            .unwrap()
            .split("\nimpl<T: Copy>")
            .next()
            .unwrap();
        assert!(array.contains("match index"));
        assert!(array.contains(&format!(
            "{length_minus_one} =>",
            length_minus_one = length - 1
        )));
        assert!(!array.contains("IndexUnchecked"));
    }
}
