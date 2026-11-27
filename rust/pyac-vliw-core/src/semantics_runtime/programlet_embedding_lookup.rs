use super::embedding_lookup::resolve_embedding_row_operand;
use super::programlet_vector_values::{find_programlet_vector_slot, write_local_vector_values};
use super::*;

pub(super) fn is_programlet_embedding_lookup(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
) -> bool {
    super::signature_dispatch::select_signature_route(words, start, group_len)
        == Ok(super::signature_dispatch::ROUTE_EMBEDDING_LOOKUP)
}

pub(super) fn apply_programlet_embedding_lookup(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    tokens: &SentenceView<'_, impl VliwWord>,
    storage: &StorageView<'_>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    vector_slots: &[ProgramletVectorSlot; MAX_PROGRAMLET_VECTOR_LOCAL_SLOTS],
    vector_values: &mut [u32; MAX_PROGRAMLET_VECTOR_VALUE_WORDS],
    frame_index: usize,
) -> Result<(), u32> {
    let (binding, vector) = resolve_embedding_row_operand(words, start, group_len, storage)?;
    let slot_index = find_programlet_vector_slot(tokens, binding.result, symbols, vector_slots)
        .ok_or(ERROR_MALFORMED)?;
    let slot = array_at!(*vector_slots, slot_index);
    if slot.value_kind != vector.kind {
        return Err(ERROR_UNSUPPORTED);
    }
    if slot.length as usize != vector.length || vector.length > MAX_VECTOR_LANES {
        return Err(ERROR_VECTOR_WIDTH);
    }
    if !vector.storage_backed {
        return Err(ERROR_UNSUPPORTED);
    }

    let mut values = [0; RESULT_WORDS];
    match vector.kind {
        VALUE_VECTOR_FLOAT32 => {
            let mut lane = 0;
            while lane < vector.length {
                let byte_offset = vector
                    .storage_byte_offset
                    .checked_add(lane * 4)
                    .ok_or(ERROR_MALFORMED)?;
                values[lane] = storage
                    .read_payload_u32(byte_offset)
                    .ok_or(ERROR_MALFORMED)?;
                lane += 1;
            }
        }
        VALUE_VECTOR_FLOAT64 => {
            #[cfg(not(feature = "shader-f64"))]
            return Err(ERROR_UNSUPPORTED);
            #[cfg(feature = "shader-f64")]
            {
                let mut lane = 0;
                while lane < vector.length {
                    let byte_offset = vector
                        .storage_byte_offset
                        .checked_add(lane * 8)
                        .ok_or(ERROR_MALFORMED)?;
                    let value = storage
                        .read_payload_u64(byte_offset)
                        .ok_or(ERROR_MALFORMED)?;
                    values[lane * 2] = value as u32;
                    values[lane * 2 + 1] = (value >> 32) as u32;
                    lane += 1;
                }
            }
        }
        _ => return Err(ERROR_UNSUPPORTED),
    }
    write_local_vector_values(vector_values, frame_index, slot_index, &values);
    Ok(())
}
