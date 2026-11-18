use super::*;

pub(super) fn names_equal<const WORDS: usize>(
    left: &[u32; WORDS],
    left_span: NameSpan,
    right: &[u32; WORDS],
    right_span: NameSpan,
) -> bool
where
    [u32; WORDS]: FixedArrayAccess<Item = u32>,
{
    if left_span.length != right_span.length
        || left_span.start + left_span.length > left.len()
        || right_span.start + right_span.length > right.len()
    {
        return false;
    }
    let mut index = 0;
    while index < left_span.length {
        if array_at!(left, left_span.start + index) != array_at!(right, right_span.start + index) {
            return false;
        }
        index += 1;
    }
    true
}

pub(super) fn store_name(
    source: &[u32; PROGRAMLET_SCRATCH_WORDS],
    span: NameSpan,
    storage: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    used: &mut usize,
    stored: &mut NameSpan,
) -> u32 {
    let Some(end) = span.start.checked_add(span.length) else {
        return ERROR_MALFORMED;
    };
    if end > source.len() {
        return ERROR_FRAME_CAPACITY;
    }
    if *used > storage.len() {
        return ERROR_FRAME_CAPACITY;
    }
    let mut cursor = 0;
    while cursor < *used {
        let entry_start = cursor;
        while cursor < *used && array_at!(storage, cursor) != SYMBOL_NAME_SEPARATOR {
            cursor += 1;
        }
        if cursor == *used {
            return ERROR_MALFORMED;
        }
        let entry_length = cursor - entry_start;
        if entry_length == span.length
            && names_equal(
                source,
                span,
                storage,
                NameSpan {
                    start: entry_start,
                    length: entry_length,
                },
            )
        {
            *stored = NameSpan {
                start: entry_start,
                length: entry_length,
            };
            return 0;
        }
        cursor += 1;
    }
    let Some(entry_length) = span.length.checked_add(1) else {
        return ERROR_FRAME_CAPACITY;
    };
    let Some(stored_end) = used.checked_add(entry_length) else {
        return ERROR_FRAME_CAPACITY;
    };
    if stored_end > storage.len() {
        return ERROR_FRAME_CAPACITY;
    }
    let start = *used;
    let mut index = 0;
    while index < span.length {
        array_put!(
            storage,
            start + index,
            array_at!(source, span.start + index)
        );
        index += 1;
    }
    array_put!(storage, start + span.length, SYMBOL_NAME_SEPARATOR);
    *used = stored_end;
    *stored = NameSpan {
        start,
        length: span.length,
    };
    0
}

pub(super) fn find_local_slot<const SLOTS: usize>(
    source: &[u32; PROGRAMLET_SCRATCH_WORDS],
    span: NameSpan,
    storage: &[u32; PROGRAMLET_SCRATCH_WORDS],
    slots: &[NumericLocalSlot; SLOTS],
) -> Option<usize>
where
    [NumericLocalSlot; SLOTS]: FixedArrayAccess<Item = NumericLocalSlot>,
{
    let mut index = 0;
    while index < slots.len() {
        let slot = array_at!(slots, index);
        if slot.kind != 0
            && names_equal(
                source,
                span,
                storage,
                NameSpan {
                    start: slot.name_offset as usize,
                    length: slot.name_length as usize,
                },
            )
        {
            return Some(index);
        }
        index += 1;
    }
    None
}

pub(super) fn is_ceremony_definition(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
) -> bool {
    sentence.mood == MOOD_DEFINITION
        && sentence.verb_length == 1
        && array_at!(tokens, sentence.verb_start) == CEREMONY
}

pub(super) fn find_programlet_routine(
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    target: NameSpan,
    sentence_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    sentence_boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_used: &mut usize,
    routine_name: &mut NameSpan,
    routine_output_name: &mut NameSpan,
    routine_start: &mut usize,
    routine_end: &mut usize,
    routine_kind: &mut u32,
) -> u32 {
    let mut cursor = 0;
    while cursor < codelet_count {
        let (length, next_codelet) = match collect_sentence_at(
            words,
            base_codelet + codelet_count,
            base_codelet,
            codelet_count,
            cursor,
            sentence_words,
            sentence_boundaries,
        ) {
            Ok(group) => group,
            Err(error) => return error,
        };
        let mut sentence = ParsedSentence::empty();
        let parse_error =
            parse_sentence(sentence_words, sentence_boundaries, length, &mut sentence);
        if parse_error != 0 {
            return parse_error;
        }
        if !is_ceremony_definition(&sentence, sentence_words) {
            cursor = next_codelet;
            continue;
        }
        let Some(su) = sentence.field(NOMINATIVE) else {
            return ERROR_MALFORMED;
        };
        let Some(output) = sentence.field(DESTINATION) else {
            return ERROR_MALFORMED;
        };
        let mut output_name = NameSpan::EMPTY;
        let mut output_kind = 0;
        let output_error =
            typed_output_name(sentence_words, output, &mut output_name, &mut output_kind);
        if output_error != 0 {
            return output_error;
        }
        let mut source_name = NameSpan::EMPTY;
        let name_error = name_span(sentence_words, su, false, &mut source_name);
        if name_error != 0 {
            return name_error;
        }
        let matches_target = names_equal(sentence_words, source_name, symbol_words, target);
        let stored_name = if matches_target {
            let mut stored = NameSpan::EMPTY;
            let error = store_name(
                sentence_words,
                source_name,
                symbol_words,
                symbol_used,
                &mut stored,
            );
            if error != 0 {
                return error;
            }
            stored
        } else {
            NameSpan {
                start: 0,
                length: 0,
            }
        };
        let stored_output_name = if matches_target {
            let mut stored = NameSpan::EMPTY;
            let error = store_name(
                sentence_words,
                output_name,
                symbol_words,
                symbol_used,
                &mut stored,
            );
            if error != 0 {
                return error;
            }
            stored
        } else {
            NameSpan::EMPTY
        };
        let body_start = next_codelet;
        cursor = body_start;
        loop {
            if cursor >= codelet_count {
                return ERROR_MALFORMED;
            }
            let (body_length, body_next) = match collect_sentence_at(
                words,
                base_codelet + codelet_count,
                base_codelet,
                codelet_count,
                cursor,
                sentence_words,
                sentence_boundaries,
            ) {
                Ok(group) => group,
                Err(error) => return error,
            };
            let is_branch = contains_marked_token(
                sentence_words,
                sentence_boundaries,
                body_length,
                CONDITIONAL,
            );
            let mut body_sentence = ParsedSentence::empty();
            if !is_branch {
                let error = parse_sentence(
                    sentence_words,
                    sentence_boundaries,
                    body_length,
                    &mut body_sentence,
                );
                if error != 0 {
                    return error;
                }
            }
            if !is_branch && is_ceremony_definition(&body_sentence, sentence_words) {
                return ERROR_MALFORMED;
            }
            if !is_branch && body_sentence.mood == MOOD_PARAGRAPH {
                if matches_target {
                    let closing_su = match body_sentence.field(NOMINATIVE) {
                        Some(field) => field,
                        None => return ERROR_MALFORMED,
                    };
                    let mut closing_name = NameSpan::EMPTY;
                    let name_error =
                        name_span(sentence_words, closing_su, false, &mut closing_name);
                    if name_error != 0 {
                        return name_error;
                    }
                    if !names_equal(sentence_words, closing_name, symbol_words, stored_name) {
                        return ERROR_MALFORMED;
                    }
                    *routine_name = stored_name;
                    *routine_output_name = stored_output_name;
                    *routine_start = body_start;
                    *routine_end = body_next;
                    *routine_kind = output_kind;
                    return 0;
                }
                cursor = body_next;
                break;
            }
            cursor = body_next;
        }
    }
    ERROR_UNSUPPORTED
}
