use super::float::is_finite_f32;
#[cfg(feature = "shader-f64")]
use super::float::is_finite_f64;
use super::programlet_values::number_value;
use super::programlet_vector_values::{
    find_programlet_vector_slot, programlet_field_is_vector, read_programlet_vector,
    write_local_vector_values, write_programlet_float, write_programlet_vector_lane,
};
use super::scalar_product::{PRODUCE_WORD, SCALAR_WORD};
use super::*;

const SELECT_VERB: u32 = 0xaaa2;

pub(super) fn is_programlet_vector_declaration(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
) -> bool {
    sentence.mood == REALIS
        && sentence.verb_length == 1
        && sentence_at!(*tokens, sentence.verb_start) == VARIABLE
}

pub(super) fn declare_programlet_vector_local(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
    symbols: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    symbol_used: &mut usize,
    vector_slots: &mut [ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &mut [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
    frame_index: usize,
    length: usize,
) -> Result<(), u32> {
    if sentence.field_count != 3 || length == 0 || length > MAX_VECTOR_LANES {
        return Err(ERROR_MALFORMED);
    }
    let name_field = sentence.field(NOMINATIVE).ok_or(ERROR_MALFORMED)?;
    let mut name = NameSpan::EMPTY;
    let error = name_span(tokens, name_field, false, &mut name);
    if error != 0 {
        return Err(error);
    }
    if find_programlet_vector_slot(tokens, name, symbols, vector_slots).is_some() {
        return Err(ERROR_MALFORMED);
    }
    let mut target = 0;
    while target < vector_slots.len() && array_at!(*vector_slots, target).value_kind != 0 {
        target += 1;
    }
    if target == vector_slots.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let mut stored = NameSpan::EMPTY;
    let error = store_name(tokens, name, symbols, symbol_used, &mut stored);
    if error != 0 {
        return Err(error);
    }
    array_put!(
        vector_slots,
        target,
        ProgramletVectorSlot {
            name_offset: stored.start as u32,
            name_length: stored.length as u32,
            value_kind: VALUE_VECTOR_FLOAT32,
            length: length as u32,
        }
    );
    write_local_vector_values(vector_values, frame_index, target, &[0; RESULT_WORDS]);
    Ok(())
}

pub(super) fn is_programlet_dot_product_store(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
) -> bool {
    sentence.mood == DEONTIC
        && sentence.verb_length == 2
        && sentence_at!(*tokens, sentence.verb_start) == SCALAR_WORD
        && sentence_at!(*tokens, sentence.verb_start + 1) == PRODUCE_WORD
}

pub(super) fn apply_programlet_dot_product_store(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    frame_index: usize,
    vector_slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &mut [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
) -> Result<(), u32> {
    if sentence.field_count != 4 {
        return Err(ERROR_MALFORMED);
    }
    let left = read_programlet_vector(
        tokens,
        sentence.field(ACCUSATIVE).ok_or(ERROR_MALFORMED)?,
        symbols,
        arguments,
        frame_index,
        vector_slots,
        vector_values,
    )?;
    let right = read_programlet_vector(
        tokens,
        sentence.field(INSTRUMENTAL).ok_or(ERROR_MALFORMED)?,
        symbols,
        arguments,
        frame_index,
        vector_slots,
        vector_values,
    )?;
    if left.kind != right.kind {
        return Err(ERROR_UNSUPPORTED);
    }
    if left.length != right.length {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let index_field = sentence.field(LOCATIVE).ok_or(ERROR_MALFORMED)?;
    let index = number_value(tokens, index_field)? as usize;
    let value = if left.kind == VALUE_VECTOR_FLOAT32 {
        let mut sum = 0.0f32;
        let mut lane = 0;
        while lane < left.length {
            sum += f32::from_bits(array_at!(left.values, lane))
                * f32::from_bits(array_at!(right.values, lane));
            lane += 1;
        }
        if !is_finite_f32(sum) {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        ProgramletNumber {
            bits: sum.to_bits(),
            high: 0,
            kind: VALUE_FLOAT32,
        }
    } else {
        #[cfg(not(feature = "shader-f64"))]
        return Err(ERROR_UNSUPPORTED);
        #[cfg(feature = "shader-f64")]
        {
            let mut sum = 0.0f64;
            let mut lane = 0;
            while lane < left.length {
                let left_bits = u64::from(array_at!(left.values, lane * 2))
                    | (u64::from(array_at!(left.values, lane * 2 + 1)) << 32);
                let right_bits = u64::from(array_at!(right.values, lane * 2))
                    | (u64::from(array_at!(right.values, lane * 2 + 1)) << 32);
                sum += f64::from_bits(left_bits) * f64::from_bits(right_bits);
                lane += 1;
            }
            if !is_finite_f64(sum) {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            let bits = sum.to_bits();
            ProgramletNumber {
                bits: bits as u32,
                high: (bits >> 32) as u32,
                kind: VALUE_FLOAT64,
            }
        }
    };
    write_programlet_vector_lane(
        tokens,
        sentence.field(DESTINATION).ok_or(ERROR_MALFORMED)?,
        index,
        value,
        symbols,
        vector_slots,
        vector_values,
        frame_index,
    )
}

pub(super) fn is_programlet_vector_select(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    vector_slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
) -> bool {
    if sentence.mood != DEONTIC
        || sentence.verb_length != 1
        || sentence_at!(*tokens, sentence.verb_start) != SELECT_VERB
    {
        return false;
    }
    match sentence.field(SOURCE) {
        Some(field) => programlet_field_is_vector(tokens, field, symbols, arguments, vector_slots),
        None => false,
    }
}

pub(super) fn apply_programlet_vector_select(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
    symbols: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    symbol_used: &mut usize,
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    frame_index: usize,
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    vector_slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &[u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
) -> Result<(), u32> {
    if sentence.field_count != 3 {
        return Err(ERROR_MALFORMED);
    }
    let vector = read_programlet_vector(
        tokens,
        sentence.field(SOURCE).ok_or(ERROR_MALFORMED)?,
        symbols,
        arguments,
        frame_index,
        vector_slots,
        vector_values,
    )?;
    let mut index = ProgramletNumber::EMPTY;
    let error = resolve_programlet_value(
        tokens,
        sentence.field(LOCATIVE).ok_or(ERROR_MALFORMED)?,
        symbols,
        arguments,
        slots,
        &mut index,
    );
    if error != 0 {
        return Err(error);
    }
    if index.kind != VALUE_UNSIGNED {
        return Err(ERROR_UNSUPPORTED);
    }
    let lane = index.bits as usize;
    if lane >= vector.length {
        return Err(ERROR_VECTOR_WIDTH);
    }
    let value = if vector.kind == VALUE_VECTOR_FLOAT32 {
        ProgramletNumber {
            bits: array_at!(vector.values, lane),
            high: 0,
            kind: VALUE_FLOAT32,
        }
    } else {
        #[cfg(not(feature = "shader-f64"))]
        return Err(ERROR_UNSUPPORTED);
        #[cfg(feature = "shader-f64")]
        {
            ProgramletNumber {
                bits: array_at!(vector.values, lane * 2),
                high: array_at!(vector.values, lane * 2 + 1),
                kind: VALUE_FLOAT64,
            }
        }
    };
    write_programlet_float(
        tokens,
        sentence.field(DESTINATION).ok_or(ERROR_MALFORMED)?,
        symbols,
        symbol_used,
        VALUE_FLOAT,
        value,
        slots,
    )
}
