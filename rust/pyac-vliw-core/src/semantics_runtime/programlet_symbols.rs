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
