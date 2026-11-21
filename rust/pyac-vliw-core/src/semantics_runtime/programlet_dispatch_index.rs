use super::programlet_dispatch_signature::{
    MAX_ROUTINE_SIGNATURE_CASES, SignatureCase, append_case, canonical_type, compare_keys,
    compare_query, formal_type, insert_case,
};
use super::*;

#[derive(Clone, Copy)]
struct RoutineEntry {
    signature_start: u32,
    signature_length: u32,
    verb_start: u32,
    verb_length: u32,
    definition_start: u32,
    routine_start: u32,
    routine_end: u32,
    output_name_start: u32,
    output_name_length: u32,
    output_kind: u32,
}

impl RoutineEntry {
    const EMPTY: Self = Self {
        signature_start: 0,
        signature_length: 0,
        verb_start: 0,
        verb_length: 0,
        definition_start: 0,
        routine_start: 0,
        routine_end: 0,
        output_name_start: 0,
        output_name_length: 0,
        output_kind: 0,
    };
}

pub(super) struct ProgramletRoutineDirectory {
    entries: [RoutineEntry; MAX_PROGRAMLET_CODELETS],
    signatures: [u32; PROGRAMLET_SCRATCH_WORDS],
    entry_count: usize,
    signature_used: usize,
}

impl ProgramletRoutineDirectory {
    pub(super) const EMPTY: Self = Self {
        entries: [RoutineEntry::EMPTY; MAX_PROGRAMLET_CODELETS],
        signatures: [0; PROGRAMLET_SCRATCH_WORDS],
        entry_count: 0,
        signature_used: 0,
    };
}

#[derive(Clone, Copy)]
pub(super) struct SelectedProgramletRoutine {
    pub(super) name: NameSpan,
    pub(super) output_name: NameSpan,
    pub(super) output_kind: u32,
    pub(super) definition_start: usize,
    pub(super) routine_start: usize,
    pub(super) routine_end: usize,
}

fn check_status(status: u32) -> Result<(), u32> {
    if status == 0 { Ok(()) } else { Err(status) }
}

fn append_name(
    source: &[u32; PROGRAMLET_SCRATCH_WORDS],
    name: NameSpan,
    destination: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    used: &mut usize,
) -> Result<usize, u32> {
    let end = used.checked_add(name.length).ok_or(ERROR_FRAME_CAPACITY)?;
    let source_end = name
        .start
        .checked_add(name.length)
        .ok_or(ERROR_FRAME_CAPACITY)?;
    if end > destination.len() || source_end > source.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let start = *used;
    let mut index = 0;
    while index < name.length {
        array_put!(
            destination,
            start + index,
            array_at!(source, name.start + index)
        );
        index += 1;
    }
    *used = end;
    Ok(start)
}

fn definition_signature(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    directory: &mut ProgramletRoutineDirectory,
) -> Result<(usize, usize, NameSpan, usize, usize, usize, u32), u32> {
    let name_field = sentence.field(NOMINATIVE).ok_or(ERROR_MALFORMED)?;
    let output_field = sentence.field(DESTINATION).ok_or(ERROR_MALFORMED)?;
    let mut verb = NameSpan::EMPTY;
    check_status(name_span(tokens, name_field, false, &mut verb))?;
    let mut output_name = NameSpan::EMPTY;
    let mut output_kind = 0;
    check_status(typed_output_name(
        tokens,
        output_field,
        &mut output_name,
        &mut output_kind,
    ))?;

    let signature_start = directory.signature_used;
    let mut cases = [SignatureCase::EMPTY; MAX_ROUTINE_SIGNATURE_CASES];
    let mut case_count = 0;
    let mut field_index = 0;
    while field_index < sentence.field_count {
        let field = array_at!(sentence.fields, field_index);
        if field.role != NOMINATIVE
            && field.role != DESTINATION
            && field.role != FROM_INDEX
            && field.role != TO_INDEX
        {
            insert_case(
                &mut cases,
                &mut case_count,
                field.role,
                formal_type(tokens, field)?,
            )?;
        }
        field_index += 1;
    }
    insert_case(
        &mut cases,
        &mut case_count,
        DESTINATION,
        canonical_type(output_kind)?,
    )?;
    let mut index = 0;
    while index < case_count {
        append_case(
            &mut directory.signatures,
            &mut directory.signature_used,
            array_at!(&cases, index),
        )?;
        index += 1;
    }
    let verb_start = append_name(
        tokens,
        verb,
        &mut directory.signatures,
        &mut directory.signature_used,
    )?;
    let signature_length = directory.signature_used - signature_start;
    let output_name_start = append_name(
        tokens,
        output_name,
        &mut directory.signatures,
        &mut directory.signature_used,
    )?;
    Ok((
        signature_start,
        signature_length,
        verb,
        verb_start,
        output_name_start,
        output_name.length,
        output_kind,
    ))
}

fn close_matches_verb(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    signatures: &[u32; PROGRAMLET_SCRATCH_WORDS],
    verb_start: usize,
    verb_length: usize,
) -> Result<bool, u32> {
    let field = sentence.field(NOMINATIVE).ok_or(ERROR_MALFORMED)?;
    let mut closing_verb = NameSpan::EMPTY;
    check_status(name_span(tokens, field, false, &mut closing_verb))?;
    if closing_verb.length != verb_length {
        return Ok(false);
    }
    let mut index = 0;
    while index < verb_length {
        if array_at!(tokens, closing_verb.start + index)
            != array_at!(signatures, verb_start + index)
        {
            return Ok(false);
        }
        index += 1;
    }
    Ok(true)
}

pub(super) fn build_programlet_routine_directory(
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    tokens: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    boundaries: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    directory: &mut ProgramletRoutineDirectory,
) -> Result<(), u32> {
    directory.entries = [RoutineEntry::EMPTY; MAX_PROGRAMLET_CODELETS];
    directory.signatures = [0; PROGRAMLET_SCRATCH_WORDS];
    directory.entry_count = 0;
    directory.signature_used = 0;
    let mut cursor = 0;
    while cursor < codelet_count {
        let (definition_length, definition_end) = collect_sentence_at(
            words,
            base_codelet + codelet_count,
            base_codelet,
            codelet_count,
            cursor,
            tokens,
            boundaries,
        )?;
        let mut definition = ParsedSentence::empty();
        let parse_error = parse_sentence(tokens, boundaries, definition_length, &mut definition);
        if parse_error != 0 {
            return Err(parse_error);
        }
        if !is_ceremony_definition(&definition, tokens) {
            cursor = definition_end;
            continue;
        }
        let (
            signature_start,
            signature_length,
            verb,
            verb_start,
            output_name_start,
            output_name_length,
            output_kind,
        ) = definition_signature(&definition, tokens, directory)?;
        let body_start = definition_end;
        let mut body_cursor = body_start;
        let body_end = loop {
            if body_cursor >= codelet_count {
                return Err(ERROR_MALFORMED);
            }
            let (body_length, body_next) = collect_sentence_at(
                words,
                base_codelet + codelet_count,
                base_codelet,
                codelet_count,
                body_cursor,
                tokens,
                boundaries,
            )?;
            let is_branch = contains_marked_token(tokens, boundaries, body_length, CONDITIONAL);
            let mut body_sentence = ParsedSentence::empty();
            if !is_branch {
                let error = parse_sentence(tokens, boundaries, body_length, &mut body_sentence);
                if error != 0 {
                    return Err(error);
                }
            }
            if !is_branch && is_ceremony_definition(&body_sentence, tokens) {
                return Err(ERROR_MALFORMED);
            }
            if !is_branch && body_sentence.mood == MOOD_PARAGRAPH {
                if !close_matches_verb(
                    &body_sentence,
                    tokens,
                    &directory.signatures,
                    verb_start,
                    verb.length,
                )? {
                    return Err(ERROR_MALFORMED);
                }
                break body_next;
            }
            body_cursor = body_next;
        };
        if directory.entry_count == directory.entries.len() {
            return Err(ERROR_PROGRAM_CAPACITY);
        }
        array_put!(
            &mut directory.entries,
            directory.entry_count,
            RoutineEntry {
                signature_start: signature_start as u32,
                signature_length: signature_length as u32,
                verb_start: verb_start as u32,
                verb_length: verb.length as u32,
                definition_start: cursor as u32,
                routine_start: body_start as u32,
                routine_end: body_end as u32,
                output_name_start: output_name_start as u32,
                output_name_length: output_name_length as u32,
                output_kind,
            }
        );
        directory.entry_count += 1;
        cursor = body_end;
    }
    sort_directory(directory)
}

fn sort_directory(directory: &mut ProgramletRoutineDirectory) -> Result<(), u32> {
    let mut index = 1;
    while index < directory.entry_count {
        let entry = array_at!(&directory.entries, index);
        let mut destination = index;
        while destination > 0 {
            let previous = array_at!(&directory.entries, destination - 1);
            if compare_keys(
                &directory.signatures,
                entry.signature_start as usize,
                entry.signature_length as usize,
                previous.signature_start as usize,
                previous.signature_length as usize,
            ) >= 0
            {
                break;
            }
            array_put!(&mut directory.entries, destination, previous);
            destination -= 1;
        }
        array_put!(&mut directory.entries, destination, entry);
        index += 1;
    }
    let mut index = 1;
    while index < directory.entry_count {
        let previous = array_at!(&directory.entries, index - 1);
        let current = array_at!(&directory.entries, index);
        if compare_keys(
            &directory.signatures,
            previous.signature_start as usize,
            previous.signature_length as usize,
            current.signature_start as usize,
            current.signature_length as usize,
        ) == 0
        {
            return Err(ERROR_DUPLICATE_SIGNATURE);
        }
        index += 1;
    }
    Ok(())
}

fn make_call_signature(
    sentence: &ParsedSentence,
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    argument_count: u32,
    output_kind: u32,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    key: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
) -> Result<usize, u32> {
    if argument_count as usize > arguments.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let mut cases = [SignatureCase::EMPTY; MAX_ROUTINE_SIGNATURE_CASES];
    let mut case_count = 0;
    let mut index = 0;
    while index < argument_count as usize {
        let argument = array_at!(arguments, index);
        if argument.role != FROM_INDEX && argument.role != TO_INDEX {
            insert_case(
                &mut cases,
                &mut case_count,
                argument.role,
                canonical_type(argument.value_kind)?,
            )?;
        }
        index += 1;
    }
    insert_case(
        &mut cases,
        &mut case_count,
        DESTINATION,
        canonical_type(output_kind)?,
    )?;
    let mut used = 0;
    index = 0;
    while index < case_count {
        append_case(key, &mut used, array_at!(&cases, index))?;
        index += 1;
    }
    if sentence.verb_length == 0 || used + sentence.verb_length > key.len() {
        return Err(ERROR_MALFORMED);
    }
    index = 0;
    while index < sentence.verb_length {
        let token = array_at!(tokens, sentence.verb_start + index);
        if token > MAX_U16 {
            return Err(ERROR_MALFORMED);
        }
        array_put!(key, used, token);
        used += 1;
        index += 1;
    }
    Ok(used)
}

pub(super) fn resolve_programlet_routine(
    directory: &ProgramletRoutineDirectory,
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    scratch: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_words: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_used: &mut usize,
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    argument_count: u32,
    output_kind: u32,
) -> Result<SelectedProgramletRoutine, u32> {
    let key_length = make_call_signature(
        sentence,
        arguments,
        argument_count,
        output_kind,
        tokens,
        scratch,
    )?;
    let mut low = 0;
    let mut high = directory.entry_count;
    while low < high {
        let middle = low + (high - low) / 2;
        let entry = array_at!(&directory.entries, middle);
        let ordering = compare_query(
            &directory.signatures,
            entry.signature_start as usize,
            entry.signature_length as usize,
            scratch,
            key_length,
        );
        if ordering < 0 {
            low = middle + 1;
            continue;
        }
        if ordering > 0 {
            high = middle;
            continue;
        }
        let mut name = NameSpan::EMPTY;
        let name_error = store_name(
            &directory.signatures,
            NameSpan {
                start: entry.verb_start as usize,
                length: entry.verb_length as usize,
            },
            symbol_words,
            symbol_used,
            &mut name,
        );
        if name_error != 0 {
            return Err(name_error);
        }
        let mut output_name = NameSpan::EMPTY;
        let output_name_error = store_name(
            &directory.signatures,
            NameSpan {
                start: entry.output_name_start as usize,
                length: entry.output_name_length as usize,
            },
            symbol_words,
            symbol_used,
            &mut output_name,
        );
        if output_name_error != 0 {
            return Err(output_name_error);
        }
        return Ok(SelectedProgramletRoutine {
            name,
            output_name,
            output_kind: entry.output_kind,
            definition_start: entry.definition_start as usize,
            routine_start: entry.routine_start as usize,
            routine_end: entry.routine_end as usize,
        });
    }
    Err(ERROR_UNSUPPORTED)
}
