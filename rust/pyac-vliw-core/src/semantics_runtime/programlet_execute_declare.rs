use super::*;

#[inline(never)]
pub(super) fn declare_programlet_local(
    sentence: &ParsedSentence,
    sentence_view: &SentenceView<'_>,
    symbol_words: &mut [u32; MAX_PROGRAMLET_PAYLOAD_WORDS],
    symbol_used: &mut usize,
    frame: &mut ProgramletFrame,
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    if frame.action_started != 0 || sentence.field_count != 3 {
        return Err(ERROR_MALFORMED);
    }
    let (Some(su), Some(ob), Some(as_field)) = (
        sentence.field(NOMINATIVE),
        sentence.field(ACCUSATIVE),
        sentence.field(ESSIVE),
    ) else {
        return Err(ERROR_MALFORMED);
    };
    let mut name = NameSpan::EMPTY;
    let name_error = name_span(sentence_view, su, false, &mut name);
    if name_error != 0 {
        return Err(name_error);
    }
    let value_kind = if sentence_at!(*sentence_view, sentence.verb_start) == BOOLEAN_VERB {
        VALUE_BOOLEAN
    } else {
        VALUE_NUMBER
    };
    let expected_verb = if value_kind == VALUE_BOOLEAN {
        BOOLEAN_VERB
    } else {
        NUMBER_VERB
    };
    let mut value = ProgramletNumber::EMPTY;
    let value_error = resolve_programlet_value(
        sentence_view,
        ob,
        symbol_words,
        arguments,
        slots,
        &mut value,
    );
    if value_error != 0 {
        return Err(value_error);
    }
    if !number_kind_matches(value_kind, value.kind) {
        return Err(ERROR_UNSUPPORTED);
    }
    let kind = if as_field.length == 2
        && sentence_at!(*sentence_view, as_field.start) == NAME_TYPE
        && sentence_at!(*sentence_view, as_field.start + 1) == VARIABLE
    {
        if value_kind == VALUE_BOOLEAN { 3 } else { 1 }
    } else if as_field.length == 3
        && sentence_at!(*sentence_view, as_field.start) == NAME_TYPE
        && sentence_at!(*sentence_view, as_field.start + 1) == PERMANENTLY
        && sentence_at!(*sentence_view, as_field.start + 2) == expected_verb
    {
        if value_kind == VALUE_BOOLEAN { 4 } else { 2 }
    } else {
        return Err(ERROR_UNSUPPORTED);
    };
    let slot_index = if let Some(existing) =
        find_local_slot(sentence_view, name, symbol_words, slots)
    {
        existing
    } else {
        let mut free = 0;
        while free < MAX_PROGRAMLET_LOCAL_SLOTS && array_at!(*slots, free).kind != 0 {
            free += 1;
        }
        if free == MAX_PROGRAMLET_LOCAL_SLOTS {
            return Err(ERROR_FRAME_CAPACITY);
        }
        let mut stored = NameSpan::EMPTY;
        let name_error = store_name(sentence_view, name, symbol_words, symbol_used, &mut stored);
        if name_error != 0 {
            return Err(name_error);
        }
        let mut slot = array_at!(*slots, free);
        slot.name_offset = stored.start as u32;
        slot.name_length = stored.length as u32;
        array_put!(slots, free, slot);
        free
    };
    let mut slot = array_at!(*slots, slot_index);
    slot.value = value.bits;
    slot.kind = kind;
    slot.value_kind = value.kind;
    array_put!(slots, slot_index, slot);

    Ok(())
}
