use super::*;

fn indexed_codelets(words: &[u32]) -> std::vec::Vec<[u32; CODELET_WORDS]> {
    let chunks = words.chunks(CODELET_WORDS - 1);
    let chunk_count = chunks.len();
    words
        .chunks(CODELET_WORDS - 1)
        .enumerate()
        .map(|(index, chunk)| {
            let mut codelet = [0u32; CODELET_WORDS];
            codelet[0] = u32::from(index + 1 == chunk_count);
            codelet[1..chunk.len() + 1].copy_from_slice(chunk);
            codelet
        })
        .collect()
}

#[test]
fn scans_named_programlet_sections_as_independent_body_ranges() {
    let mut words = std::vec::Vec::new();
    append_test_section(&mut words, 0x1111);
    append_test_section(&mut words, 0x2222);
    let mut sections = [ProgramletSection::EMPTY; MAX_PROGRAMLET_SECTIONS];

    let count =
        scan_numeric_programlet_sections(&words, words.len() / CODELET_WORDS, &mut sections)
            .unwrap();

    assert_eq!(count, 2);
    assert_eq!(sections[0].codelet_start, 1);
    assert_eq!(sections[0].codelet_count, 1);
    assert_eq!(sections[0].name_length, 1);
    assert_eq!(sections[0].name_words[0], 0x1111);
    assert_eq!(sections[1].codelet_start, 4);
    assert_eq!(sections[1].codelet_count, 1);
    assert_eq!(sections[1].name_words[0], 0x2222);
}

#[test]
fn rejects_duplicate_or_mismatched_programlet_section_names() {
    let mut duplicate = std::vec::Vec::new();
    append_test_section(&mut duplicate, 0x1111);
    append_test_section(&mut duplicate, 0x1111);
    let mut sections = [ProgramletSection::EMPTY; MAX_PROGRAMLET_SECTIONS];
    assert_eq!(
        scan_numeric_programlet_sections(
            &duplicate,
            duplicate.len() / CODELET_WORDS,
            &mut sections,
        ),
        Err(ERROR_MALFORMED)
    );

    let mut mismatched = std::vec::Vec::new();
    append_test_section(&mut mismatched, 0x1111);
    let close = mismatched.len() - CODELET_WORDS;
    mismatched[close + 2] = 0x2222;
    assert_eq!(
        scan_numeric_programlet_sections(
            &mismatched,
            mismatched.len() / CODELET_WORDS,
            &mut sections,
        ),
        Err(ERROR_MALFORMED)
    );
}

#[test]
fn executes_numeric_operator_family_with_shared_saturating_semantics() {
    for (operator, left, right, expected) in [
        (PLUS, 65_535, 1, 65_535),
        (SUBTRACT, 9, 4, 5),
        (MULTIPLY, 65_535, 65_535, 4_294_836_225),
        (DIVIDE, 8, 2, 4),
        (XOR, 7, 3, 4),
        (EXPONENTIAL, 3, 4, 81),
        (REMAINS, 9, 4, 1),
    ] {
        let codelet = [
            0x0149,
            NUMBER_QUOTE,
            left,
            ACCUSATIVE,
            NUMBER_QUOTE,
            right,
            DESTINATION,
            operator,
            DEONTIC,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ];
        let result = interpret(&[codelet]);
        assert_eq!(result.error, 0, "operator 0x{operator:04x}");
        assert_eq!(result.value_kind, VALUE_UNSIGNED);
        assert_eq!(result.values[0], expected);
    }
}

#[test]
fn executes_f32_literals_and_scalar_arithmetic() {
    fn quote(value: f32) -> [u32; 3] {
        let bits = value.to_bits();
        [0xd01d, bits & 0xffff, bits >> 16]
    }

    let left = quote(0.1);
    let right = quote(0.2);
    let arithmetic = [
        0x0511,
        left[0],
        left[1],
        left[2],
        ACCUSATIVE,
        right[0],
        right[1],
        right[2],
        DESTINATION,
        PLUS,
        DEONTIC,
        0,
        0,
        0,
        0,
        0,
    ];
    let result = interpret(&[arithmetic]);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT32);
    assert_eq!(result.values[0], (0.1f32 + 0.2f32).to_bits());

    let bits = 1.25f32.to_bits();
    let literal = [
        0x0031,
        0xd01d,
        bits & 0xffff,
        bits >> 16,
        ACCUSATIVE,
        REALIS,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let result = interpret(&[literal]);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT32);
    assert_eq!(result.values[0], 1.25f32.to_bits());
}

#[test]
fn executes_f32_and_f64_vector_literals_in_the_shared_core() {
    let f32_values = [1.25f32.to_bits(), (-0.5f32).to_bits()];
    let f32_vector = [
        0x00c1,
        0xd11d,
        f32_values[0] & 0xffff,
        f32_values[0] >> 16,
        f32_values[1] & 0xffff,
        f32_values[1] >> 16,
        ACCUSATIVE,
        REALIS,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let result = interpret(&[f32_vector]);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT32);
    assert_eq!(result.length, 2);
    assert_eq!(&result.values[..2], &f32_values);

    let f64_values = [std::f64::consts::PI.to_bits(), (-0.0f64).to_bits()];
    let f64_vector = [
        0x0c01,
        0xd91d,
        f64_values[0] as u32 & 0xffff,
        f64_values[0] as u32 >> 16,
        (f64_values[0] >> 32) as u32 & 0xffff,
        (f64_values[0] >> 48) as u32,
        f64_values[1] as u32 & 0xffff,
        f64_values[1] as u32 >> 16,
        (f64_values[1] >> 32) as u32 & 0xffff,
        (f64_values[1] >> 48) as u32,
        ACCUSATIVE,
        REALIS,
        0,
        0,
        0,
        0,
    ];
    let result = interpret(&[f64_vector]);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT64);
    assert_eq!(result.length, 2);
    assert_eq!(
        &result.values[..4],
        &[
            f64_values[0] as u32,
            (f64_values[0] >> 32) as u32,
            f64_values[1] as u32,
            (f64_values[1] >> 32) as u32,
        ]
    );
}

#[test]
fn executes_max_width_float_vectors_across_indexed_codelets() {
    let f32_bits = (1..=16)
        .map(|value| (value as f32 + 0.25).to_bits())
        .collect::<std::vec::Vec<_>>();
    let mut f32_words = std::vec![0xd41d];
    f32_words.extend(f32_bits.iter().flat_map(|bits| [bits & 0xffff, bits >> 16]));
    f32_words.extend([ACCUSATIVE, REALIS]);
    let f32_codelets = indexed_codelets(&f32_words);
    let result = interpret(&f32_codelets);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT32);
    assert_eq!(result.length, 16);
    assert_eq!(&result.values[..16], f32_bits.as_slice());

    let f64_bits = (1..=16)
        .map(|value| (value as f64 + 0.125).to_bits())
        .collect::<std::vec::Vec<_>>();
    let mut f64_words = std::vec![0xdc1d];
    f64_words.extend(f64_bits.iter().flat_map(|bits| {
        [
            *bits as u16 as u32,
            (*bits >> 16) as u16 as u32,
            (*bits >> 32) as u16 as u32,
            (*bits >> 48) as u16 as u32,
        ]
    }));
    f64_words.extend([ACCUSATIVE, REALIS]);
    let f64_codelets = indexed_codelets(&f64_words);
    let result = interpret(&f64_codelets);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT64);
    assert_eq!(result.length, 16);
    for (index, bits) in f64_bits.iter().enumerate() {
        assert_eq!(result.values[index * 2], *bits as u32);
        assert_eq!(result.values[index * 2 + 1], (*bits >> 32) as u32);
    }
}

#[test]
fn executes_explicit_six_lane_float_vector_from_its_length_word() {
    let mut words = std::vec![0xd61d, 6];
    let values = [1.0f32, 2.0, 3.0, 4.0, 5.0, 6.0].map(f32::to_bits);
    words.extend(values.iter().flat_map(|bits| [bits & 0xffff, bits >> 16]));
    words.extend([ACCUSATIVE, REALIS]);
    let codelets = indexed_codelets(&words);
    let result = interpret(&codelets);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT32);
    assert_eq!(result.length, 6);
    assert_eq!(&result.values[..6], &values);
    assert_eq!(result.consumed_codelets, codelets.len() as u32);
}

#[test]
fn rejects_explicit_vector_width_above_the_execution_limit() {
    let mut words = std::vec![0xd61d, 17];
    words.extend(std::iter::repeat_n(0, 17 * 2));
    words.extend([ACCUSATIVE, REALIS]);
    let result = interpret(&indexed_codelets(&words));
    assert_eq!(result.error, ERROR_VECTOR_WIDTH);
}

#[test]
fn rejects_non_finite_values_in_float_vectors() {
    let f32_nan = [
        0x00c1, 0xd11d, 0, 0x7f80, 0, 0, ACCUSATIVE, REALIS, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    assert_eq!(interpret(&[f32_nan]).error, ERROR_FLOAT_DOMAIN);

    let f64_infinity = [
        0x0c01, 0xd91d, 0, 0, 0, 0x7ff0, 0, 0, 0, 0, ACCUSATIVE, REALIS, 0, 0, 0, 0,
    ];
    assert_eq!(interpret(&[f64_infinity]).error, ERROR_FLOAT_DOMAIN);
}

#[test]
fn executes_fixed16_literals_and_scalar_arithmetic() {
    fn arithmetic(left: u32, right: u32, operator: u32) -> [u32; CODELET_WORDS] {
        [
            0x0149,
            0xc81d,
            left,
            ACCUSATIVE,
            0xc81d,
            right,
            DESTINATION,
            operator,
            DEONTIC,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ]
    }

    for (operator, left, right, expected) in [
        (PLUS, 23_328, 11_664, 34_992),
        (SUBTRACT, 23_328, 11_664, 11_664),
        (MULTIPLY, 23_328, 23_328, 11_664),
        (DIVIDE, 23_328, 23_328, 46_656),
    ] {
        let result = interpret(&[arithmetic(left, right, operator)]);
        assert_eq!(result.error, 0, "operator 0x{operator:04x}: {result:?}");
        assert_eq!(result.value_kind, VALUE_FIXED16);
        assert_eq!(result.values[0], expected);
    }

    let literal = [
        0x0019, 0xc81d, 23_328, ACCUSATIVE, REALIS, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    let result = interpret(&[literal]);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FIXED16);
    assert_eq!(result.values[0], 23_328);
}

#[test]
fn fixed16_rounds_ties_to_even_and_reports_range_errors() {
    fn arithmetic(left: u32, right: u32, operator: u32) -> [u32; CODELET_WORDS] {
        [
            0x0149,
            0xc81d,
            left,
            ACCUSATIVE,
            0xc81d,
            right,
            DESTINATION,
            operator,
            DEONTIC,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ]
    }

    for (left, right, expected) in [(1, 23_328, 0), (3, 23_328, 2)] {
        let result = interpret(&[arithmetic(left, right, MULTIPLY)]);
        assert_eq!(result.error, 0, "{result:?}");
        assert_eq!(result.values[0], expected);
    }
    for (left, right, expected) in [(1, 128, 364), (3, 128, 1_094)] {
        let result = interpret(&[arithmetic(left, right, DIVIDE)]);
        assert_eq!(result.error, 0, "{result:?}");
        assert_eq!(result.values[0], expected);
    }

    let overflow = interpret(&[arithmetic(u16::MAX.into(), 1, PLUS)]);
    assert_eq!(overflow.error, ERROR_FIXED16_DOMAIN);
    let underflow = interpret(&[arithmetic(0, 1, SUBTRACT)]);
    assert_eq!(underflow.error, ERROR_FIXED16_DOMAIN);
    let division_by_zero = interpret(&[arithmetic(1, 0, DIVIDE)]);
    assert_eq!(division_by_zero.error, ERROR_DIVISION_BY_ZERO);
}

#[test]
fn rejects_non_finite_f32_literals_and_results() {
    let infinity = [
        0x0031, 0xd01d, 0, 0x7f80, ACCUSATIVE, REALIS, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    let result = interpret(&[infinity]);
    assert_eq!(result.error, ERROR_FLOAT_DOMAIN, "{result:?}");

    let max = f32::MAX.to_bits();
    let max_quote = [0xd01d, max & 0xffff, max >> 16];
    let two = 2.0f32.to_bits();
    let two_quote = [0xd01d, two & 0xffff, two >> 16];
    let overflow = [
        0x0511,
        max_quote[0],
        max_quote[1],
        max_quote[2],
        ACCUSATIVE,
        two_quote[0],
        two_quote[1],
        two_quote[2],
        DESTINATION,
        MULTIPLY,
        DEONTIC,
        0,
        0,
        0,
        0,
        0,
    ];
    let result = interpret(&[overflow]);
    assert_eq!(result.error, ERROR_FLOAT_DOMAIN, "{result:?}");
}

#[test]
fn executes_invert_date_and_numeric_vector_literals() {
    let invert = [
        0x0149,
        NUMBER_QUOTE,
        5,
        ACCUSATIVE,
        NUMBER_QUOTE,
        0,
        DATIVE,
        INVERT,
        DEONTIC,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let date = [
        0x00c1, DATE_QUOTE, 0x9c00, 0x8924, 0x0196, 0, ACCUSATIVE, REALIS, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    let vector = [
        0x0061, 0x8f1d, 1, 2, 3, ACCUSATIVE, REALIS, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];

    let result = interpret(&[invert]);
    assert_eq!(result.value_kind, VALUE_SIGNED);
    assert_eq!(result.values[0], (-5i32) as u32);

    let result = interpret(&[date]);
    assert_eq!(result.value_kind, VALUE_DATE);
    assert_eq!(result.values[0], 1_746_057_600_000u64 as u32);
    assert_eq!(result.values[1], (1_746_057_600_000u64 >> 32) as u32);

    let result = interpret(&[vector]);
    assert_eq!(result.value_kind, VALUE_VECTOR_U16);
    assert_eq!(result.length, 3);
    assert_eq!(&result.values[..3], &[1, 2, 3]);
}

#[test]
fn executes_inline_vector_arithmetic_and_bounded_equality_branch() {
    let vector = [
        0x0a41,
        0x8a1d,
        1,
        2,
        3,
        4,
        ACCUSATIVE,
        NUMBER_QUOTE,
        2,
        DESTINATION,
        PLUS,
        DEONTIC,
        0,
        0,
        0,
        0,
    ];
    let branch = [
        [
            0xd6b6,
            NUMBER_QUOTE,
            5,
            ACCUSATIVE,
            NUMBER_QUOTE,
            5,
            SOURCE,
            EQUALLY,
            CONDITIONAL,
            NUMBER_QUOTE,
            7,
            ACCUSATIVE,
            NUMBER_VERB,
            REALIS,
            NUMBER_QUOTE,
            9,
        ],
        [
            0x000b,
            ACCUSATIVE,
            NUMBER_VERB,
            REALIS,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ],
    ];

    let result = interpret(&[vector]);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_VECTOR_U16);
    assert_eq!(&result.values[..4], &[3, 4, 5, 6]);

    let result = interpret(&branch);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_UNSIGNED);
    assert_eq!(result.values[0], 7);
    assert_eq!(result.consumed_codelets, 2);
}

#[test]
fn returns_typed_pyash_boolean_literals() {
    let truth = [
        0x0015,
        0x6909,
        ACCUSATIVE,
        NUMBER_VERB,
        REALIS,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let lie = [
        0x0015,
        0x680d,
        ACCUSATIVE,
        NUMBER_VERB,
        REALIS,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];

    let result = interpret(&[truth]);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 1);

    let result = interpret(&[lie]);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 0);

    let boolean_verb = [
        0x0015,
        TRUTH,
        ACCUSATIVE,
        BOOLEAN_VERB,
        REALIS,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let result = interpret(&[boolean_verb]);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 1);
}
