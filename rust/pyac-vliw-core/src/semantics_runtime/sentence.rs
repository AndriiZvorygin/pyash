use super::*;

#[derive(Clone, Copy)]
pub(super) struct SentenceView<'a, W: VliwWord> {
    words: &'a [W],
    start_word_index: usize,
    token_count: usize,
}

/// A borrowed Phrase-like span over codelet payloads and their header marks.
/// Reads stay on the source page; parsing does not flatten sentences into scratch arrays.
impl<'a, W: VliwWord> SentenceView<'a, W> {
    pub(super) fn new(
        words: &'a [W],
        start_codelet: usize,
        token_count: usize,
    ) -> SentenceView<'a, W> {
        SentenceView {
            words,
            start_word_index: start_codelet * CODELET_WORDS + 1,
            token_count,
        }
    }

    pub(super) fn word_index(&self, index: usize) -> usize {
        Self::word_index_from(self.start_word_index, index)
    }

    fn word_index_from(start_word_index: usize, index: usize) -> usize {
        let start_codelet = start_word_index / CODELET_WORDS;
        let start_slot = start_word_index % CODELET_WORDS;
        let first_codelet_words = CODELET_WORDS - start_slot;
        if index < first_codelet_words {
            start_word_index + index
        } else {
            let remaining = index - first_codelet_words;
            (start_codelet + 1 + remaining / (CODELET_WORDS - 1)) * CODELET_WORDS
                + remaining % (CODELET_WORDS - 1)
                + 1
        }
    }

    pub(super) fn word_at_word_index(&self, start_word_index: usize, index: usize) -> u32 {
        let source_index = Self::word_index_from(start_word_index, index);
        // SAFETY: callers validate this index against the collected span.
        unsafe { input_word_unchecked(self.words, source_index) }
    }

    pub(super) fn word_span_is_valid(&self, start_word_index: usize, token_count: usize) -> bool {
        let start_slot = start_word_index % CODELET_WORDS;
        if start_slot == 0 || token_count == 0 {
            return false;
        }
        Self::word_index_from(start_word_index, token_count - 1) < self.words.len()
    }

    pub(super) fn len(&self) -> usize {
        self.token_count
    }

    pub(super) fn token(&self, index: usize) -> Option<u32> {
        if index >= self.token_count {
            return None;
        }
        let value = self.word_at_word_index(self.start_word_index, index);
        (value <= MAX_U16).then_some(value)
    }

    pub(super) fn token_unchecked(&self, index: usize) -> u32 {
        let source_index = self.word_index(index);
        // SAFETY: callers validate the logical index against the collected
        // span, whose codelets and payload words were validated on collection.
        unsafe { input_word_unchecked(self.words, source_index) }
    }

    pub(super) fn token_or_first(&self, index: usize) -> u32 {
        if index < self.token_count {
            self.token_unchecked(index)
        } else if self.token_count > 0 {
            self.token_unchecked(0)
        } else {
            0
        }
    }

    /// Head word of the codelet that holds logical token `index`.
    pub(super) fn header_for(&self, index: usize) -> u32 {
        let source_index = self.word_index(index);
        word(self.words, source_index / CODELET_WORDS, 0)
    }

    /// Slot position (1..CODELET_WORDS) of logical token `index`.
    pub(super) fn slot_for(&self, index: usize) -> usize {
        self.word_index(index) % CODELET_WORDS
    }

    /// Read a payload word by its absolute source index.
    #[cfg(test)]
    pub(super) fn source_word(&self, source_index: usize) -> u32 {
        // SAFETY: callers pass an index validated by the collected sentence span.
        unsafe { input_word_unchecked(self.words, source_index) }
    }

    pub(super) fn boundary(&self, index: usize) -> bool {
        if index >= self.token_count {
            return false;
        }
        let source_index = self.word_index(index);
        let codelet = source_index / CODELET_WORDS;
        let slot = source_index % CODELET_WORDS;
        let header = word(self.words, codelet, 0);
        let complete = header & 1 != 0;
        (header & (1 << slot) != 0) == complete
    }

    #[cfg(test)]
    pub(super) fn boundary_unchecked(&self, index: usize) -> bool {
        let source_index = self.word_index(index);
        let codelet = source_index / CODELET_WORDS;
        let slot = source_index % CODELET_WORDS;
        let source_index = codelet * CODELET_WORDS;
        // SAFETY: callers validate the logical index against the collected span.
        let header = unsafe { input_word_unchecked(self.words, source_index) };
        let complete = header & 1 != 0;
        (header & (1 << slot) != 0) == complete
    }
}

/// Validate one sentence and return its payload length and next codelet offset.
/// Scalar span metadata avoids materializing a token buffer on the GPU path.
pub(super) fn collect_sentence(
    words: &[impl VliwWord],
    codelet_count: usize,
    start: usize,
) -> Result<(usize, usize), u32> {
    collect_sentence_at(words, codelet_count, 0, codelet_count, start)
}

pub(super) fn collect_sentence_at(
    words: &[impl VliwWord],
    total_codelet_count: usize,
    base_codelet: usize,
    window_codelet_count: usize,
    start: usize,
) -> Result<(usize, usize), u32> {
    if start >= window_codelet_count
        || base_codelet > total_codelet_count
        || window_codelet_count > total_codelet_count - base_codelet
        || total_codelet_count > words.len() / CODELET_WORDS
    {
        return Err(ERROR_MALFORMED);
    }
    let mut token_count = 0;
    let mut codelet = start;
    loop {
        if codelet >= window_codelet_count {
            return Err(ERROR_MALFORMED);
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
            return Err(ERROR_MALFORMED);
        }
        let last_slot = if complete {
            last_boundary
        } else {
            CODELET_WORDS - 1
        };
        slot = 1;
        while slot <= last_slot {
            let value = word(words, absolute_codelet, slot);
            if value > MAX_U16 {
                return Err(ERROR_MALFORMED);
            }
            token_count += 1;
            slot += 1;
        }
        codelet += 1;
        if complete {
            return Ok((token_count, codelet));
        }
    }
}

pub(super) fn parse_sentence(
    tokens: &SentenceView<'_, impl VliwWord>,
    parsed: &mut ParsedSentence,
) -> u32 {
    parse_sentence_range(tokens, 0, tokens.len(), parsed)
}

pub(super) struct FieldBuilder {
    fields: [SentenceField; MAX_SENTENCE_FIELDS],
    field_count: usize,
    seen_roles: u32,
    value_start: usize,
    verb_start: usize,
    verb_length: usize,
    mood: u32,
}

impl FieldBuilder {
    pub(super) const fn new(start: usize) -> Self {
        Self {
            fields: [SentenceField::EMPTY; MAX_SENTENCE_FIELDS],
            field_count: 0,
            seen_roles: 0,
            value_start: start,
            verb_start: 0,
            verb_length: 0,
            mood: 0,
        }
    }

    fn accept_boundary(
        &mut self,
        tokens: &SentenceView<'_, impl VliwWord>,
        token: u32,
        offset: usize,
        end: usize,
    ) -> u32 {
        let role_bit = match token {
            NOMINATIVE => 1 << 0,
            ACCUSATIVE => 1 << 1,
            ESSIVE => 1 << 2,
            DESTINATION => 1 << 3,
            SOURCE => 1 << 4,
            COMITATIVE => 1 << 5,
            INSTRUMENTAL => 1 << 6,
            FROM_INDEX => 1 << 7,
            TO_INDEX => 1 << 8,
            LOCATIVE => 1 << 9,
            _ => 0,
        };
        if role_bit != 0 {
            let field_index = self.field_count;
            if self.value_start >= offset
                || field_index >= MAX_SENTENCE_FIELDS
                || self.seen_roles & role_bit != 0
                || validate_field_tags(tokens, self.value_start, offset) != 0
            {
                return ERROR_MALFORMED;
            }
            array_put!(
                &mut self.fields,
                field_index,
                SentenceField {
                    role: token,
                    start: self.value_start,
                    length: offset - self.value_start,
                }
            );
            self.seen_roles |= role_bit;
            self.field_count = field_index + 1;
            self.value_start = offset + 1;
            return 0;
        }
        if matches!(
            token,
            MOOD_DEFINITION | REALIS | DEONTIC | CONDITIONAL | MOOD_RETURN | MOOD_PARAGRAPH
        ) {
            let verb_length = offset - self.value_start;
            if self.mood != 0
                || (verb_length == 0 && token != MOOD_RETURN)
                || (verb_length != 0 && token == MOOD_RETURN)
                || offset + 1 != end
            {
                return ERROR_MALFORMED;
            }
            self.verb_start = self.value_start;
            self.verb_length = verb_length;
            self.mood = token;
            return 0;
        }
        ERROR_UNSUPPORTED
    }

    /// Clause-free decode: the head bitmap is the field map, so only boundary
    /// slots are read and value words are never decoded.
    pub(super) fn parse_from_boundaries(
        &mut self,
        tokens: &SentenceView<'_, impl VliwWord>,
        start: usize,
        end: usize,
    ) -> u32 {
        let mut offset = start;
        while offset < end {
            let header = tokens.header_for(offset);
            let complete = header & 1 != 0;
            let mut slot = tokens.slot_for(offset);
            while slot < CODELET_WORDS && offset < end {
                if (header & (1 << slot) != 0) == complete {
                    let token = tokens.token_unchecked(offset);
                    let error = self.accept_boundary(tokens, token, offset, end);
                    if error != 0 || self.mood != 0 {
                        return error;
                    }
                }
                slot += 1;
                offset += 1;
            }
        }
        0
    }

    /// Clause-aware decode. Clause markers may sit anywhere, so they are
    /// recognized before the boundary test, exactly as the previous parser did.
    fn parse_with_clauses(
        &mut self,
        tokens: &SentenceView<'_, impl VliwWord>,
        start: usize,
        end: usize,
    ) -> u32 {
        let mut depth = 0usize;
        let mut index = start;
        while index < end {
            let token = tokens.token_unchecked(index);
            if token == DEPENDENT_CLAUSE {
                depth += 1;
                index += 1;
                continue;
            }
            if token == CLAUSE_TAIL {
                if depth == 0 {
                    return ERROR_MALFORMED;
                }
                depth -= 1;
                index += 1;
                continue;
            }
            if depth == 0 && tokens.boundary(index) {
                let error = self.accept_boundary(tokens, token, index, end);
                if error != 0 || self.mood != 0 {
                    return error;
                }
            }
            index += 1;
        }
        0
    }

    fn finish(&self, parsed: &mut ParsedSentence) -> u32 {
        if self.mood == 0 {
            return ERROR_MALFORMED;
        }
        let mut result = ParsedSentence::empty();
        let mut index = 0;
        while index < self.field_count {
            array_put!(&mut result.fields, index, array_at!(self.fields, index));
            index += 1;
        }
        result.field_count = self.field_count;
        result.verb_start = self.verb_start;
        result.verb_length = self.verb_length;
        result.mood = self.mood;
        *parsed = result;
        0
    }
}

pub(super) fn parse_sentence_range(
    tokens: &SentenceView<'_, impl VliwWord>,
    start: usize,
    end: usize,
    parsed: &mut ParsedSentence,
) -> u32 {
    if start >= end || end > tokens.len() {
        return ERROR_MALFORMED;
    }
    // Clause markers are not phrase boundaries, so a sentence without them can
    // be decoded from the head bitmap alone. This pass cannot fail; it only
    // chooses the decode form, so error order is unchanged.
    let mut has_clause = false;
    let mut index = start;
    while index < end {
        let token = tokens.token_unchecked(index);
        if token == DEPENDENT_CLAUSE || token == CLAUSE_TAIL {
            has_clause = true;
            break;
        }
        index += 1;
    }
    let mut builder = FieldBuilder::new(start);
    let error = if has_clause {
        builder.parse_with_clauses(tokens, start, end)
    } else {
        builder.parse_from_boundaries(tokens, start, end)
    };
    if error != 0 {
        return error;
    }
    builder.finish(parsed)
}

pub(super) fn clause_tail(
    tokens: &SentenceView<'_, impl VliwWord>,
    start: usize,
    end: usize,
) -> Option<usize> {
    if start >= end || end > tokens.len() {
        return None;
    }
    let mut depth = 0usize;
    let mut index = start;
    while index < end {
        let token = tokens.token_unchecked(index);
        if token == DEPENDENT_CLAUSE {
            depth += 1;
        } else if token == CLAUSE_TAIL {
            if depth == 0 {
                return None;
            }
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
        index += 1;
    }
    None
}

pub(super) fn embedded_clause_range(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
) -> Result<(usize, usize), u32> {
    let Some(end) = field.start.checked_add(field.length) else {
        return Err(ERROR_MALFORMED);
    };
    if field.length < 3 || end > tokens.len() {
        return Err(ERROR_MALFORMED);
    }
    if tokens.token_unchecked(field.start) != DEPENDENT_CLAUSE {
        return Err(ERROR_UNSUPPORTED);
    }
    let Some(tail) = clause_tail(tokens, field.start, end) else {
        return Err(ERROR_MALFORMED);
    };
    if tail + 1 != end {
        return Err(ERROR_MALFORMED);
    }
    Ok((field.start + 1, tail))
}

pub(super) fn next_sentence_is_paragraph_end(
    words: &[impl VliwWord],
    codelet_count: usize,
    base_codelet: usize,
    start: usize,
    routine_end: usize,
) -> Result<bool, u32> {
    if start >= routine_end {
        return Ok(false);
    }
    let (token_count, _) = collect_sentence_at(
        words,
        base_codelet + codelet_count,
        base_codelet,
        codelet_count,
        start,
    )?;
    let tokens = SentenceView::new(words, base_codelet + start, token_count);
    let mut next = ParsedSentence::empty();
    let error = parse_sentence(&tokens, &mut next);
    if error != 0 {
        return Err(error);
    }
    Ok(next.mood == MOOD_PARAGRAPH)
}

pub(super) fn contains_marked_token(tokens: &SentenceView<'_, impl VliwWord>, target: u32) -> bool {
    let mut index = 0;
    while index < tokens.len() {
        if tokens.boundary(index) && sentence_at!(*tokens, index) == target {
            return true;
        }
        index += 1;
    }
    false
}

pub(super) fn name_span(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
    typed_number: bool,
    name: &mut NameSpan,
) -> u32 {
    let Some(end) = field.start.checked_add(field.length) else {
        return ERROR_MALFORMED;
    };
    if field.length < 2 || end > tokens.len() {
        return ERROR_MALFORMED;
    }
    if typed_number {
        // Accept class-first internal fields and ordinary Pyash fields whose
        // type follows the leading name marker.
        let mut index = field.start;
        if sentence_at!(*tokens, index) == NAME_TYPE {
            index += 1;
        }
        let class_start = index;
        while index < end && is_class_word(sentence_at!(*tokens, index)) {
            index += 1;
        }
        if index == class_start {
            return ERROR_MALFORMED;
        }
        if index < end && sentence_at!(*tokens, index) == NAME_TYPE {
            index += 1;
        }
        if index >= end || !is_root_name(tokens, index, end) {
            return ERROR_MALFORMED;
        }
        *name = NameSpan {
            start: index,
            length: end - index,
        };
        return 0;
    }
    if sentence_at!(*tokens, field.start) != NAME_TYPE {
        return ERROR_MALFORMED;
    }
    if sentence_at!(*tokens, field.start + 1) == NAME_TYPE {
        return ERROR_MALFORMED;
    }
    let mut marker = field.start + 2;
    while marker < end {
        if sentence_at!(*tokens, marker) == NAME_TYPE {
            return ERROR_MALFORMED;
        }
        marker += 1;
    }
    let name_start = field.start + 1;
    if name_start >= end || !is_root_name(tokens, name_start, end) {
        return ERROR_MALFORMED;
    }
    *name = NameSpan {
        start: name_start,
        length: end - name_start,
    };
    0
}

/// Whether every word in `start..end` is a root word.
///
/// A name's payload is one or more roots, never a grammar word: `gi` followed by
/// a pronoun is not a name, because the pronoun is serving its grammatical
/// purpose.
fn is_root_name(tokens: &SentenceView<'_, impl VliwWord>, start: usize, end: usize) -> bool {
    start < end
        && (start..end).all(|index| {
            matches!(
                word_code::classify_identity(sentence_at!(*tokens, index) as u16),
                Some(word_code::WordClass::LongRoot) | Some(word_code::WordClass::ShortRoot)
            )
        })
}

/// The `gi` rule, and nothing more.
///
/// `gi` marks a name, so it may appear at most once per field, only followed by
/// root words, and optionally preceded by class words describing the kind of
/// name:
///
/// ```text
/// gi <root…>               a name
/// dlek flut gi <hzit>      a vector-float name
/// ```
///
/// `gi sa` is rejected, because `sa` is a pronoun doing its grammatical job
/// rather than a name. A field with no `gi` is not policed here: it may be a
/// pronoun, a genitive construction, a quoted value, or a nested clause, and
/// those are validated by the code that understands them.
pub(super) fn validate_field_tags(
    tokens: &SentenceView<'_, impl VliwWord>,
    start: usize,
    end: usize,
) -> u32 {
    if start >= end {
        return ERROR_MALFORMED;
    }
    // A field holding a nested clause is a sentence in its own right, and is
    // validated when that clause is parsed.
    if (start..end)
        .any(|index| matches!(sentence_at!(*tokens, index), DEPENDENT_CLAUSE | CLAUSE_TAIL))
    {
        return 0;
    }
    // A quoted value is its own encoding, not a name.
    if numeric::quote_header(sentence_at!(*tokens, start)).valid != 0 {
        return 0;
    }

    // Ordinary Pyash types come after the leading name marker. A repeated
    // marker closes that type prefix; without it, type-looking root words are
    // still part of an untyped name.
    if sentence_at!(*tokens, start) == NAME_TYPE {
        let mut index = start + 1;
        while index < end && is_class_word(sentence_at!(*tokens, index)) {
            index += 1;
        }
        if index > start + 1 && index < end && sentence_at!(*tokens, index) == NAME_TYPE {
            return if is_root_name(tokens, index + 1, end) {
                0
            } else {
                ERROR_MALFORMED
            };
        }
        let root_name = is_root_name(tokens, start + 1, end);
        let named_class = end == start + 2 && is_class_word(sentence_at!(*tokens, start + 1));
        return if root_name || named_class {
            0
        } else {
            ERROR_MALFORMED
        };
    }

    let mut name_tag = None;
    for index in start..end {
        if sentence_at!(*tokens, index) == NAME_TYPE {
            if name_tag.is_some() {
                // A name has one payload, so one tag.
                return ERROR_MALFORMED;
            }
            name_tag = Some(index);
        }
    }
    let Some(name_index) = name_tag else {
        return 0;
    };

    // Everything before the tag must be a class word: an untyped `gi` has none.
    let mut index = start;
    while index < name_index && is_class_word(sentence_at!(*tokens, index)) {
        index += 1;
    }
    if index != name_index {
        return ERROR_MALFORMED;
    }
    // The payload is one or more roots, never a grammar word.
    if !is_root_name(tokens, name_index + 1, end) {
        return ERROR_MALFORMED;
    }
    0
}

/// Whether `word` names the kind of value that follows it.
///
/// Width words, the boolean class, and the vector/float class words: each says
/// "what follows is a value of this kind", which is why none of them is a name.
fn is_class_word(word: u32) -> bool {
    is_width_word(word) || matches!(word, VECTOR_TYPE | FLOAT_TYPE)
}

pub(super) fn typed_name_span(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
    name: &mut NameSpan,
    kind: &mut u32,
) -> u32 {
    let Some(end) = field.start.checked_add(field.length) else {
        return ERROR_MALFORMED;
    };
    if field.length < 2 || end > tokens.len() {
        return ERROR_MALFORMED;
    }

    // Both ordinary Pyash fields (`gi <class…> gi <name>`) and programlet
    // internals (`<class…> [gi] <name>`) carry the same typed-name meaning.
    let mut index = field.start;
    let leading_name = sentence_at!(*tokens, index) == NAME_TYPE;
    if leading_name {
        index += 1;
    }
    let class_start = index;
    let mut has_vector = false;
    let mut has_float = false;
    let mut has_boolean = false;
    let mut has_number = false;
    while index < end && is_class_word(sentence_at!(*tokens, index)) {
        match sentence_at!(*tokens, index) {
            VECTOR_TYPE => has_vector = true,
            FLOAT_TYPE => has_float = true,
            BOOLEAN_TYPE => has_boolean = true,
            _ => has_number = true,
        }
        index += 1;
    }
    let has_class = index > class_start;
    if (!leading_name && !has_class)
        || (leading_name
            && (!has_class || index >= end || sentence_at!(*tokens, index) != NAME_TYPE))
    {
        // No class word: an ordinary name.
        *kind = 0;
        return name_span(tokens, field, false, name);
    }
    if index < end && sentence_at!(*tokens, index) == NAME_TYPE {
        index += 1;
    }
    if index >= end || !is_root_name(tokens, index, end) {
        return ERROR_MALFORMED;
    }
    *kind = if has_vector && has_float {
        VALUE_VECTOR_FLOAT
    } else if has_float {
        VALUE_FLOAT
    } else if has_boolean {
        VALUE_BOOLEAN
    } else if has_number {
        VALUE_NUMBER
    } else {
        return ERROR_UNSUPPORTED;
    };
    *name = NameSpan {
        start: index,
        length: end - index,
    };
    0
}

pub(super) fn typed_output_name(
    tokens: &SentenceView<'_, impl VliwWord>,
    field: SentenceField,
    name: &mut NameSpan,
    kind: &mut u32,
) -> u32 {
    let error = typed_name_span(tokens, field, name, kind);
    if error != 0 {
        return error;
    }
    if *kind == 0 {
        return ERROR_MALFORMED;
    }
    0
}
