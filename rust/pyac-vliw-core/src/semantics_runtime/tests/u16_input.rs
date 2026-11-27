use super::*;

#[test]
fn interprets_packed_u16_codelets_without_changing_results() {
    let packed = [
        0x0149u16,
        NUMBER_QUOTE as u16,
        41,
        ACCUSATIVE as u16,
        NUMBER_QUOTE as u16,
        1,
        DESTINATION as u16,
        PLUS as u16,
        DEONTIC as u16,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let widened = packed.map(u32::from);

    let packed_result = interpret_group(&packed, 0, 1);
    let widened_result = interpret_group(&widened, 0, 1);

    assert_eq!(packed_result, widened_result);
    assert_eq!(packed_result.error, 0);
    assert_eq!(packed_result.values[0], 42);
}

#[test]
fn scans_section_headers_directly_from_packed_u16_words() {
    let mut wide_words = std::vec::Vec::new();
    append_test_section(&mut wide_words, 0x1111);
    append_test_section(&mut wide_words, 0x2222);
    let packed_words = wide_words
        .iter()
        .copied()
        .map(|word| u16::try_from(word).expect("VLIW input word fits u16"))
        .collect::<std::vec::Vec<_>>();
    let mut wide_sections = [ProgramletSection::EMPTY; MAX_PROGRAMLET_SECTIONS];
    let mut packed_sections = [ProgramletSection::EMPTY; MAX_PROGRAMLET_SECTIONS];

    let wide_count = scan_numeric_programlet_sections(
        &wide_words,
        wide_words.len() / CODELET_WORDS,
        &mut wide_sections,
    )
    .unwrap();
    let packed_count = scan_numeric_programlet_sections(
        &packed_words,
        packed_words.len() / CODELET_WORDS,
        &mut packed_sections,
    )
    .unwrap();

    assert_eq!(packed_count, wide_count);
    assert_eq!(packed_sections[..packed_count], wide_sections[..wide_count]);
}
