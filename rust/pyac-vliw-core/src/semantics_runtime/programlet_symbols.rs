use super::*;

pub(super) trait ProgramletWordSource {
    fn word_count(&self) -> usize;
    fn word_at(&self, index: usize) -> Option<u32>;
}

impl<const WORDS: usize> ProgramletWordSource for [u32; WORDS]
where
    [u32; WORDS]: FixedArrayAccess<Item = u32>,
{
    fn word_count(&self) -> usize {
        WORDS
    }

    fn word_at(&self, index: usize) -> Option<u32> {
        if index >= WORDS {
            return None;
        }
        let mut value = 0;
        if self.read_at(index, &mut value) {
            Some(value)
        } else {
            None
        }
    }
}

impl ProgramletWordSource for SentenceView<'_> {
    fn word_count(&self) -> usize {
        self.len()
    }

    fn word_at(&self, index: usize) -> Option<u32> {
        self.token(index)
    }
}

pub(super) fn names_equal<L: ProgramletWordSource + ?Sized, R: ProgramletWordSource + ?Sized>(
    left: &L,
    left_span: NameSpan,
    right: &R,
    right_span: NameSpan,
) -> bool {
    if left_span.length != right_span.length
        || left_span.start + left_span.length > left.word_count()
        || right_span.start + right_span.length > right.word_count()
    {
        return false;
    }
    let mut index = 0;
    while index < left_span.length {
        if left.word_at(left_span.start + index) != right.word_at(right_span.start + index) {
            return false;
        }
        index += 1;
    }
    true
}

pub(super) fn store_name(
    source: &SentenceView<'_>,
    span: NameSpan,
    storage: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
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
        while cursor < *used && array_at!(*storage, cursor) != SYMBOL_NAME_SEPARATOR {
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
            source.token(span.start + index).unwrap_or(0)
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

pub(super) fn store_name_from_slice(
    source: &[u32],
    source_base: usize,
    span: NameSpan,
    storage: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    used: &mut usize,
    stored: &mut NameSpan,
) -> u32 {
    let Some(end) = span.start.checked_add(span.length) else {
        return ERROR_MALFORMED;
    };
    let Some(source_end) = source_base.checked_add(end) else {
        return ERROR_MALFORMED;
    };
    if source_end > source.len() {
        return ERROR_FRAME_CAPACITY;
    }
    if *used > storage.len() {
        return ERROR_FRAME_CAPACITY;
    }
    let mut cursor = 0;
    while cursor < *used {
        let entry_start = cursor;
        while cursor < *used && array_at!(*storage, cursor) != SYMBOL_NAME_SEPARATOR {
            cursor += 1;
        }
        if cursor == *used {
            return ERROR_MALFORMED;
        }
        let entry_length = cursor - entry_start;
        let mut equal = entry_length == span.length;
        let mut index = 0;
        while equal && index < span.length {
            equal = source_word(source, source_base + span.start + index)
                == Some(array_at!(*storage, entry_start + index));
            index += 1;
        }
        if equal {
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
            source_word(source, source_base + span.start + index).unwrap_or(0)
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

fn source_word(source: &[u32], index: usize) -> Option<u32> {
    if index >= source.len() {
        return None;
    }
    #[cfg(target_arch = "spirv")]
    {
        // SAFETY: the check proves the index is within the source slice.
        Some(unsafe {
            *<[u32] as spirv_std::arch::IndexUnchecked<u32>>::index_unchecked(source, index)
        })
    }
    #[cfg(not(target_arch = "spirv"))]
    {
        Some(source[index])
    }
}

pub(super) fn find_local_slot<const SLOTS: usize>(
    source: &SentenceView<'_>,
    span: NameSpan,
    storage: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    slots: &[NumericLocalSlot; SLOTS],
) -> Option<usize>
where
    [NumericLocalSlot; SLOTS]: FixedArrayAccess<Item = NumericLocalSlot>,
{
    let Some(source_end) = span.start.checked_add(span.length) else {
        return None;
    };
    if source_end > source.len() {
        return None;
    }
    let mut index = 0;
    while index < slots.len() {
        let slot = array_at!(*slots, index);
        if slot.kind != 0 && slot.name_length as usize == span.length {
            let stored_start = slot.name_offset as usize;
            let Some(stored_end) = stored_start.checked_add(span.length) else {
                index += 1;
                continue;
            };
            if stored_end <= storage.len() {
                let mut name_index = 0;
                let mut same = true;
                while same && name_index < span.length {
                    same = sentence_at!(*source, span.start + name_index)
                        == array_at!(*storage, stored_start + name_index);
                    name_index += 1;
                }
                if same {
                    return Some(index);
                }
            }
        }
        index += 1;
    }
    None
}

pub(super) fn find_local_slot_in_storage<const SLOTS: usize>(
    storage: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    span: NameSpan,
    slots: &[NumericLocalSlot; SLOTS],
) -> Option<usize>
where
    [NumericLocalSlot; SLOTS]: FixedArrayAccess<Item = NumericLocalSlot>,
{
    let mut index = 0;
    while index < slots.len() {
        let slot = array_at!(*slots, index);
        if slot.kind != 0
            && names_equal(
                storage,
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

pub(super) fn is_ceremony_definition(sentence: &ParsedSentence, tokens: &SentenceView<'_>) -> bool {
    sentence.mood == MOOD_DEFINITION
        && sentence.verb_length == 1
        && sentence_at!(*tokens, sentence.verb_start) == CEREMONY
}
