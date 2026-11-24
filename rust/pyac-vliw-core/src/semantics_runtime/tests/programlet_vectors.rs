use super::*;

const SOFTMAX_NAME: [u32; 2] = [0x2b73, 0x6844];
const LOGITS_NAME: u32 = 0xa8a0;
const ANSWER_NAME: u32 = 0x4930;
const MAXIMUM_NAME: u32 = 0xaa90;
const SHIFTED_NAME: u32 = 0x6844;
const EXPONENTIALS_NAME: u32 = 0x2b73;
const DENOMINATOR_NAME: u32 = 0xaa90;
const ANSWER_ROUTINE: u32 = 0x4930;

fn append_sentence(words: &mut std::vec::Vec<u32>, tokens: &[u32], boundaries: &[usize]) {
    for (index, chunk) in tokens.chunks(CODELET_WORDS - 1).enumerate() {
        let final_codelet = index + 1 == tokens.len().div_ceil(CODELET_WORDS - 1);
        let mut codelet = [0u32; CODELET_WORDS];
        codelet[0] = u32::from(final_codelet);
        let offset = index * (CODELET_WORDS - 1);
        codelet[1..chunk.len() + 1].copy_from_slice(chunk);
        for (slot, _) in chunk.iter().enumerate() {
            if boundaries.contains(&(offset + slot)) == final_codelet {
                codelet[0] |= 1 << (slot + 1);
            }
        }
        words.extend(codelet);
    }
}

fn typed_name(kind: &[u32], name: &[u32]) -> std::vec::Vec<u32> {
    let mut field = std::vec![NAME_TYPE];
    field.extend_from_slice(kind);
    field.push(NAME_TYPE);
    field.extend_from_slice(name);
    field
}

fn append_softmax_program(words: &mut std::vec::Vec<u32>, mut invocation: std::vec::Vec<u32>) {
    let mut definition = std::vec![NAME_TYPE];
    definition.extend(SOFTMAX_NAME);
    definition.push(NOMINATIVE);
    definition.extend(typed_name(&[VECTOR_TYPE, FLOAT_TYPE], &[LOGITS_NAME]));
    definition.push(SOURCE);
    definition.extend(typed_name(&[VECTOR_TYPE, FLOAT_TYPE], &[ANSWER_NAME]));
    definition.push(DESTINATION);
    definition.extend([CEREMONY, MOOD_DEFINITION]);
    let definition_boundaries = [3, 9, 15, 17];
    append_sentence(words, &definition, &definition_boundaries);

    let mut maximum = std::vec![NAME_TYPE, LOGITS_NAME, SOURCE];
    maximum.extend(typed_name(&[FLOAT_TYPE], &[MAXIMUM_NAME]));
    maximum.push(DESTINATION);
    maximum.extend([0xa9b2, 0xa831, DEONTIC]);
    let maximum_boundaries = [2, 7, 10];
    append_sentence(words, &maximum, &maximum_boundaries);

    let subtract = [
        NAME_TYPE,
        LOGITS_NAME,
        SOURCE,
        NAME_TYPE,
        MAXIMUM_NAME,
        COMITATIVE,
        NAME_TYPE,
        VECTOR_TYPE,
        FLOAT_TYPE,
        NAME_TYPE,
        SHIFTED_NAME,
        DESTINATION,
        0xabd2,
        DEONTIC,
    ];
    append_sentence(words, &subtract, &[2, 5, 11, 13]);

    let exponential = [
        NAME_TYPE,
        SHIFTED_NAME,
        SOURCE,
        NAME_TYPE,
        VECTOR_TYPE,
        FLOAT_TYPE,
        NAME_TYPE,
        EXPONENTIALS_NAME,
        DESTINATION,
        0x8c29,
        DEONTIC,
    ];
    append_sentence(words, &exponential, &[2, 8, 10]);

    let sum = [
        NAME_TYPE,
        EXPONENTIALS_NAME,
        SOURCE,
        NAME_TYPE,
        FLOAT_TYPE,
        NAME_TYPE,
        DENOMINATOR_NAME,
        DESTINATION,
        0xbc8a,
        DEONTIC,
    ];
    append_sentence(words, &sum, &[2, 7, 9]);

    let divide = [
        NAME_TYPE,
        EXPONENTIALS_NAME,
        SOURCE,
        NAME_TYPE,
        DENOMINATOR_NAME,
        COMITATIVE,
        NAME_TYPE,
        VECTOR_TYPE,
        FLOAT_TYPE,
        NAME_TYPE,
        ANSWER_NAME,
        DESTINATION,
        0x8893,
        DEONTIC,
    ];
    append_sentence(words, &divide, &[2, 5, 11, 13]);

    let ret = [NAME_TYPE, ANSWER_NAME, NOMINATIVE, MOOD_RETURN];
    append_sentence(words, &ret, &[2, 3]);
    let close = [
        NAME_TYPE,
        SOFTMAX_NAME[0],
        SOFTMAX_NAME[1],
        NOMINATIVE,
        CEREMONY,
        MOOD_PARAGRAPH,
    ];
    append_sentence(words, &close, &[3, 5]);

    let source_index = invocation.len();
    invocation.push(SOURCE);
    invocation.extend(typed_name(&[VECTOR_TYPE, FLOAT_TYPE], &[ANSWER_NAME]));
    invocation.push(DESTINATION);
    invocation.extend([SOFTMAX_NAME[0], SOFTMAX_NAME[1], DEONTIC]);
    let destination_index = source_index + 1 + 5;
    let mood_index = destination_index + 3;
    append_sentence(
        words,
        &invocation,
        &[source_index, destination_index, mood_index],
    );
}

fn append_softmax(words: &mut std::vec::Vec<u32>, logits: &[f32]) {
    let mut quote = std::vec![match logits.len() {
        2 => 0xd11d,
        3 => 0xd71d,
        4 => 0xd21d,
        8 => 0xd31d,
        16 => 0xd41d,
        _ => 0xd61d,
    }];
    if !matches!(logits.len(), 2 | 3 | 4 | 8 | 16) {
        quote.push(logits.len() as u32);
    }
    for value in logits {
        let bits = value.to_bits();
        quote.extend([bits & 0xffff, bits >> 16]);
    }
    append_softmax_program(words, quote);
}

#[cfg(feature = "shader-f64")]
fn append_softmax_f64(words: &mut std::vec::Vec<u32>, logits: &[f64]) {
    let mut quote = std::vec![match logits.len() {
        2 => 0xd91d,
        3 => 0xdf1d,
        4 => 0xda1d,
        8 => 0xdb1d,
        16 => 0xdc1d,
        _ => 0xde1d,
    }];
    if !matches!(logits.len(), 2 | 3 | 4 | 8 | 16) {
        quote.push(logits.len() as u32);
    }
    for value in logits {
        let bits = value.to_bits();
        quote.extend([
            bits as u32 & 0xffff,
            bits as u32 >> 16,
            (bits >> 32) as u32 & 0xffff,
            (bits >> 48) as u32,
        ]);
    }
    append_softmax_program(words, quote);
}

fn append_argmax_program(words: &mut std::vec::Vec<u32>, quote: std::vec::Vec<u32>) {
    let mut definition = std::vec![NAME_TYPE, ANSWER_ROUTINE, NOMINATIVE];
    definition.extend(typed_name(&[VECTOR_TYPE, FLOAT_TYPE], &[LOGITS_NAME]));
    definition.push(SOURCE);
    definition.extend(typed_name(&[NUMBER_TYPE], &[ANSWER_NAME]));
    definition.extend([DESTINATION, CEREMONY, MOOD_DEFINITION]);
    append_sentence(words, &definition, &[2, 8, 13, 15]);

    let mut maximum_index = std::vec![NAME_TYPE, LOGITS_NAME, SOURCE];
    maximum_index.extend(typed_name(&[NUMBER_TYPE], &[ANSWER_NAME]));
    maximum_index.extend([DESTINATION, 0xa9b2, 0xa831, DEONTIC]);
    append_sentence(words, &maximum_index, &[2, 7, 10]);

    append_sentence(
        words,
        &[NAME_TYPE, ANSWER_NAME, NOMINATIVE, MOOD_RETURN],
        &[2, 3],
    );
    append_sentence(
        words,
        &[
            NAME_TYPE,
            ANSWER_ROUTINE,
            NOMINATIVE,
            CEREMONY,
            MOOD_PARAGRAPH,
        ],
        &[2, 4],
    );

    let source_index = quote.len();
    let mut invocation = quote;
    invocation.push(SOURCE);
    invocation.extend(typed_name(&[NUMBER_TYPE], &[ANSWER_NAME]));
    let destination_index = source_index + 1 + 4;
    invocation.extend([DESTINATION, ANSWER_ROUTINE, DEONTIC]);
    append_sentence(
        words,
        &invocation,
        &[source_index, destination_index, destination_index + 2],
    );
}

fn f32_quote(values: &[f32]) -> std::vec::Vec<u32> {
    let mut quote = std::vec![match values.len() {
        2 => 0xd11d,
        3 => 0xd71d,
        4 => 0xd21d,
        8 => 0xd31d,
        16 => 0xd41d,
        _ => 0xd61d,
    }];
    if !matches!(values.len(), 2 | 3 | 4 | 8 | 16) {
        quote.push(values.len() as u32);
    }
    for value in values {
        let bits = value.to_bits();
        quote.extend([bits & 0xffff, bits >> 16]);
    }
    quote
}

#[cfg(feature = "shader-f64")]
fn f64_quote(values: &[f64]) -> std::vec::Vec<u32> {
    let mut quote = std::vec![match values.len() {
        2 => 0xd91d,
        3 => 0xdf1d,
        4 => 0xda1d,
        8 => 0xdb1d,
        16 => 0xdc1d,
        _ => 0xde1d,
    }];
    if !matches!(values.len(), 2 | 3 | 4 | 8 | 16) {
        quote.push(values.len() as u32);
    }
    for value in values {
        let bits = value.to_bits();
        quote.extend([
            bits as u32 & 0xffff,
            (bits >> 16) as u32 & 0xffff,
            (bits >> 32) as u32 & 0xffff,
            (bits >> 48) as u32,
        ]);
    }
    quote
}

fn run(words: &[u32]) -> CoreResult {
    let codelet_count = words.len() / CODELET_WORDS;
    let mut symbols = [0; MAX_PROGRAMLET_SYMBOL_WORDS];
    let mut frames = ProgramletStack::EMPTY;
    execute_numeric_programlet(words, codelet_count, 256, &mut symbols, &mut frames)
}

#[test]
fn scalar_subtraction_signature_does_not_enter_vector_dispatch() {
    let tokens = [
        0xd01d,
        0,
        0x3f80,
        SOURCE,
        0xd01d,
        0,
        0x4000,
        COMITATIVE,
        NAME_TYPE,
        FLOAT_TYPE,
        NAME_TYPE,
        ANSWER_NAME,
        DESTINATION,
        0xabd2,
        DEONTIC,
    ];
    let mut words = std::vec::Vec::new();
    append_sentence(&mut words, &tokens, &[3, 7, 12, 14]);
    let (token_count, _) = collect_sentence(&words, 1, 0).unwrap();
    let sentence_view = SentenceView::new(&words, 0, token_count);
    let mut sentence = ParsedSentence::empty();
    assert_eq!(parse_sentence(&sentence_view, &mut sentence), 0);
    assert!(!is_programlet_vector_action(
        &sentence,
        &sentence_view,
        &[0; MAX_PROGRAMLET_SYMBOL_WORDS],
        &[ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS],
        &[ProgramletVectorSlot::EMPTY; 8],
    ));
}

#[test]
fn composes_stable_softmax_from_vector_programlet_primitives() {
    let mut words = std::vec::Vec::new();
    append_softmax(&mut words, &[1.0, 2.0, 3.0]);

    let result = run(&words);

    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT32);
    assert_eq!(result.length, 3);
    let expected = [0.090_030_57_f32, 0.244_728_48, 0.665_240_94];
    for (index, expected) in expected.into_iter().enumerate() {
        let actual = f32::from_bits(result.values[index]);
        assert!((actual - expected).abs() < 1e-6, "lane {index}: {actual}");
    }
    let sum = (0..result.length as usize)
        .map(|index| f32::from_bits(result.values[index]))
        .sum::<f32>();
    assert!((sum - 1.0).abs() < 1e-6);
}

#[test]
fn vector_call_argument_keeps_a_pointer_into_the_original_packet() {
    let mut words = std::vec::Vec::new();
    append_softmax(&mut words, &[1.0, 2.0, 3.0]);
    let codelet_count = words.len() / CODELET_WORDS;
    let invocation_start = last_programlet_sentence_start(&words, 0, codelet_count).unwrap();
    let (invocation_length, _) = collect_sentence(&words, codelet_count, invocation_start).unwrap();
    let invocation_view = SentenceView::new(&words, invocation_start, invocation_length);
    let mut invocation = ParsedSentence::empty();
    assert_eq!(parse_sentence(&invocation_view, &mut invocation), 0);
    let source = invocation.field(SOURCE).unwrap();
    let expected_word_index = invocation_view.word_index(source.start);

    let mut symbols = [0; MAX_PROGRAMLET_SYMBOL_WORDS];
    let mut frames = ProgramletStack::EMPTY;
    let result = execute_numeric_programlet(&words, codelet_count, 256, &mut symbols, &mut frames);

    assert_eq!(result.error, 0, "{result:?}");
    let argument = frames.arguments[0];
    assert_eq!(argument.vector_source_kind, VECTOR_SOURCE_QUOTE);
    assert_eq!(argument.vector_source_index as usize, expected_word_index);
    assert_eq!(argument.vector_source_length as usize, source.length);
    assert_eq!(argument.vector_length, 3);
}

#[test]
fn stable_softmax_handles_equal_logits_and_rejects_empty_vectors() {
    let mut equal_words = std::vec::Vec::new();
    append_softmax(&mut equal_words, &[0.0, 0.0, 0.0]);
    let equal = run(&equal_words);
    assert_eq!(equal.error, 0, "{equal:?}");
    for index in 0..3 {
        assert!((f32::from_bits(equal.values[index]) - 1.0 / 3.0).abs() < 1e-6);
    }

    let mut extreme_words = std::vec::Vec::new();
    append_softmax(&mut extreme_words, &[f32::MAX, -f32::MAX]);
    let extreme = run(&extreme_words);
    assert_eq!(extreme.error, 0, "{extreme:?}");
    assert_eq!(f32::from_bits(extreme.values[0]), 1.0);
    assert_eq!(f32::from_bits(extreme.values[1]), 0.0);

    let mut empty_words = std::vec::Vec::new();
    append_softmax(&mut empty_words, &[]);
    let empty = run(&empty_words);
    assert_ne!(empty.error, 0);
}

#[test]
fn maximum_with_unsigned_output_returns_the_first_maximum_index() {
    let mut words = std::vec::Vec::new();
    append_argmax_program(&mut words, f32_quote(&[1.0, 2.0, 2.0, 0.0]));
    let result = run(&words);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_UNSIGNED);
    assert_eq!(result.values[0], 1);

    let mut last_lane_words = std::vec::Vec::new();
    append_argmax_program(
        &mut last_lane_words,
        f32_quote(&[
            0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0,
        ]),
    );
    let last_lane = run(&last_lane_words);
    assert_eq!(last_lane.error, 0, "{last_lane:?}");
    assert_eq!(last_lane.value_kind, VALUE_UNSIGNED);
    assert_eq!(last_lane.values[0], 15);

    let mut empty_words = std::vec::Vec::new();
    append_argmax_program(&mut empty_words, f32_quote(&[]));
    assert_eq!(run(&empty_words).error, ERROR_VECTOR_WIDTH);
}

#[test]
#[cfg(feature = "shader-f64")]
fn composes_stable_softmax_for_float64_vectors() {
    let mut words = std::vec::Vec::new();
    append_softmax_f64(&mut words, &[1.0, 2.0, 3.0]);

    let result = run(&words);

    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT64);
    assert_eq!(result.length, 3);
    let expected = [
        0.090_030_573_170_380_46_f64,
        0.244_728_471_054_797_64,
        0.665_240_955_774_821_8,
    ];
    for (index, expected) in expected.into_iter().enumerate() {
        let bits =
            u64::from(result.values[index * 2]) | (u64::from(result.values[index * 2 + 1]) << 32);
        let actual = f64::from_bits(bits);
        assert!((actual - expected).abs() < 1e-12, "lane {index}: {actual}");
    }

    let mut extreme_words = std::vec::Vec::new();
    append_softmax_f64(&mut extreme_words, &[f64::MAX, -f64::MAX]);
    let extreme = run(&extreme_words);
    assert_eq!(extreme.error, 0, "{extreme:?}");
    for (index, expected) in [1.0, 0.0].into_iter().enumerate() {
        let bits =
            u64::from(extreme.values[index * 2]) | (u64::from(extreme.values[index * 2 + 1]) << 32);
        assert_eq!(f64::from_bits(bits), expected);
    }
}

#[test]
#[cfg(feature = "shader-f64")]
fn maximum_with_unsigned_output_supports_float64_and_first_tie() {
    let mut words = std::vec::Vec::new();
    append_argmax_program(&mut words, f64_quote(&[4.0, 9.0, 9.0, -2.0]));
    let result = run(&words);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_UNSIGNED);
    assert_eq!(result.values[0], 1);
}
