use super::*;

// Section names in this fixture, each written as the atom it actually is. The
// aliases beside each atom say what the test is using it for, which is the only
// place that intent belongs — an atom does not mean "logits" because a test
// section is called logits.
//
// `psin` = weight, `hzit` = feature, `hgut` = count, `dlek` = vector,
// `hnap` = answer.
const WEIGHT_WORD: u32 = 0x6844;
const FEATURE_WORD: u32 = 0xa8a0;
const COUNT_WORD: u32 = 0xaa90;
const VECTOR_WORD: u32 = 0x2b73;
const ANSWER_WORD: u32 = 0x4930;

/// The softmax section name is the two-word `weight feature`.
const SOFTMAX_NAME: [u32; 2] = [WEIGHT_WORD, FEATURE_WORD];
const LOGITS_NAME: u32 = FEATURE_WORD;
const ANSWER_NAME: u32 = ANSWER_WORD;
const MAXIMUM_NAME: u32 = COUNT_WORD;
const SHIFTED_NAME: u32 = WEIGHT_WORD;
const EXPONENTIALS_NAME: u32 = VECTOR_WORD;
const DENOMINATOR_NAME: u32 = COUNT_WORD;
const ANSWER_ROUTINE: u32 = ANSWER_WORD;

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

/// A typed field: the class words lead, then the name. `gi` marks names only,
/// and a class word already identifies the field, so there is exactly one tag.
fn typed_name(kind: &[u32], name: &[u32]) -> std::vec::Vec<u32> {
    let mut field = kind.to_vec();
    field.push(NAME_TYPE);
    field.extend_from_slice(name);
    field
}

/// Append a sentence whose field boundaries are the case words and the mood.
///
/// Deriving them instead of listing them by hand keeps fixtures from drifting
/// when a field gains or loses a word.
fn append_auto(words: &mut std::vec::Vec<u32>, tokens: &[u32]) {
    let boundaries: std::vec::Vec<usize> = tokens
        .iter()
        .enumerate()
        .filter(|(_, token)| {
            matches!(
                **token,
                NOMINATIVE
                    | ACCUSATIVE
                    | ESSIVE
                    | DESTINATION
                    | SOURCE
                    | COMITATIVE
                    | INSTRUMENTAL
                    | FROM_INDEX
                    | TO_INDEX
                    | LOCATIVE
                    | GENITIVE_CASE
                    | REALIS
                    | DEONTIC
                    | CONDITIONAL
                    | MOOD_DEFINITION
                    | MOOD_RETURN
                    | MOOD_PARAGRAPH
            )
        })
        .map(|(index, _)| index)
        .collect();
    append_sentence(words, tokens, &boundaries);
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
    append_auto(words, &definition);

    let mut maximum = std::vec![NAME_TYPE, LOGITS_NAME, SOURCE];
    maximum.extend(typed_name(&[FLOAT_TYPE], &[MAXIMUM_NAME]));
    maximum.push(DESTINATION);
    maximum.extend([0xa9b2, 0xa831, DEONTIC]);
    append_auto(words, &maximum);

    let mut subtract = std::vec![NAME_TYPE, LOGITS_NAME, SOURCE];
    subtract.extend(typed_name(&[], &[MAXIMUM_NAME]));
    subtract.push(COMITATIVE);
    subtract.extend(typed_name(&[VECTOR_TYPE, FLOAT_TYPE], &[SHIFTED_NAME]));
    subtract.extend([DESTINATION, 0xabd2, DEONTIC]);
    append_auto(words, &subtract);

    let mut exponential = std::vec![NAME_TYPE, SHIFTED_NAME, SOURCE];
    exponential.extend(typed_name(&[VECTOR_TYPE, FLOAT_TYPE], &[EXPONENTIALS_NAME]));
    exponential.extend([DESTINATION, 0x8c29, DEONTIC]);
    append_auto(words, &exponential);

    let mut sum = std::vec![NAME_TYPE, EXPONENTIALS_NAME, SOURCE];
    sum.extend(typed_name(&[FLOAT_TYPE], &[DENOMINATOR_NAME]));
    sum.extend([DESTINATION, 0xbc8a, DEONTIC]);
    append_auto(words, &sum);

    let mut divide = std::vec![NAME_TYPE, EXPONENTIALS_NAME, SOURCE];
    divide.extend(typed_name(&[], &[DENOMINATOR_NAME]));
    divide.push(COMITATIVE);
    divide.extend(typed_name(&[VECTOR_TYPE, FLOAT_TYPE], &[ANSWER_NAME]));
    divide.extend([DESTINATION, 0x8893, DEONTIC]);
    append_auto(words, &divide);

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
    append_auto(words, &close);

    invocation.push(SOURCE);
    invocation.extend(typed_name(&[VECTOR_TYPE, FLOAT_TYPE], &[ANSWER_NAME]));
    invocation.push(DESTINATION);
    invocation.extend([SOFTMAX_NAME[0], SOFTMAX_NAME[1], DEONTIC]);
    append_auto(words, &invocation);
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
    append_auto(words, &definition);

    let mut maximum_index = std::vec![NAME_TYPE, LOGITS_NAME, SOURCE];
    maximum_index.extend(typed_name(&[NUMBER_TYPE], &[ANSWER_NAME]));
    maximum_index.extend([DESTINATION, 0xa9b2, 0xa831, DEONTIC]);
    append_auto(words, &maximum_index);

    append_auto(words, &[NAME_TYPE, ANSWER_NAME, NOMINATIVE, MOOD_RETURN]);
    append_auto(
        words,
        &[
            NAME_TYPE,
            ANSWER_ROUTINE,
            NOMINATIVE,
            CEREMONY,
            MOOD_PARAGRAPH,
        ],
    );

    let mut invocation = quote;
    invocation.push(SOURCE);
    invocation.extend(typed_name(&[NUMBER_TYPE], &[ANSWER_NAME]));
    invocation.extend([DESTINATION, ANSWER_ROUTINE, DEONTIC]);
    append_auto(words, &invocation);
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
        FLOAT_TYPE,
        NAME_TYPE,
        ANSWER_NAME,
        DESTINATION,
        0xabd2,
        DEONTIC,
    ];
    let mut words = std::vec::Vec::new();
    append_auto(&mut words, &tokens);
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



