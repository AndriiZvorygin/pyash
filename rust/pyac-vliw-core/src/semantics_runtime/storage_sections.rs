use super::*;

const STORAGE_MAX_SECTIONS: usize = 64;
const PAUCAL_NUMBER_TYPE: u32 = 0x309e;
const NUMBER_WIDTH_TYPE: u32 = 0x327e;
const PLURAL_NUMBER_TYPE: u32 = 0x289e;
const MULTAL_NUMBER_TYPE: u32 = 0x6b57;
const FLOAT_TYPE: u32 = 0xaa6c;
const QUOTE_DENOTE: u32 = 0x001d;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StorageSectionRange {
    pub metadata_start: usize,
    pub metadata_codelets: usize,
    pub payload_start: usize,
    pub payload_codelets: usize,
    pub byte_length: u32,
    pub element_width: u32,
    pub element_count: u32,
}

fn vector_span(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
) -> Option<(usize, usize)> {
    let header = tokens.token(field.start)?;
    if header & 0x1f != QUOTE_DENOTE || (header >> 13) & 7 != 4 || (header >> 11) & 3 != 1 {
        return None;
    }
    let vector_thickness = (header >> 8) & 7;
    if vector_thickness == 6 {
        let length = tokens.token(field.start + 1)? as usize;
        if field.length != length + 2 {
            return None;
        }
        Some((field.start + 2, length))
    } else {
        let length = match vector_thickness {
            0 => 1,
            1 => 2,
            2 => 4,
            3 => 8,
            4 => 16,
            7 => 3,
            _ => return None,
        };
        if field.length != length + 1 {
            return None;
        }
        Some((field.start + 1, length))
    }
}

fn field_byte_length(tokens: &SentenceView<'_, impl VliwWord>, field: SentenceField) -> Option<u32> {
    let (start, count) = vector_span(tokens, field)?;
    if count != 2 {
        return None;
    }
    Some(u32::from(tokens.token(start)?) | (u32::from(tokens.token(start + 1)?) << 16))
}

fn storage_metadata(
    words: &[u16],
    codelet_count: usize,
    start: usize,
) -> Result<Option<(usize, u32, u32, u32)>, u32> {
    let Ok((token_count, next)) = collect_sentence(words, codelet_count, start) else {
        return Ok(None);
    };
    let tokens = SentenceView::new(words, start, token_count);
    let mut sentence = ParsedSentence::empty();
    if parse_sentence(&tokens, &mut sentence) != 0
        || sentence.mood != REALIS
        || sentence.verb_length != 2
        || tokens.token(sentence.verb_start) != Some(SECTION_PART)
        || tokens.token(sentence.verb_start + 1) != Some(SECTION_MODULE)
    {
        return Ok(None);
    }
    let (Some(subject), Some(dtype), Some(length_field), Some(shape)) = (
        sentence.field(NOMINATIVE),
        sentence.field(ESSIVE),
        sentence.field(INSTRUMENTAL),
        sentence.field(COMITATIVE),
    ) else {
        return Err(ERROR_MALFORMED);
    };
    if subject.length < 2
        || tokens.token(subject.start) != Some(NAME_TYPE)
        || dtype.length != 2
        || tokens.token(dtype.start) != Some(NAME_TYPE)
    {
        return Err(ERROR_MALFORMED);
    }
    let byte_length = field_byte_length(&tokens, length_field).ok_or(ERROR_MALFORMED)?;
    if byte_length == 0 || shape.length < 2 {
        return Err(ERROR_MALFORMED);
    }
    let (dimension_start, dimension_count) = vector_span(&tokens, shape).ok_or(ERROR_MALFORMED)?;
    if dimension_count == 0 || dimension_count > 8 {
        return Err(ERROR_MALFORMED);
    }
    let mut element_count = 1u32;
    for index in 0..dimension_count {
        let dimension = tokens.token(dimension_start + index).ok_or(ERROR_MALFORMED)?;
        if dimension == 0 {
            return Err(ERROR_MALFORMED);
        }
        element_count = element_count.checked_mul(dimension).ok_or(ERROR_MALFORMED)?;
    }
    let dtype_word = tokens.token(dtype.start + 1).ok_or(ERROR_MALFORMED)? as u32;
    let element_width = match dtype_word {
        PAUCAL_NUMBER_TYPE => 1,
        NUMBER_WIDTH_TYPE => 2,
        PLURAL_NUMBER_TYPE => 4,
        MULTAL_NUMBER_TYPE => 8,
        FLOAT_TYPE if byte_length % element_count == 0 => byte_length / element_count,
        _ => return Err(ERROR_MALFORMED),
    };
    if (dtype_word == FLOAT_TYPE && !matches!(element_width, 4 | 8))
        || element_count.checked_mul(element_width) != Some(byte_length)
    {
        return Err(ERROR_MALFORMED);
    }
    Ok(Some((next, byte_length, element_width, element_count)))
}

fn has_nearby_storage_verb(words: &[u16], codelet_count: usize, start: usize) -> bool {
    let end = (start + 4).min(codelet_count);
    let mut prior = 0;
    for codelet in start..end {
        for slot in 1..CODELET_WORDS {
            let token = u32::from(words[codelet * CODELET_WORDS + slot]);
            if prior == SECTION_PART && token == SECTION_MODULE {
                return true;
            }
            prior = token;
        }
    }
    false
}

/// Locate sentence-defined storage descriptors and their immediately following bytes.
/// Payload codelets are skipped as opaque data; they are never returned as executable code.
pub fn scan_storage_sections(
    words: &[u16],
    codelet_count: usize,
    output: &mut [StorageSectionRange],
) -> Result<usize, u32> {
    if codelet_count > words.len() / CODELET_WORDS {
        return Err(ERROR_MALFORMED);
    }
    let mut found = 0;
    let mut cursor = 0;
    while cursor < codelet_count {
        if !has_nearby_storage_verb(words, codelet_count, cursor) {
            cursor += 1;
            continue;
        }
        let Some((payload_start, byte_length, element_width, element_count)) =
            storage_metadata(words, codelet_count, cursor)?
        else {
            cursor += 1;
            continue;
        };
        let payload_codelets = (byte_length as usize).div_ceil(CODELET_WORDS * 2);
        let payload_end = payload_start.checked_add(payload_codelets).ok_or(ERROR_MALFORMED)?;
        if payload_end > codelet_count || found >= output.len() || found >= STORAGE_MAX_SECTIONS {
            return Err(ERROR_FRAME_CAPACITY);
        }
        for byte_index in byte_length as usize..payload_codelets * CODELET_WORDS * 2 {
            let codelet = payload_start + byte_index / (CODELET_WORDS * 2);
            let word = words[codelet * CODELET_WORDS + (byte_index % (CODELET_WORDS * 2)) / 2];
            let padding_byte = if byte_index % 2 == 0 { word & 0xff } else { word >> 8 };
            if padding_byte != 0 {
                return Err(ERROR_MALFORMED);
            }
        }
        output[found] = StorageSectionRange {
            metadata_start: cursor,
            metadata_codelets: payload_start - cursor,
            payload_start,
            payload_codelets,
            byte_length,
            element_width,
            element_count,
        };
        found += 1;
        cursor = payload_end;
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage_pack() -> [u16; 48] {
        [
            0xbbb6, 0x225e, 0x6844, 0x24de, 0x225e, 0x309e, 0x414f, 0x891d, 4, 0, 0x287e,
            0x8e1d, 1, 4, 0x490f, 0x6a84, 5, 0xec01, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0x0201, 0x0403, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]
    }

    #[test]
    fn storage_descriptor_delimits_payload_after_its_complete_sentence() {
        let words = storage_pack();
        let mut sections = [StorageSectionRange {
            metadata_start: 0,
            metadata_codelets: 0,
            payload_start: 0,
            payload_codelets: 0,
            byte_length: 0,
            element_width: 0,
            element_count: 0,
        }; 4];
        assert_eq!(scan_storage_sections(&words, 3, &mut sections), Ok(1));
        assert_eq!(sections[0].metadata_codelets, 2);
        assert_eq!(sections[0].payload_start, 2);
        assert_eq!(sections[0].byte_length, 4);
        assert_eq!(sections[0].element_count, 4);
    }

    #[test]
    fn storage_numeric_dtypes_use_paucal_number_widths() {
        for (dtype, byte_length, expected_width) in [
            (PAUCAL_NUMBER_TYPE, 4u16, 1u32),
            (NUMBER_WIDTH_TYPE, 8, 2),
            (PLURAL_NUMBER_TYPE, 16, 4),
            (MULTAL_NUMBER_TYPE, 32, 8),
            (FLOAT_TYPE, 16, 4),
            (FLOAT_TYPE, 32, 8),
        ] {
            let mut words = storage_pack();
            words[5] = dtype as u16;
            words[8] = byte_length;
            let mut sections = [StorageSectionRange::default(); STORAGE_MAX_SECTIONS];
            assert_eq!(scan_storage_sections(&words, 3, &mut sections), Ok(1));
            assert_eq!(sections[0].byte_length, u32::from(byte_length));
            assert_eq!(sections[0].element_width, expected_width);
            assert_eq!(sections[0].element_count, 4);
        }
    }

    #[test]
    fn storage_descriptor_rejects_nonzero_padding_and_wrong_shape() {
        let mut words = storage_pack();
        words[47] = 1;
        let mut sections = [StorageSectionRange {
            metadata_start: 0,
            metadata_codelets: 0,
            payload_start: 0,
            payload_codelets: 0,
            byte_length: 0,
            element_width: 0,
            element_count: 0,
        }; 4];
        assert_eq!(scan_storage_sections(&words, 3, &mut sections), Err(ERROR_MALFORMED));
        words = storage_pack();
        words[12] = 3;
        assert_eq!(scan_storage_sections(&words, 3, &mut sections), Err(ERROR_MALFORMED));
    }

    #[test]
    fn storage_descriptor_reads_exact_large_lengths_and_fixed_vector_shapes() {
        let mut words = std::vec![0u16; 2 * CODELET_WORDS + 2_188 * CODELET_WORDS];
        words[..16].copy_from_slice(&[
            0xbbb6, 0x225e, 0x6844, 0x24de, 0x225e, 0x309e, 0x414f, 0x891d, 0x1170, 1,
            0x287e, 0x891d, 0x88b8, 2, 0x490f, 0x6a84,
        ]);
        words[16] = 5;
        words[17] = 0xec01;
        words[18] = 0x217e;
        let mut sections = [StorageSectionRange::default(); STORAGE_MAX_SECTIONS];
        assert_eq!(scan_storage_sections(&words, 2 + 2_188, &mut sections), Ok(1));
        assert_eq!(sections[0].byte_length, 70_000);
        assert_eq!(sections[0].element_count, 70_000);
        assert_eq!(sections[0].element_width, 1);
        assert_eq!(sections[0].payload_codelets, 2_188);
    }
}
