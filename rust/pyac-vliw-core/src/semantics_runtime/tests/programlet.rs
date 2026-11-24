use super::*;

#[test]
fn programlet_call_control_record_stays_compact_at_full_depth() {
    assert_eq!(MAX_PROGRAMLET_CALL_DEPTH, 8);
    assert!(core::mem::size_of::<ProgramletFrame>() <= 128);
}

#[test]
fn argument_lookup_returns_the_matching_value_or_empty() {
    let mut arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    arguments[5] = ProgramletArgument {
        role: 0x1234,
        value: 17,
        value_high: 29,
        value_kind: VALUE_FLOAT64,
        ..ProgramletArgument::EMPTY
    };

    let value = argument_value(arguments, 0x1234);
    assert_eq!(value.bits, 17);
    assert_eq!(value.high, 29);
    assert_eq!(value.kind, VALUE_FLOAT64);

    let missing = argument_value(arguments, 0x4321);
    assert_eq!(missing.kind, 0);
}

#[test]
fn loop_register_updates_its_reserved_slot_and_checks_capacity() {
    let mut arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    arguments[2] = ProgramletArgument {
        role: FROM_INDEX,
        value: 3,
        value_high: 9,
        value_kind: VALUE_SIGNED,
        ..ProgramletArgument::EMPTY
    };
    arguments[5] = ProgramletArgument {
        role: FROM_INDEX,
        value: 4,
        ..ProgramletArgument::EMPTY
    };

    set_loop_register_argument(&mut arguments, 2, FROM_INDEX, 17).unwrap();
    assert_eq!(arguments[2].value, 17);
    assert_eq!(arguments[2].value_high, 9);
    assert_eq!(arguments[2].value_kind, VALUE_UNSIGNED);
    assert_eq!(arguments[5].value, 4);

    set_loop_register_argument(&mut arguments, 3, TO_INDEX, 23).unwrap();
    assert_eq!(arguments[3].role, TO_INDEX);
    assert_eq!(arguments[3].value, 23);
    assert_eq!(
        set_loop_register_argument(&mut arguments, MAX_PROGRAMLET_ARGUMENTS, TO_INDEX, 1),
        Err(ERROR_FRAME_CAPACITY)
    );
}

#[test]
fn name_span_handles_compact_and_typed_fields_and_rejects_marker_collisions() {
    let mut words = std::vec::Vec::new();
    append_sentence(&mut words, &[NAME_TYPE, 0x1234], &[2]);
    let view = SentenceView::new(&words, 0, 2);
    let mut name = NameSpan::EMPTY;
    assert_eq!(
        name_span(
            &view,
            SentenceField {
                role: NOMINATIVE,
                start: 0,
                length: 2,
            },
            false,
            &mut name,
        ),
        0
    );
    assert_eq!(name.start, 1);
    assert_eq!(name.length, 1);

    let mut typed_words = std::vec::Vec::new();
    append_sentence(
        &mut typed_words,
        &[NAME_TYPE, NUMBER_TYPE, NAME_TYPE, 0x5678],
        &[4],
    );
    let typed_view = SentenceView::new(&typed_words, 0, 4);
    assert_eq!(
        name_span(
            &typed_view,
            SentenceField {
                role: NOMINATIVE,
                start: 0,
                length: 4,
            },
            true,
            &mut name,
        ),
        0
    );
    assert_eq!(name.start, 3);
    assert_eq!(name.length, 1);

    let mut collision_words = std::vec::Vec::new();
    append_sentence(
        &mut collision_words,
        &[NAME_TYPE, 0x2468, NAME_TYPE, 0x1357],
        &[4],
    );
    let collision_view = SentenceView::new(&collision_words, 0, 4);
    assert_eq!(
        name_span(
            &collision_view,
            SentenceField {
                role: NOMINATIVE,
                start: 0,
                length: 4,
            },
            false,
            &mut name,
        ),
        ERROR_MALFORMED
    );
}

#[test]
fn typed_name_span_decodes_scalar_vector_and_untyped_field_layouts() {
    let mut scalar_words = std::vec::Vec::new();
    append_sentence(
        &mut scalar_words,
        &[NAME_TYPE, NUMBER_TYPE, NAME_TYPE, 0x1234],
        &[4],
    );
    let scalar_view = SentenceView::new(&scalar_words, 0, 4);
    let mut name = NameSpan::EMPTY;
    let mut kind = 0;
    assert_eq!(
        typed_name_span(
            &scalar_view,
            SentenceField {
                role: NOMINATIVE,
                start: 0,
                length: 4
            },
            &mut name,
            &mut kind,
        ),
        0
    );
    assert_eq!(kind, VALUE_NUMBER);
    assert_eq!((name.start, name.length), (3, 1));

    let mut vector_words = std::vec::Vec::new();
    append_sentence(
        &mut vector_words,
        &[NAME_TYPE, VECTOR_TYPE, FLOAT_TYPE, NAME_TYPE, 0x5678],
        &[5],
    );
    let vector_view = SentenceView::new(&vector_words, 0, 5);
    assert_eq!(
        typed_name_span(
            &vector_view,
            SentenceField {
                role: NOMINATIVE,
                start: 0,
                length: 5
            },
            &mut name,
            &mut kind,
        ),
        0
    );
    assert_eq!(kind, VALUE_VECTOR_FLOAT);
    assert_eq!((name.start, name.length), (4, 1));

    let mut plain_words = std::vec::Vec::new();
    append_sentence(&mut plain_words, &[NAME_TYPE, 0x9abc], &[2]);
    let plain_view = SentenceView::new(&plain_words, 0, 2);
    assert_eq!(
        typed_name_span(
            &plain_view,
            SentenceField {
                role: NOMINATIVE,
                start: 0,
                length: 2
            },
            &mut name,
            &mut kind,
        ),
        0
    );
    assert_eq!(kind, 0);
    assert_eq!((name.start, name.length), (1, 1));
}

#[test]
fn frame_rows_borrow_nested_backing_with_checked_frame_bounds() {
    let mut backing =
        [[NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS]; MAX_PROGRAMLET_CALL_DEPTH];
    let value = NumericLocalSlot {
        value: 42,
        ..NumericLocalSlot::EMPTY
    };
    assert!(frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(
        &backing, 3
    ));
    let row = frame_row_mut::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(&mut backing, 3);
    array_put!(row, 7, value);
    assert_eq!(array_at!(row, 7).value, 42);
    assert!(frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(
        &backing, 3
    ));
    assert!(!frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(
        &backing,
        MAX_PROGRAMLET_CALL_DEPTH
    ));
    assert!(!frame_row_is_valid::<_, _, MAX_PROGRAMLET_LOCAL_SLOTS>(
        &backing,
        MAX_PROGRAMLET_CALL_DEPTH
    ));
    assert_eq!(backing[3][7].value, 42);
}

#[test]
fn finds_the_final_programlet_sentence_from_codelet_headers() {
    let words: [u32; 32] = [
        1 | (1 << 2),
        0x1234,
        0x5678,
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
        0,
        1 | (1 << 2),
        0x2468,
        0x1357,
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
        0,
    ];

    assert_eq!(last_programlet_sentence_start(&words, 0, 2), Ok(1));
}

#[test]
fn sentence_view_reads_continuations_and_boundaries_in_place() {
    let source = (0..20)
        .map(|value| 0x1000 + value)
        .collect::<std::vec::Vec<_>>();
    let mut words = [0u32; CODELET_WORDS].to_vec();
    let boundaries = [2usize, 14, 19];
    for (codelet_index, chunk) in source.chunks(CODELET_WORDS - 1).enumerate() {
        let final_codelet = codelet_index + 1 == source.len().div_ceil(CODELET_WORDS - 1);
        let mut codelet = [0u32; CODELET_WORDS];
        codelet[0] = u32::from(final_codelet);
        for (slot, token) in chunk.iter().copied().enumerate() {
            codelet[slot + 1] = token;
            let logical_index = codelet_index * (CODELET_WORDS - 1) + slot;
            if boundaries.contains(&logical_index) == final_codelet {
                codelet[0] |= 1 << (slot + 1);
            }
        }
        words.extend(codelet);
    }

    let (token_count, next) = collect_sentence_at(&words, 3, 1, 2, 0)
        .expect("two-codelet sentence collects from a page offset");
    let view = SentenceView::new(&words, 1, token_count);
    assert_eq!(next, 2);
    assert_eq!(view.len(), source.len());
    for (index, token) in source.iter().copied().enumerate() {
        assert_eq!(view.token(index), Some(token));
        assert_eq!(view.token_unchecked(index), token);
        assert_eq!(view.boundary(index), boundaries.contains(&index));
        assert_eq!(view.boundary_unchecked(index), boundaries.contains(&index));
    }
    assert_eq!(view.token(source.len()), None);
    assert_eq!(view.token_or_first(source.len()), source[0]);
    assert!(!view.boundary(source.len()));
    assert_eq!(SentenceView::new(&words, 1, 0).token_or_first(0), 0);

    let borrowed_tail_start = view.word_index(13);
    assert!(view.word_span_is_valid(borrowed_tail_start, 7));
    assert_eq!(
        (0..7)
            .map(|index| view.word_at_word_index(borrowed_tail_start, index))
            .collect::<std::vec::Vec<_>>(),
        source[13..]
    );
}

#[test]
fn sentence_parser_rejects_duplicate_top_level_case_roles() {
    let mut words = [0u32; CODELET_WORDS];
    let tokens = [
        0x1234, NOMINATIVE, 0x2345, ACCUSATIVE, 0x3456, NOMINATIVE, 0x4567, REALIS,
    ];
    words[0] = 1 | (1 << 2) | (1 << 4) | (1 << 6) | (1 << 8);
    words[1..=tokens.len()].copy_from_slice(&tokens);

    let view = SentenceView::new(&words, 0, tokens.len());
    let mut parsed = ParsedSentence::empty();
    assert_eq!(parse_sentence(&view, &mut parsed), ERROR_MALFORMED);
}

#[test]
fn rejects_incomplete_or_malformed_programlet_sentence_headers() {
    let incomplete = [0u32; CODELET_WORDS];
    assert_eq!(
        last_programlet_sentence_start(&incomplete, 0, 1),
        Err(ERROR_MALFORMED)
    );

    let malformed = [1u32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    assert_eq!(
        last_programlet_sentence_start(&malformed, 0, 1),
        Err(ERROR_MALFORMED)
    );

    let out_of_range = [
        1u32 | (1 << 1),
        65_536,
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
        0,
        0,
    ];
    assert_eq!(
        last_programlet_sentence_start(&out_of_range, 0, 1),
        Err(ERROR_MALFORMED)
    );
}

#[path = "programlet_conditionals.rs"]
mod conditionals;
