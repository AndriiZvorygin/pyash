use super::scalar_product::VectorOperand;
use super::*;

fn token_at(words: &[impl VliwWord], start: usize, group_len: usize, offset: usize) -> Option<u32> {
    if offset >= group_len * (CODELET_WORDS - 1) {
        return None;
    }
    Some(word(
        words,
        start + offset / (CODELET_WORDS - 1),
        offset % (CODELET_WORDS - 1) + 1,
    ))
}

pub(super) fn resolve_storage_vector(
    words: &[impl VliwWord],
    reference_start: usize,
    reference_group_len: usize,
    reference: NameSpan,
    row_index: Option<usize>,
    storage: &StorageView<'_>,
) -> Result<Option<VectorOperand>, u32> {
    let direct = resolve_storage_section_vector(
        words,
        reference_start,
        reference_group_len,
        reference,
        row_index,
        storage,
    )?;
    let embedded = super::embedding_lookup::resolve_prior_embedding_vector(
        words,
        reference_start,
        reference_group_len,
        reference,
        storage,
    )?;
    match (direct, embedded) {
        (Some(_), Some(_)) => Err(ERROR_DUPLICATE_SIGNATURE),
        (Some(vector), None) | (None, Some(vector)) => Ok(Some(vector)),
        (None, None) => Ok(None),
    }
}

pub(super) fn storage_has_name(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    reference: NameSpan,
    storage: &StorageView<'_>,
) -> Result<bool, u32> {
    let mut section = 0;
    while section < storage.section_count() {
        let name_offset = storage.descriptor(section, 0).ok_or(ERROR_MALFORMED)? as usize;
        let name_length = storage.descriptor(section, 1).ok_or(ERROR_MALFORMED)? as usize;
        if name_matches(
            words,
            start,
            group_len,
            reference,
            name_offset,
            name_length,
            storage,
        ) {
            return Ok(true);
        }
        section += 1;
    }
    Ok(false)
}

pub(super) fn resolve_storage_u16_scalar(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    reference: NameSpan,
    storage: &StorageView<'_>,
) -> Result<Option<u16>, u32> {
    let mut found = None;
    let mut section = 0;
    while section < storage.section_count() {
        let name_offset = storage.descriptor(section, 0).ok_or(ERROR_MALFORMED)? as usize;
        let name_length = storage.descriptor(section, 1).ok_or(ERROR_MALFORMED)? as usize;
        if name_matches(
            words,
            start,
            group_len,
            reference,
            name_offset,
            name_length,
            storage,
        ) {
            if found.is_some() {
                return Err(ERROR_DUPLICATE_SIGNATURE);
            }
            let payload_offset = storage.descriptor(section, 2).ok_or(ERROR_MALFORMED)? as usize;
            let byte_length = storage.descriptor(section, 3).ok_or(ERROR_MALFORMED)? as usize;
            let element_width = storage.descriptor(section, 4).ok_or(ERROR_MALFORMED)? as usize;
            let element_count = storage.descriptor(section, 5).ok_or(ERROR_MALFORMED)? as usize;
            let element_type = storage.descriptor(section, 6).ok_or(ERROR_MALFORMED)?;
            let rank = storage.descriptor(section, 7).ok_or(ERROR_MALFORMED)?;
            if element_count.checked_mul(element_width) != Some(byte_length) {
                return Err(ERROR_MALFORMED);
            }
            if element_type != NUMBER_TYPE || element_width != 2 {
                return Err(ERROR_UNSUPPORTED);
            }
            if rank != 1 || element_count != 1 || storage.shape(section, 0) != Some(1) {
                return Err(ERROR_UNSUPPORTED);
            }
            if payload_offset.checked_add(byte_length).is_none() {
                return Err(ERROR_MALFORMED);
            }
            found = Some(
                storage
                    .read_payload_u16(payload_offset)
                    .ok_or(ERROR_MALFORMED)?,
            );
        }
        section += 1;
    }
    Ok(found)
}

pub(super) fn resolve_storage_section_vector(
    words: &[impl VliwWord],
    reference_start: usize,
    reference_group_len: usize,
    reference: NameSpan,
    row_index: Option<usize>,
    storage: &StorageView<'_>,
) -> Result<Option<VectorOperand>, u32> {
    let mut found = None;
    let mut section = 0;
    while section < storage.section_count() {
        let name_offset = storage.descriptor(section, 0).ok_or(ERROR_MALFORMED)? as usize;
        let name_length = storage.descriptor(section, 1).ok_or(ERROR_MALFORMED)? as usize;
        let matches = name_matches(
            words,
            reference_start,
            reference_group_len,
            reference,
            name_offset,
            name_length,
            storage,
        );
        if matches {
            if found.is_some() {
                return Err(ERROR_DUPLICATE_SIGNATURE);
            }
            let payload_offset = storage.descriptor(section, 2).ok_or(ERROR_MALFORMED)? as usize;
            let byte_length = storage.descriptor(section, 3).ok_or(ERROR_MALFORMED)? as usize;
            let element_width = storage.descriptor(section, 4).ok_or(ERROR_MALFORMED)? as usize;
            let element_count = storage.descriptor(section, 5).ok_or(ERROR_MALFORMED)? as usize;
            let element_type = storage.descriptor(section, 6).ok_or(ERROR_MALFORMED)?;
            let rank = storage.descriptor(section, 7).ok_or(ERROR_MALFORMED)?;
            if element_type != 0xaa6c || !matches!(element_width, 4 | 8) {
                return Err(ERROR_UNSUPPORTED);
            }
            if element_count == 0
                || element_count.checked_mul(element_width) != Some(byte_length)
                || payload_offset.checked_add(byte_length).is_none()
            {
                return Err(ERROR_MALFORMED);
            }
            let (length, row_offset) = match rank {
                1 if row_index.is_none() => (element_count, 0),
                2 => {
                    let row = row_index.ok_or(ERROR_UNSUPPORTED)?;
                    let rows = storage.shape(section, 0).ok_or(ERROR_MALFORMED)? as usize;
                    let columns = storage.shape(section, 1).ok_or(ERROR_MALFORMED)? as usize;
                    if rows.checked_mul(columns) != Some(element_count) {
                        return Err(ERROR_MALFORMED);
                    }
                    if row >= rows {
                        return Err(ERROR_VECTOR_WIDTH);
                    }
                    let row_offset = row
                        .checked_mul(columns)
                        .and_then(|index| index.checked_mul(element_width))
                        .ok_or(ERROR_MALFORMED)?;
                    (columns, row_offset)
                }
                _ => return Err(ERROR_UNSUPPORTED),
            };
            found = Some(VectorOperand {
                kind: if element_width == 4 {
                    VALUE_VECTOR_FLOAT32
                } else {
                    VALUE_VECTOR_FLOAT64
                },
                length,
                values: [0; RESULT_WORDS],
                storage_backed: true,
                storage_byte_offset: payload_offset
                    .checked_add(row_offset)
                    .ok_or(ERROR_MALFORMED)?,
            });
        }
        section += 1;
    }
    Ok(found)
}

fn name_matches(
    words: &[impl VliwWord],
    start: usize,
    group_len: usize,
    reference: NameSpan,
    storage_offset: usize,
    storage_length: usize,
    storage: &StorageView<'_>,
) -> bool {
    if reference.length != storage_length {
        return false;
    }
    let mut index = 0;
    let mut same = true;
    while index < storage_length {
        same &= token_at(words, start, group_len, reference.start + index)
            == storage.name_word(storage_offset + index);
        index += 1;
    }
    same
}
