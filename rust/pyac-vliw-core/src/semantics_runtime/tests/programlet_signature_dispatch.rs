use super::*;

const ROUTINE: u32 = 0x6123;
const ARGUMENT: u32 = 0x6124;
const OUTPUT: u32 = 0x6125;
const OTHER_ARGUMENT: u32 = 0x6126;
const INNER_ROUTINE: u32 = 0x6127;
const OUTER_ROUTINE: u32 = 0x6128;

fn typed_name(kind: u32, name: u32) -> [u32; 4] {
    [NAME_TYPE, kind, NAME_TYPE, name]
}

fn append_sentence_any(words: &mut std::vec::Vec<u32>, tokens: &[u32], boundaries: &[usize]) {
    for (chunk_index, chunk) in tokens.chunks(CODELET_WORDS - 1).enumerate() {
        let final_codelet = chunk_index + 1 == tokens.len().div_ceil(CODELET_WORDS - 1);
        let offset = chunk_index * (CODELET_WORDS - 1);
        let mut codelet = [0u32; CODELET_WORDS];
        codelet[0] = u32::from(final_codelet);
        codelet[1..chunk.len() + 1].copy_from_slice(chunk);
        for (slot, _) in chunk.iter().enumerate() {
            if boundaries.contains(&(offset + slot)) == final_codelet {
                codelet[0] |= 1 << (slot + 1);
            }
        }
        words.extend(codelet);
    }
}

fn append_overload(
    words: &mut std::vec::Vec<u32>,
    argument_type: u32,
    output_type: u32,
    return_value: &[u32],
) {
    append_definition(words, ROUTINE, ARGUMENT, argument_type, OUTPUT, output_type);
    let mut result = return_value.to_vec();
    result.extend([ACCUSATIVE, MOOD_RETURN]);
    let boundary = result.len() - 2;
    append_sentence(words, &result, &[boundary, boundary + 1]);
    append_close(words, ROUTINE);
}

fn append_definition(
    words: &mut std::vec::Vec<u32>,
    routine: u32,
    argument: u32,
    argument_type: u32,
    output: u32,
    output_type: u32,
) {
    let input = typed_name(argument_type, argument);
    let output_field = typed_name(output_type, output);
    let mut definition = std::vec![NAME_TYPE, routine, NOMINATIVE];
    definition.extend(input);
    definition.push(SOURCE);
    definition.extend(output_field);
    definition.extend([DESTINATION, CEREMONY, MOOD_DEFINITION]);
    append_sentence(words, &definition, &[2, 7, 12, 14]);
}

fn append_close(words: &mut std::vec::Vec<u32>, routine: u32) {
    append_sentence(
        words,
        &[NAME_TYPE, routine, NOMINATIVE, CEREMONY, MOOD_PARAGRAPH],
        &[2, 4],
    );
}

fn append_number_call(words: &mut std::vec::Vec<u32>, input: u32, kind: u32) {
    append_number_call_to(words, input, kind, ROUTINE);
}

fn append_number_call_to(words: &mut std::vec::Vec<u32>, input: u32, kind: u32, routine: u32) {
    let output = typed_name(kind, OUTPUT);
    let mut call = std::vec![NUMBER_QUOTE, input, SOURCE];
    call.extend(output);
    call.extend([DESTINATION, routine, DEONTIC]);
    append_sentence(words, &call, &[2, 7, 9]);
}

fn append_boolean_call(words: &mut std::vec::Vec<u32>, value: u32) {
    let output = typed_name(BOOLEAN_TYPE, OUTPUT);
    let mut call = std::vec![value, SOURCE];
    call.extend(output);
    call.extend([DESTINATION, ROUTINE, DEONTIC]);
    append_sentence(words, &call, &[1, 6, 8]);
}

fn run(words: &[u32]) -> CoreResult {
    let mut symbols = [0; MAX_PROGRAMLET_SYMBOL_WORDS];
    let mut frames = ProgramletStack::EMPTY;
    execute_numeric_programlet(
        words,
        words.len() / CODELET_WORDS,
        64,
        &mut symbols,
        &mut frames,
    )
}

#[test]
fn prepared_signature_directory_matches_in_interpreter_directory_build() {
    let mut words = std::vec::Vec::new();
    append_overload(&mut words, NUMBER_TYPE, NUMBER_TYPE, &[NUMBER_QUOTE, 41]);
    append_number_call(&mut words, 7, NUMBER_TYPE);
    let expected = run(&words);

    let mut directory = [0; PROGRAMLET_ROUTINE_DIRECTORY_WORDS];
    build_programlet_routine_directory_words(
        &words,
        0,
        words.len() / CODELET_WORDS,
        &mut directory,
    )
    .unwrap();
    let mut symbols = [0; MAX_PROGRAMLET_SYMBOL_WORDS];
    let mut frames = ProgramletStack::EMPTY;
    let prepared = execute_numeric_programlet_at_with_directory_words(
        &words,
        0,
        words.len() / CODELET_WORDS,
        64,
        &directory,
        0,
        &mut symbols,
        &mut frames,
    );
    assert_eq!(prepared.error, expected.error);
    assert_eq!(prepared.value_kind, expected.value_kind);
    assert_eq!(prepared.values, expected.values);

    directory[0] = 0;
    let malformed = execute_numeric_programlet_at_with_directory_words(
        &words,
        0,
        words.len() / CODELET_WORDS,
        64,
        &directory,
        0,
        &mut symbols,
        &mut frames,
    );
    assert_eq!(malformed.error, ERROR_MALFORMED);
}

#[test]
fn selects_overloads_by_typed_case_signature() {
    let mut number_words = std::vec::Vec::new();
    append_overload(&mut number_words, BOOLEAN_TYPE, BOOLEAN_TYPE, &[LIE]);
    append_overload(
        &mut number_words,
        NUMBER_TYPE,
        NUMBER_TYPE,
        &[NUMBER_QUOTE, 41],
    );
    append_number_call(&mut number_words, 7, NUMBER_TYPE);

    let number = run(&number_words);
    assert_eq!(number.error, 0, "{number:?}");
    assert_eq!(number.value_kind, VALUE_UNSIGNED);
    assert_eq!(number.values[0], 41);

    let mut wrong_output_words = std::vec::Vec::new();
    append_overload(
        &mut wrong_output_words,
        NUMBER_TYPE,
        NUMBER_TYPE,
        &[NUMBER_QUOTE, 41],
    );
    append_number_call(&mut wrong_output_words, 7, BOOLEAN_TYPE);
    assert_eq!(run(&wrong_output_words).error, ERROR_UNSUPPORTED);

    let mut boolean_words = std::vec::Vec::new();
    append_overload(&mut boolean_words, BOOLEAN_TYPE, BOOLEAN_TYPE, &[LIE]);
    append_overload(
        &mut boolean_words,
        NUMBER_TYPE,
        NUMBER_TYPE,
        &[NUMBER_QUOTE, 41],
    );
    append_boolean_call(&mut boolean_words, TRUTH);

    let boolean = run(&boolean_words);
    assert_eq!(boolean.error, 0, "{boolean:?}");
    assert_eq!(boolean.value_kind, VALUE_BOOLEAN);
    assert_eq!(boolean.values[0], 0);
}

#[test]
fn case_source_order_does_not_change_programlet_signature_lookup() {
    let input = typed_name(NUMBER_TYPE, ARGUMENT);
    let second = typed_name(NUMBER_TYPE, OTHER_ARGUMENT);
    let output = typed_name(NUMBER_TYPE, OUTPUT);
    let mut words = std::vec::Vec::new();
    let mut definition = std::vec![NAME_TYPE, ROUTINE, NOMINATIVE];
    definition.extend(input);
    definition.push(COMITATIVE);
    definition.extend(second);
    definition.push(SOURCE);
    definition.extend(output);
    definition.extend([DESTINATION, CEREMONY, MOOD_DEFINITION]);
    append_sentence_any(&mut words, &definition, &[2, 7, 12, 17, 19]);

    append_sentence(
        &mut words,
        &[NUMBER_QUOTE, 23, ACCUSATIVE, MOOD_RETURN],
        &[2, 3],
    );
    append_sentence(
        &mut words,
        &[NAME_TYPE, ROUTINE, NOMINATIVE, CEREMONY, MOOD_PARAGRAPH],
        &[2, 4],
    );
    let mut call = std::vec![NUMBER_QUOTE, 3, SOURCE, NUMBER_QUOTE, 4, COMITATIVE];
    call.extend(output);
    call.extend([DESTINATION, ROUTINE, DEONTIC]);
    append_sentence(&mut words, &call, &[2, 5, 10, 12]);

    let result = run(&words);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 23);
}

#[test]
fn nested_programlet_calls_use_the_same_signature_directory() {
    let mut words = std::vec::Vec::new();
    append_definition(
        &mut words,
        INNER_ROUTINE,
        ARGUMENT,
        NUMBER_TYPE,
        OUTPUT,
        NUMBER_TYPE,
    );
    append_sentence(
        &mut words,
        &[NUMBER_QUOTE, 31, ACCUSATIVE, MOOD_RETURN],
        &[2, 3],
    );
    append_close(&mut words, INNER_ROUTINE);

    append_definition(
        &mut words,
        OUTER_ROUTINE,
        OTHER_ARGUMENT,
        NUMBER_TYPE,
        OUTPUT,
        NUMBER_TYPE,
    );
    let mut nested_call = std::vec![NUMBER_QUOTE, 9, SOURCE];
    nested_call.extend(typed_name(NUMBER_TYPE, OUTPUT));
    nested_call.extend([DESTINATION, INNER_ROUTINE, DEONTIC]);
    append_sentence(&mut words, &nested_call, &[2, 7, 9]);
    append_sentence(
        &mut words,
        &[NAME_TYPE, OUTPUT, NOMINATIVE, MOOD_RETURN],
        &[2, 3],
    );
    append_close(&mut words, OUTER_ROUTINE);
    append_number_call_to(&mut words, 5, NUMBER_TYPE, OUTER_ROUTINE);

    let result = run(&words);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 31);
}

#[test]
fn rejects_missing_signatures_and_applies_latest_definition() {
    let mut missing = std::vec::Vec::new();
    append_overload(&mut missing, NUMBER_TYPE, NUMBER_TYPE, &[NUMBER_QUOTE, 41]);
    append_boolean_call(&mut missing, TRUTH);
    assert_eq!(run(&missing).error, ERROR_UNSUPPORTED);

    // Revision is latest-wins: the second definition of the same signature
    // replaces the first, so the call returns the newer body.
    let mut redefined = std::vec::Vec::new();
    append_overload(
        &mut redefined,
        NUMBER_TYPE,
        NUMBER_TYPE,
        &[NUMBER_QUOTE, 41],
    );
    append_overload(
        &mut redefined,
        NUMBER_TYPE,
        NUMBER_TYPE,
        &[NUMBER_QUOTE, 42],
    );
    append_number_call(&mut redefined, 7, NUMBER_TYPE);
    let result = run(&redefined);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 42);
}
