use super::*;

pub fn is_numeric_programlet(words: &[u32], codelet_count: usize) -> bool {
    is_numeric_programlet_at(words, 0, codelet_count)
}

pub fn is_numeric_programlet_at(words: &[u32], base_codelet: usize, codelet_count: usize) -> bool {
    if codelet_count == 0
        || base_codelet > words.len() / CODELET_WORDS
        || codelet_count > words.len() / CODELET_WORDS - base_codelet
    {
        return false;
    }
    let mut has_su = false;
    let mut has_to = false;
    let mut previous_word = 0;
    let mut previous_boundary = false;
    let mut codelet = 0;
    loop {
        if codelet >= codelet_count {
            return false;
        }
        let absolute_codelet = base_codelet + codelet;
        let header = word(words, absolute_codelet, 0);
        let complete = header & 1 != 0;
        let mut last_boundary = 0;
        let mut slot = 1;
        while slot < CODELET_WORDS {
            if (header & (1 << slot) != 0) == complete {
                last_boundary = slot;
            }
            slot += 1;
        }
        if complete && last_boundary == 0 {
            return false;
        }
        let last_slot = if complete {
            last_boundary
        } else {
            CODELET_WORDS - 1
        };
        slot = 1;
        while slot <= last_slot {
            let value = word(words, absolute_codelet, slot);
            let boundary = (header & (1 << slot) != 0) == complete;
            if boundary && value == NOMINATIVE {
                has_su = true;
            } else if boundary && value == DESTINATION {
                has_to = true;
            } else if boundary && value == MOOD_DEFINITION {
                return complete
                    && slot == last_slot
                    && has_su
                    && has_to
                    && previous_word == CEREMONY
                    && !previous_boundary;
            }
            previous_word = value;
            previous_boundary = boundary;
            slot += 1;
        }
        codelet += 1;
        if complete {
            return false;
        }
    }
}

pub(super) fn is_programlet_section_verb(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
) -> bool {
    sentence.verb_length == 2
        && sentence_at!(*tokens, sentence.verb_start) == SECTION_MODULE
        && sentence_at!(*tokens, sentence.verb_start + 1) == SECTION_PART
}

pub(super) fn section_names_equal(
    left: &[u32; MAX_PROGRAMLET_SECTION_NAME_WORDS],
    left_length: usize,
    right: &[u32; MAX_PROGRAMLET_SECTION_NAME_WORDS],
    right_length: usize,
) -> bool {
    if left_length != right_length || left_length > MAX_PROGRAMLET_SECTION_NAME_WORDS {
        return false;
    }
    let mut index = 0;
    while index < left_length {
        if array_at!(*left, index) != array_at!(*right, index) {
            return false;
        }
        index += 1;
    }
    true
}

pub fn has_programlet_section_header(words: &[u32], codelet_count: usize) -> bool {
    if codelet_count == 0 || codelet_count > words.len() / CODELET_WORDS {
        return false;
    }
    let Ok((token_count, _)) = collect_sentence(words, codelet_count, 0) else {
        return false;
    };
    let sentence_view = SentenceView::new(words, 0, token_count);
    let mut sentence = ParsedSentence::empty();
    parse_sentence(&sentence_view, &mut sentence) == 0
        && sentence.mood == MOOD_DEFINITION
        && is_programlet_section_verb(&sentence, &sentence_view)
}

/// Scan a flat PyAC packet for independent, named `myoc pfun` programlet
/// sections. Returned codelet ranges exclude both section boundary sentences.
/// Each section name is its sequence of HNUC words, not display text.
pub fn scan_numeric_programlet_sections(
    words: &[u32],
    codelet_count: usize,
    sections: &mut [ProgramletSection],
) -> Result<usize, u32> {
    if codelet_count == 0 || codelet_count > words.len() / CODELET_WORDS {
        return Err(ERROR_MALFORMED);
    }
    let mut section_count = 0usize;
    let mut cursor = 0usize;

    while cursor < codelet_count {
        if section_count >= sections.len() || section_count >= MAX_PROGRAMLET_SECTIONS {
            return Err(ERROR_PROGRAM_CAPACITY);
        }
        let section_start = cursor;
        let (header_length, body_start) = collect_sentence(words, codelet_count, cursor)?;
        let header_view = SentenceView::new(words, cursor, header_length);
        let mut header = ParsedSentence::empty();
        let error = parse_sentence(&header_view, &mut header);
        if error != 0 {
            return Err(error);
        }
        if header.mood != MOOD_DEFINITION || !is_programlet_section_verb(&header, &header_view) {
            return Err(ERROR_MALFORMED);
        }
        let Some(section_subject) = header.field(NOMINATIVE) else {
            return Err(ERROR_MALFORMED);
        };
        let mut section_name = NameSpan::EMPTY;
        let error = name_span(&header_view, section_subject, false, &mut section_name);
        if error != 0 {
            return Err(error);
        }
        if section_name.length > MAX_PROGRAMLET_SECTION_NAME_WORDS {
            return Err(ERROR_FRAME_CAPACITY);
        }
        let mut name_words = [0u32; MAX_PROGRAMLET_SECTION_NAME_WORDS];
        let mut name_index = 0usize;
        while name_index < section_name.length {
            let value = sentence_at!(header_view, section_name.start + name_index);
            if value == 0 || value > MAX_U16 {
                return Err(ERROR_MALFORMED);
            }
            array_put!(&mut name_words, name_index, value);
            name_index += 1;
        }
        let mut prior_index = 0usize;
        while prior_index < section_count {
            let Some(previous) = sections.get(prior_index).copied() else {
                return Err(ERROR_PROGRAM_CAPACITY);
            };
            if section_names_equal(
                &previous.name_words,
                previous.name_length as usize,
                &name_words,
                section_name.length,
            ) {
                return Err(ERROR_MALFORMED);
            }
            prior_index += 1;
        }

        cursor = body_start;
        let body_start_codelet = cursor;
        loop {
            if cursor >= codelet_count {
                return Err(ERROR_MALFORMED);
            }
            let (sentence_length, next_codelet) = collect_sentence(words, codelet_count, cursor)?;
            let sentence_view = SentenceView::new(words, cursor, sentence_length);
            let mut sentence = ParsedSentence::empty();
            let error = parse_sentence(&sentence_view, &mut sentence);
            if error != 0 {
                // Programlet-only body sentences can be valid without being
                // standalone sentences understood by the section scanner.
                cursor = next_codelet;
                continue;
            }
            if is_programlet_section_verb(&sentence, &sentence_view) {
                if sentence.mood != MOOD_PARAGRAPH {
                    return Err(ERROR_MALFORMED);
                }
                let Some(closing_subject) = sentence.field(NOMINATIVE) else {
                    return Err(ERROR_MALFORMED);
                };
                let mut closing_name = NameSpan::EMPTY;
                let error = name_span(&sentence_view, closing_subject, false, &mut closing_name);
                if error != 0 {
                    return Err(error);
                }
                let mut names_match = closing_name.length == section_name.length;
                let mut closing_index = 0usize;
                while names_match && closing_index < closing_name.length {
                    names_match = array_at!(name_words, closing_index)
                        == sentence_at!(sentence_view, closing_name.start + closing_index);
                    closing_index += 1;
                }
                if !names_match {
                    return Err(ERROR_MALFORMED);
                }
                let body_count = cursor.saturating_sub(body_start_codelet);
                if body_count == 0 {
                    return Err(ERROR_PROGRAM_CAPACITY);
                }
                if !is_numeric_programlet_at(words, body_start_codelet, body_count) {
                    return Err(ERROR_UNSUPPORTED);
                }
                let Some(section) = sections.get_mut(section_count) else {
                    return Err(ERROR_PROGRAM_CAPACITY);
                };
                *section = ProgramletSection {
                    codelet_start: body_start_codelet as u32,
                    codelet_count: body_count as u32,
                    name_length: section_name.length as u32,
                    name_words,
                };
                section_count += 1;
                cursor = next_codelet;
                break;
            }
            cursor = next_codelet;
        }
        if cursor <= section_start {
            return Err(ERROR_MALFORMED);
        }
    }
    Ok(section_count)
}
