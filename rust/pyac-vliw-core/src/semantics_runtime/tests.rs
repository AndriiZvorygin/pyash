use super::*;

#[test]
fn fixed_array_accessors_reject_out_of_bounds_indices() {
    let mut values = [11u32, 12, 13, 14, 15, 16, 17];
    let mut read = 0;

    assert!(values.read_at(6, &mut read));
    assert_eq!(read, 17);
    assert!(!values.read_at(7, &mut read));
    assert!(values.write_at(0, 21));
    assert_eq!(values[0], 21);
    assert!(!values.write_at(7, 99));
    assert_eq!(values[6], 17);
}

#[test]
fn codelet_word_reads_reject_out_of_bounds_without_panicking() {
    let mut words = [0u32; CODELET_WORDS];
    words[1] = 0x5678;

    assert_eq!(word(&words, 0, 1), 0x5678);
    assert_eq!(word(&words, 1, 0), u32::MAX);
    assert_eq!(word(&words, usize::MAX, usize::MAX), u32::MAX);
}

#[test]
fn scratch_array_accessors_use_bounded_dynamic_indices() {
    let mut values = [0u32; MAX_PROGRAMLET_SYMBOL_WORDS];
    let last = MAX_PROGRAMLET_SYMBOL_WORDS - 1;
    let mut read = 17;

    assert!(values.write_at(last, 99));
    assert!(values.read_at(last, &mut read));
    assert_eq!(read, 99);
    assert!(!values.read_at(MAX_PROGRAMLET_SYMBOL_WORDS, &mut read));
    assert_eq!(read, 99);
    assert!(!values.write_at(MAX_PROGRAMLET_SYMBOL_WORDS, 101));
    assert_eq!(values[last], 99);
}

fn append_sentence(words: &mut std::vec::Vec<u32>, tokens: &[u32], boundaries: &[usize]) {
    assert!(tokens.len() < CODELET_WORDS);
    let mut codelet = [0u32; CODELET_WORDS];
    codelet[0] = 1;
    for token_index in boundaries {
        codelet[0] |= 1 << (token_index + 1);
    }
    codelet[1..=tokens.len()].copy_from_slice(tokens);
    words.extend(codelet);
}

fn append_test_section(words: &mut std::vec::Vec<u32>, name: u32) {
    append_sentence(
        words,
        &[
            NAME_TYPE,
            name,
            NOMINATIVE,
            SECTION_MODULE,
            SECTION_PART,
            MOOD_DEFINITION,
        ],
        &[2, 5],
    );
    append_sentence(
        words,
        &[
            NAME_TYPE,
            0x4321,
            NOMINATIVE,
            NAME_TYPE,
            NUMBER_TYPE,
            NAME_TYPE,
            0x5678,
            DESTINATION,
            CEREMONY,
            MOOD_DEFINITION,
        ],
        &[2, 7, 9],
    );
    append_sentence(
        words,
        &[
            NAME_TYPE,
            name,
            NOMINATIVE,
            SECTION_MODULE,
            SECTION_PART,
            MOOD_PARAGRAPH,
        ],
        &[2, 5],
    );
}

fn interpret(codelets: &[[u32; CODELET_WORDS]]) -> CoreResult {
    let words = codelets
        .iter()
        .flat_map(|codelet| codelet.iter().copied())
        .collect::<std::vec::Vec<_>>();
    interpret_group(&words, 0, codelets.len())
}

#[path = "tests/basic.rs"]
mod basic;
#[path = "tests/iwsp_vector_ops.rs"]
mod iwsp_vector_ops;
#[path = "tests/pluk_tlas.rs"]
mod pluk_tlas;
#[path = "tests/programlet.rs"]
mod programlet;
#[path = "tests/programlet_signature_dispatch.rs"]
mod programlet_signature_dispatch;
#[path = "tests/programlet_vectors.rs"]
mod programlet_vectors;
#[path = "tests/scalar_product.rs"]
mod scalar_product;
#[path = "tests/u16_input.rs"]
mod u16_input;
