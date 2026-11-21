use super::*;

pub(super) const MAX_ROUTINE_SIGNATURE_CASES: usize = MAX_PROGRAMLET_ARGUMENTS + 1;

#[derive(Clone, Copy)]
pub(super) struct SignatureType {
    words: [u32; 2],
    length: usize,
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
    role: u32,
    value_type: SignatureType,
}

impl SignatureCase {
    pub(super) const EMPTY: Self = Self {
        role: 0,
        value_type: SignatureType::new(0, 0, 0),
    };
}

pub(super) fn canonical_type(value_type: u32) -> Result<SignatureType, u32> {
    if value_type == VALUE_UNSIGNED || value_type == VALUE_SIGNED || value_type == VALUE_NUMBER {
        Ok(SignatureType::new(NUMBER_TYPE, 0, 1))
    } else if value_type == VALUE_BOOLEAN {
        Ok(SignatureType::new(BOOLEAN_TYPE, 0, 1))
    } else if value_type == VALUE_FLOAT32
        || value_type == VALUE_FLOAT64
        || value_type == VALUE_FLOAT
    {
        Ok(SignatureType::new(FLOAT_TYPE, 0, 1))
    } else if value_type == VALUE_VECTOR_FLOAT32
        || value_type == VALUE_VECTOR_FLOAT64
        || value_type == VALUE_VECTOR_FLOAT
    {
        Ok(SignatureType::new(VECTOR_TYPE, FLOAT_TYPE, 2))
    } else {
        Err(ERROR_UNSUPPORTED)
    }
}

pub(super) fn insert_case(
    cases: &mut [SignatureCase; MAX_ROUTINE_SIGNATURE_CASES],
    count: &mut usize,
    role: u32,
    value_type: SignatureType,
) -> Result<(), u32> {
    if *count == cases.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let entry = SignatureCase { role, value_type };
    let mut index = *count;
    while index > 0 && cases[index - 1].role > role {
        array_put!(cases, index, array_at!(cases, index - 1));
        index -= 1;
    }
    if index > 0 && cases[index - 1].role == role {
        return Err(ERROR_MALFORMED);
    }
    array_put!(cases, index, entry);
    *count += 1;
    Ok(())
}

pub(super) fn formal_type(
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    field: SentenceField,
) -> Result<SignatureType, u32> {
    let mut name = NameSpan::EMPTY;
    let mut value_type = 0;
    if typed_name_span(tokens, field, &mut name, &mut value_type) == 0 && value_type != 0 {
        return canonical_type(value_type);
    }
    if field.length == 2 && array_at!(tokens, field.start) == NUMBER_QUOTE {
        return canonical_type(VALUE_NUMBER);
    }
    if field.length == 1
        && (array_at!(tokens, field.start) == TRUTH || array_at!(tokens, field.start) == LIE)
    {
        return canonical_type(VALUE_BOOLEAN);
    }
    Err(ERROR_UNSUPPORTED)
}

pub(super) fn append_case(
    signature: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    used: &mut usize,
    case: SignatureCase,
) -> Result<(), u32> {
    let end = used
        .checked_add(case.value_type.length + 1)
        .ok_or(ERROR_FRAME_CAPACITY)?;
    if end > signature.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let mut index = 0;
    while index < case.value_type.length {
        array_put!(
            signature,
            *used + index,
            array_at!(&case.value_type.words, index)
        );
        index += 1;
    }
    array_put!(signature, *used + case.value_type.length, case.role);
    *used = end;
    Ok(())
}

pub(super) fn compare_keys(
    signatures: &[u32; PROGRAMLET_SCRATCH_WORDS],
    left_start: usize,
    left_length: usize,
    right_start: usize,
    right_length: usize,
) -> i32 {
    let common = left_length.min(right_length);
    let mut index = 0;
    while index < common {
        let left = array_at!(signatures, left_start + index);
        let right = array_at!(signatures, right_start + index);
        if left != right {
            return compare_words(left, right);
        }
        index += 1;
    }
    compare_words(left_length as u32, right_length as u32)
}

pub(super) fn compare_query(
    signatures: &[u32; PROGRAMLET_SCRATCH_WORDS],
    signature_start: usize,
    signature_length: usize,
    query: &[u32; PROGRAMLET_SCRATCH_WORDS],
    query_length: usize,
) -> i32 {
    let common = signature_length.min(query_length);
    let mut index = 0;
    while index < common {
        let signature_word = array_at!(signatures, signature_start + index);
        let query_word = array_at!(query, index);
        if signature_word != query_word {
            return compare_words(signature_word, query_word);
        }
        index += 1;
    }
    compare_words(signature_length as u32, query_length as u32)
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
