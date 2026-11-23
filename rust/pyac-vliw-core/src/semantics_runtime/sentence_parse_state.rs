use super::*;

#[derive(Clone, Copy)]
pub(super) struct SentenceParseState {
    pub(super) value_start: usize,
    pub(super) clause_depth: usize,
    pub(super) seen_roles: u32,
    pub(super) field_count: usize,
    pub(super) verb_start: usize,
    pub(super) verb_length: usize,
    pub(super) mood: u32,
}

impl SentenceParseState {
    pub(super) const fn new(start: usize) -> Self {
        Self {
            value_start: start,
            clause_depth: 0,
            seen_roles: 0,
            field_count: 0,
            verb_start: 0,
            verb_length: 0,
            mood: 0,
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct SentenceParseTransition {
    pub(super) state: SentenceParseState,
    pub(super) field: SentenceField,
    pub(super) writes_field: bool,
    pub(super) complete: bool,
    pub(super) error: u32,
}

#[inline(never)]
pub(super) fn advance_sentence_parse(
    mut state: SentenceParseState,
    token: u32,
    boundary: bool,
    index: usize,
    end: usize,
) -> SentenceParseTransition {
    let mut transition = SentenceParseTransition {
        state,
        field: SentenceField::EMPTY,
        writes_field: false,
        complete: false,
        error: 0,
    };

    if token == DEPENDENT_CLAUSE {
        state.clause_depth += 1;
        transition.state = state;
        return transition;
    }
    if token == CLAUSE_TAIL {
        if state.clause_depth == 0 {
            transition.error = ERROR_MALFORMED;
        } else {
            state.clause_depth -= 1;
            transition.state = state;
        }
        return transition;
    }
    if state.clause_depth != 0 || !boundary {
        return transition;
    }

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
        _ => 0,
    };
    if role_bit != 0 {
        if state.value_start >= index || state.field_count >= 8 || state.seen_roles & role_bit != 0
        {
            transition.error = ERROR_MALFORMED;
            return transition;
        }
        transition.field = SentenceField {
            role: token,
            start: state.value_start,
            length: index - state.value_start,
        };
        transition.writes_field = true;
        state.seen_roles |= role_bit;
        state.field_count += 1;
        state.value_start = index + 1;
        transition.state = state;
        return transition;
    }

    if matches!(
        token,
        MOOD_DEFINITION | REALIS | DEONTIC | CONDITIONAL | MOOD_RETURN | MOOD_PARAGRAPH
    ) {
        let verb_length = index - state.value_start;
        if state.mood != 0
            || (verb_length == 0 && token != MOOD_RETURN)
            || (verb_length != 0 && token == MOOD_RETURN)
            || index + 1 != end
        {
            transition.error = ERROR_MALFORMED;
            return transition;
        }
        state.verb_start = state.value_start;
        state.verb_length = verb_length;
        state.mood = token;
        transition.state = state;
        transition.complete = true;
        return transition;
    }

    transition.error = ERROR_UNSUPPORTED;
    transition
}
