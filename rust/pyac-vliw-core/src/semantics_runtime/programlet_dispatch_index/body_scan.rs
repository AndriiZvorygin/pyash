use super::*;

pub(super) fn find_routine_body_end(
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
    body_start: usize,
    signatures: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    verb_start: usize,
    verb_length: usize,
) -> Result<usize, u32> {
    let mut body_cursor = body_start;
    loop {
        if body_cursor >= codelet_count {
            return Err(ERROR_MALFORMED);
        }
        let (body_length, body_next) = collect_sentence_at(
            words,
            base_codelet + codelet_count,
            base_codelet,
            codelet_count,
            body_cursor,
        )?;
        let body_view = SentenceView::new(words, base_codelet + body_cursor, body_length);
        let is_branch = contains_marked_token(&body_view, CONDITIONAL);
        let mut body_sentence = ParsedSentence::empty();
        let final_token = sentence_at!(body_view, body_view.len() - 1);
        if !is_branch && matches!(final_token, MOOD_DEFINITION | MOOD_PARAGRAPH) {
            let error = parse_sentence(&body_view, &mut body_sentence);
            if error != 0 {
                return Err(error);
            }
        }
        if !is_branch
            && final_token == MOOD_DEFINITION
            && is_ceremony_definition(&body_sentence, &body_view)
        {
            return Err(ERROR_MALFORMED);
        }
        if !is_branch && final_token == MOOD_PARAGRAPH {
            if !close_matches_verb(
                &body_sentence,
                &body_view,
                signatures,
                verb_start,
                verb_length,
            )? {
                return Err(ERROR_MALFORMED);
            }
            return Ok(body_next);
        }
        body_cursor = body_next;
    }
}

fn close_matches_verb(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
    signatures: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    verb_start: usize,
    verb_length: usize,
) -> Result<bool, u32> {
    let field = sentence.field(NOMINATIVE).ok_or(ERROR_MALFORMED)?;
    let mut closing_verb = NameSpan::EMPTY;
    let status = name_span(tokens, field, false, &mut closing_verb);
    if status != 0 {
        return Err(status);
    }
    if closing_verb.length != verb_length {
        return Ok(false);
    }
    let mut index = 0;
    while index < verb_length {
        if sentence_at!(*tokens, closing_verb.start + index)
            != array_at!(*signatures, verb_start + index)
        {
            return Ok(false);
        }
        index += 1;
    }
    Ok(true)
}
