use super::*;

pub(super) const MAX_ROUTINE_SIGNATURE_CASES: usize = MAX_PROGRAMLET_ARGUMENTS + 1;

#[derive(Clone, Copy)]
pub(super) struct SignatureType {
    pub(super) words: [u32; 2],
    pub(super) length: usize,
}

impl SignatureType {
    const fn new(first: u32, second: u32, length: usize) -> Self {
        Self {
            words: [first, second],
            length,
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct SignatureCase {
    pub(super) role: u32,
    pub(super) value_type: SignatureType,
}

impl SignatureCase {
    pub(super) const EMPTY: Self = Self {
        role: u32::MAX,
        value_type: SignatureType::new(0, 0, 0),
    };
}

pub(super) fn canonical_type(value_type: u32) -> Result<SignatureType, u32> {
    match value_type {
        VALUE_UNSIGNED | VALUE_SIGNED | VALUE_NUMBER => Ok(SignatureType::new(NUMBER_TYPE, 0, 1)),
        VALUE_BOOLEAN => Ok(SignatureType::new(BOOLEAN_TYPE, 0, 1)),
        VALUE_FLOAT32 | VALUE_FLOAT64 | VALUE_FLOAT => Ok(SignatureType::new(FLOAT_TYPE, 0, 1)),
        VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64 | VALUE_VECTOR_FLOAT => {
            Ok(SignatureType::new(VECTOR_TYPE, FLOAT_TYPE, 2))
        }
        _ => Err(ERROR_UNSUPPORTED),
    }
}

pub(super) fn insert_case(
    cases: &mut [SignatureCase; MAX_ROUTINE_SIGNATURE_CASES],
    count: &mut usize,
    role: u32,
    value_type: SignatureType,
) -> Result<(), u32> {
    if *count >= cases.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }

    // Sentence parsing has already rejected repeated case roles.
    // Append cheaply; sort_cases applies fixed-index compare/swap steps afterward.
    array_put!(cases, *count, SignatureCase { role, value_type });
    *count += 1;
    Ok(())
}

pub(super) fn sort_cases(cases: &mut [SignatureCase; MAX_ROUTINE_SIGNATURE_CASES]) {
    macro_rules! compare_swap {
        ($left:literal, $right:literal) => {{
            let left_case = cases[$left];
            let right_case = cases[$right];
            if left_case.role > right_case.role {
                cases[$left] = right_case;
                cases[$right] = left_case;
            }
        }};
    }

    compare_swap!(0, 1);
    compare_swap!(1, 2);
    compare_swap!(2, 3);
    compare_swap!(3, 4);
    compare_swap!(4, 5);
    compare_swap!(5, 6);
    compare_swap!(6, 7);
    compare_swap!(7, 8);
    compare_swap!(0, 1);
    compare_swap!(1, 2);
    compare_swap!(2, 3);
    compare_swap!(3, 4);
    compare_swap!(4, 5);
    compare_swap!(5, 6);
    compare_swap!(6, 7);
    compare_swap!(0, 1);
    compare_swap!(1, 2);
    compare_swap!(2, 3);
    compare_swap!(3, 4);
    compare_swap!(4, 5);
    compare_swap!(5, 6);
    compare_swap!(0, 1);
    compare_swap!(1, 2);
    compare_swap!(2, 3);
    compare_swap!(3, 4);
    compare_swap!(4, 5);
    compare_swap!(0, 1);
    compare_swap!(1, 2);
    compare_swap!(2, 3);
    compare_swap!(3, 4);
    compare_swap!(0, 1);
    compare_swap!(1, 2);
    compare_swap!(2, 3);
    compare_swap!(0, 1);
    compare_swap!(1, 2);
    compare_swap!(0, 1);
}

pub(super) fn formal_type(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
) -> Result<SignatureType, u32> {
    let mut name = NameSpan::EMPTY;
    let mut value_type = 0;
    if typed_name_span(tokens, field, &mut name, &mut value_type) == 0 && value_type != 0 {
        return canonical_type(value_type);
    }
    if field.length == 2 && sentence_at!(*tokens, field.start) == NUMBER_QUOTE {
        return canonical_type(VALUE_NUMBER);
    }
    if field.length == 1
        && (sentence_at!(*tokens, field.start) == TRUTH
            || sentence_at!(*tokens, field.start) == LIE)
    {
        return canonical_type(VALUE_BOOLEAN);
    }
    Err(ERROR_UNSUPPORTED)
}

pub(super) fn append_case(
    signature: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    used: &mut usize,
    case: SignatureCase,
) -> Result<(), u32> {
    let end = used
        .checked_add(case.value_type.length + 1)
        .ok_or(ERROR_FRAME_CAPACITY)?;
    if end > signature.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let words = case.value_type.words;
    let mut index = 0;
    while index < case.value_type.length {
        array_put!(signature, *used + index, array_at!(words, index));
        index += 1;
    }
    array_put!(signature, *used + case.value_type.length, case.role);
    *used = end;
    Ok(())
}

pub(super) fn compare_keys(
    signatures: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    left_start: usize,
    left_length: usize,
    right_start: usize,
    right_length: usize,
) -> i32 {
    let common = left_length.min(right_length);
    let mut index = 0;
    while index < common {
        let left = array_at!(*signatures, left_start + index);
        let right = array_at!(*signatures, right_start + index);
        if left != right {
            return compare_words(left, right);
        }
        index += 1;
    }
    compare_words(left_length as u32, right_length as u32)
}

fn compare_words(left: u32, right: u32) -> i32 {
    if left < right {
        -1
    } else if left > right {
        1
    } else {
        0
    }
}
