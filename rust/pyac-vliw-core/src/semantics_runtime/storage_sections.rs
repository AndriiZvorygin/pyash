use super::*;

const STORAGE_MAX_SECTIONS: usize = 64;
const PAUCAL_NUMBER_TYPE: u32 = 0x309e;
const NUMBER_WIDTH_TYPE: u32 = 0x327e;
const PLURAL_NUMBER_TYPE: u32 = 0x289e;
const MULTAL_NUMBER_TYPE: u32 = 0x6b57;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StorageSectionRange {
    pub metadata_start: usize,
    pub metadata_codelets: usize,
    pub name_word_index: usize,
    pub name_length: usize,
    pub payload_start: usize,
    pub payload_codelets: usize,
    pub byte_length: u32,
    pub element_width: u32,
    pub element_count: u32,
    pub element_type: u32,
    pub rank: u32,
    pub shape: [u32; 8],
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct StorageMetadata {
    next_codelet: usize,
    name_word_index: usize,
    name_length: usize,
    byte_length: u32,
    element_width: u32,
    element_count: u32,
    element_type: u32,
    rank: u32,
    shape: [u32; 8],
}



fn storage_metadata(
    words: &[u16],
    codelet_count: usize,
    start: usize,
) -> Result<Option<StorageMetadata>, u32> {
    let Ok((token_count, next)) = collect_sentence(words, codelet_count, start) else {
        return Ok(None);
    };
    let tokens = SentenceView::new(words, start, token_count);
    let mut sentence = ParsedSentence::empty();
    if parse_sentence(&tokens, &mut sentence) != 0
        || sentence.mood != MOOD_DEFINITION
        || sentence.verb_length != 2
        || tokens.token(sentence.verb_start) != Some(STORAGE_GATHER)
        || tokens.token(sentence.verb_start + 1) != Some(STORAGE_COMPUTER)
    {
        return Ok(None);
    }
    // Storage descriptor:
    //   from num <start offset> to num <end offset> as <type root word(s)>
    //   be kcot kyut def <data> prah
    let (Some(source), Some(destination), Some(essence)) = (
        sentence.field(SOURCE),
        sentence.field(DESTINATION),
        sentence.field(ESSIVE),
    ) else {
        return Err(ERROR_MALFORMED);
    };
    let byte_start = field_offset(&tokens, source).ok_or(ERROR_MALFORMED)?;
    let byte_end = field_offset(&tokens, destination).ok_or(ERROR_MALFORMED)?;
    if byte_end <= byte_start {
        return Err(ERROR_MALFORMED);
    }
    let byte_length = byte_end - byte_start;
    let (element_type, element_width) = element_type_of(&tokens, essence).ok_or(ERROR_MALFORMED)?;
    if element_width == 0 || byte_length % element_width as u64 != 0 {
        return Err(ERROR_MALFORMED);
    }
    let element_count = (byte_length / element_width as u64) as u32;
    Ok(Some(StorageMetadata {
        next_codelet: next,
        // The descriptor form carries no `su name`; the section is identified
        // by its byte range.
        name_word_index: 0,
        name_length: 0,
        byte_length: byte_length as u32,
        element_width,
        element_count,
        element_type,
        rank: 1,
        shape: [element_count, 1, 1, 1, 1, 1, 1, 1],
    }))
}

/// Read `num <value>` as a byte offset.
///
/// `num` is `do` (uint16), but a larger offset can be written `pu` (uint32) or
/// `tl6h` (uint64). The width word leads and decides how many payload words the
/// value occupies, little-endian: one for `do`, two for `pu`, four for `tl6h`.
fn field_offset(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
) -> Option<u64> {
    let width_word = tokens.token(field.start)?;
    let (width, words) = match width_word {
        NUMBER_WIDTH_TYPE => (2u32, 1usize),
        PLURAL_NUMBER_TYPE => (4, 2),
        MULTAL_NUMBER_TYPE => (8, 4),
        _ => return None,
    };
    let mut value = 0u64;
    for index in 0..words {
        let word = u64::from(tokens.token(field.start + 1 + index)?);
        value |= word << (16 * index);
    }
    let bits = u64::from(width) * 8;
    if bits < 64 && value >> bits != 0 {
        return None;
    }
    Some(value)
}

/// Read the element type from the essive field: root words naming a numeric type.
fn element_type_of(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
) -> Option<(u32, u32)> {
    let mut width = 0u32;
    let mut element_type = 0u32;
    for index in 0..field.length {
        let word = tokens.token(field.start + index)?;
        match word {
            PAUCAL_NUMBER_TYPE => width = 1,
            NUMBER_WIDTH_TYPE => width = 2,
            PLURAL_NUMBER_TYPE => width = 4,
            MULTAL_NUMBER_TYPE => width = 8,
            FLOAT_CLASS => {}
            _ => return None,
        }
        element_type = word;
    }
    if width == 0 {
        return None;
    }
    Some((element_type, width))
}

fn has_nearby_storage_verb(words: &[u16], codelet_count: usize, start: usize) -> bool {
    let end = (start + 4).min(codelet_count);
    let mut prior = 0;
    for codelet in start..end {
        for slot in 1..CODELET_WORDS {
            let token = u32::from(words[codelet * CODELET_WORDS + slot]);
            if prior == STORAGE_GATHER && token == STORAGE_COMPUTER {
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
        let Some(metadata) = storage_metadata(words, codelet_count, cursor)? else {
            cursor += 1;
            continue;
        };
        let payload_start = metadata.next_codelet;
        let byte_length = metadata.byte_length;
        let payload_codelets = (byte_length as usize).div_ceil((CODELET_WORDS - 1) * 2);
        let payload_end = payload_start
            .checked_add(payload_codelets)
            .ok_or(ERROR_MALFORMED)?;
        if payload_end > codelet_count || found >= output.len() || found >= STORAGE_MAX_SECTIONS {
            return Err(ERROR_FRAME_CAPACITY);
        }
        // Payload words begin at slot 1 of each payload codelet: slot 0 is the
        // codelet header, which is not part of the payload.
        const PAYLOAD_WORDS_PER_CODELET: usize = CODELET_WORDS - 1;
        let payload_capacity = payload_codelets * PAYLOAD_WORDS_PER_CODELET * 2;
        for byte_index in byte_length as usize..payload_capacity {
            let codelet = payload_start + byte_index / (PAYLOAD_WORDS_PER_CODELET * 2);
            let word = words
                [codelet * CODELET_WORDS + 1 + (byte_index % (PAYLOAD_WORDS_PER_CODELET * 2)) / 2];
            let padding_byte = if byte_index % 2 == 0 {
                word & 0xff
            } else {
                word >> 8
            };
            if padding_byte != 0 {
                return Err(ERROR_MALFORMED);
            }
        }
        output[found] = StorageSectionRange {
            metadata_start: cursor,
            metadata_codelets: payload_start - cursor,
            name_word_index: metadata.name_word_index,
            name_length: metadata.name_length,
            payload_start,
            payload_codelets,
            byte_length: metadata.byte_length,
            element_width: metadata.element_width,
            element_count: metadata.element_count,
            element_type: metadata.element_type,
            rank: metadata.rank,
            shape: metadata.shape,
        };
        found += 1;
        cursor = payload_end;
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FROM: u32 = 0x313e;
    const TO: u32 = 0x243e;
    const AS: u32 = 0x414f;
    const DEF: u32 = 0x5217;

    /// Build one descriptor codelet:
    /// `from num <start> to num <end> as <type> be kcot kyut def`
    fn descriptor(start_offset: u16, end_offset: u16, ty: u32) -> [u16; CODELET_WORDS] {
        // Encoded order is <value> <case>, so each case word closes the field
        // before it: `num 0 from num 64 to <type> as be kcot kyut def`.
        let tokens = [
            NUMBER_WIDTH_TYPE,
            u32::from(start_offset),
            FROM,
            NUMBER_WIDTH_TYPE,
            u32::from(end_offset),
            TO,
            ty,
            AS,
            STORAGE_GATHER,
            STORAGE_COMPUTER,
            DEF,
        ];
        let mut words = [0u16; CODELET_WORDS];
        for (index, token) in tokens.iter().enumerate() {
            words[1 + index] = *token as u16;
        }
        // Boundaries on the case words (slots 3, 6, 8) and the mood (slot 11).
        words[0] = 0x0001 | (1 << 3) | (1 << 6) | (1 << 8) | (1 << 11);
        words
    }

    /// A descriptor followed by its payload codelets.
    fn pack(start_offset: u16, end_offset: u16, ty: u32, payload_codelets: usize) -> std::vec::Vec<u16> {
        let mut words = std::vec::Vec::new();
        words.extend(descriptor(start_offset, end_offset, ty));
        words.extend(std::vec![0u16; payload_codelets * CODELET_WORDS]);
        // Mark the last payload codelet complete so the scan can delimit.
        let last = words.len() - CODELET_WORDS;
        words[last] = 0x0001;
        words
    }

    fn scan(words: &[u16], codelet_count: usize) -> Result<usize, u32> {
        let mut sections = [StorageSectionRange::default(); STORAGE_MAX_SECTIONS];
        scan_storage_sections(words, codelet_count, &mut sections)
    }

    #[test]
    fn a_descriptor_delimits_its_payload_by_byte_range() {
        // 64 bytes of uint8, at 30 payload bytes per codelet, needs 3 codelets.
        let words = pack(0, 64, PAUCAL_NUMBER_TYPE, 3);
        let mut sections = [StorageSectionRange::default(); STORAGE_MAX_SECTIONS];
        assert_eq!(
            scan_storage_sections(&words, 4, &mut sections),
            Ok(1),
            "one section"
        );
        assert_eq!(sections[0].metadata_start, 0);
        assert_eq!(sections[0].payload_start, 1);
        assert_eq!(sections[0].byte_length, 64);
        assert_eq!(sections[0].element_width, 1);
        assert_eq!(sections[0].element_count, 64);
    }

    #[test]
    fn width_words_select_the_element_width() {
        for (ty, expected) in [
            (PAUCAL_NUMBER_TYPE, 1u32),
            (NUMBER_WIDTH_TYPE, 2),
            (PLURAL_NUMBER_TYPE, 4),
            (MULTAL_NUMBER_TYPE, 8),
        ] {
            let words = pack(0, 64, ty, 3);
            let mut sections = [StorageSectionRange::default(); STORAGE_MAX_SECTIONS];
            assert_eq!(
                scan_storage_sections(&words, 4, &mut sections),
                Ok(1),
                "type 0x{ty:04x}"
            );
            assert_eq!(sections[0].element_width, expected, "type 0x{ty:04x}");
            assert_eq!(sections[0].element_count, 64 / expected);
        }
    }

    #[test]
    fn a_reversed_or_empty_range_is_rejected() {
        // end <= start is malformed.
        assert_eq!(scan(&pack(64, 64, PAUCAL_NUMBER_TYPE, 3), 4), Err(ERROR_MALFORMED));
        assert_eq!(scan(&pack(64, 0, PAUCAL_NUMBER_TYPE, 3), 4), Err(ERROR_MALFORMED));
    }

    #[test]
    fn a_length_that_does_not_fill_whole_elements_is_rejected() {
        // 65 bytes of uint32 is not a whole number of elements.
        assert_eq!(scan(&pack(0, 65, PLURAL_NUMBER_TYPE, 3), 4), Err(ERROR_MALFORMED));
    }

    #[test]
    fn large_offsets_use_a_wider_num_word() {
        // `pu` (uint32) carries the offset as two little-endian words.
        // 70_000 = 0x0001_1170 -> low 0x1170, high 0x0001.
        // 140_000 = 0x0002_22E0 -> low 0x22E0, high 0x0002.
        let payload_codelets = 70_000usize.div_ceil((CODELET_WORDS - 1) * 2);
        let mut words = std::vec![0u16; (1 + payload_codelets) * CODELET_WORDS];
        let tokens = [
            PLURAL_NUMBER_TYPE, 0x1170u32, 1u32, FROM,
            PLURAL_NUMBER_TYPE, 0x22E0u32, 2u32, TO,
            PAUCAL_NUMBER_TYPE, AS,
            STORAGE_GATHER, STORAGE_COMPUTER, DEF,
        ];
        for (index, token) in tokens.iter().enumerate() {
            words[1 + index] = *token as u16;
        }
        // Boundaries: FROM (slot 4), TO (slot 8), AS (slot 10), DEF (slot 13).
        words[0] = 0x0001 | (1 << 4) | (1 << 8) | (1 << 10) | (1 << 13);
        let last = words.len() - CODELET_WORDS;
        words[last] = 1;
        let mut sections = [StorageSectionRange::default(); STORAGE_MAX_SECTIONS];
        let result = scan_storage_sections(&words, 1 + payload_codelets, &mut sections);
        assert_eq!(result, Ok(1), "sections: {sections:?}");
        assert_eq!(sections[0].byte_length, 70_000);
        assert_eq!(sections[0].element_count, 70_000);
    }
}


