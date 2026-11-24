use super::*;

pub(super) fn programlet_branch(
    tokens: &SentenceView<'_>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    selected_action: &mut ParsedSentence,
    has_selected_action: &mut bool,
) -> u32 {
    let mut conditional_at = None;
    let mut index = 0;
    while index < tokens.len() {
        if tokens.boundary(index) && sentence_at!(*tokens, index) == CONDITIONAL {
            conditional_at = Some(index);
            break;
        }
        index += 1;
    }
    let Some(conditional_at) = conditional_at else {
        return ERROR_UNSUPPORTED;
    };
    if conditional_at == 0 {
        return ERROR_MALFORMED;
    }
    let predicate = if matches!(
        sentence_at!(*tokens, conditional_at - 1),
        NEGATORY_QUANTIFIER | AND_GRAMMAR | OR_GRAMMAR
    ) {
        match evaluate_boolean_expression_with_env(
            tokens,
            0,
            conditional_at + 1,
            symbols,
            arguments,
            slots,
        ) {
            Ok(value) => value,
            Err(error) => return error,
        }
    } else {
        let mut accusative_at = None;
        let mut source_at = None;
        index = 0;
        while index < conditional_at {
            if tokens.boundary(index) {
                if sentence_at!(*tokens, index) == ACCUSATIVE {
                    accusative_at = Some(index);
                } else if sentence_at!(*tokens, index) == SOURCE {
                    source_at = Some(index);
                }
            }
            index += 1;
        }
        let Some(accusative_at) = accusative_at else {
            return ERROR_MALFORMED;
        };
        let Some(source_at) = source_at else {
            return ERROR_MALFORMED;
        };
        if source_at <= accusative_at || source_at + 2 != conditional_at {
            return ERROR_UNSUPPORTED;
        }
        let mut left = ProgramletNumber::EMPTY;
        let left_error = comparison_operand(
            tokens,
            0,
            accusative_at,
            symbols,
            arguments,
            slots,
            &mut left,
        );
        if left_error != 0 {
            return left_error;
        }
        let mut right = ProgramletNumber::EMPTY;
        let right_error = comparison_operand(
            tokens,
            accusative_at + 1,
            source_at,
            symbols,
            arguments,
            slots,
            &mut right,
        );
        if right_error != 0 {
            return right_error;
        }
        if (left.kind == VALUE_BOOLEAN) != (right.kind == VALUE_BOOLEAN) {
            return ERROR_UNSUPPORTED;
        }
        let ordering = compare_programlet_numbers(left, right);
        match sentence_at!(*tokens, source_at + 1) {
            EQUALLY => ordering == 1,
            TINY => ordering == 0,
            GIANT => ordering == 2,
            _ => return ERROR_UNSUPPORTED,
        }
    };

    let mut first_mood = conditional_at + 1;
    while first_mood < tokens.len()
        && (!tokens.boundary(first_mood)
            || !matches!(
                sentence_at!(*tokens, first_mood),
                REALIS | DEONTIC | MOOD_RETURN | MOOD_PARAGRAPH
            ))
    {
        first_mood += 1;
    }
    if first_mood == tokens.len()
        || !matches!(sentence_at!(*tokens, first_mood), DEONTIC | MOOD_RETURN)
    {
        return ERROR_UNSUPPORTED;
    }
    let mut first_action = ParsedSentence::empty();
    let first_action_error = parse_sentence_range(
        tokens,
        conditional_at + 1,
        first_mood + 1,
        &mut first_action,
    );
    if first_action_error != 0 {
        return first_action_error;
    }
    let has_alternative = first_mood + 1 < tokens.len();
    let alternative = if has_alternative {
        let mut alternative = ParsedSentence::empty();
        let error = parse_sentence_range(tokens, first_mood + 1, tokens.len(), &mut alternative);
        if error != 0 {
            return error;
        }
        alternative
    } else {
        ParsedSentence::empty()
    };
    if !matches!(first_action.mood, DEONTIC | MOOD_RETURN)
        || (has_alternative && !matches!(alternative.mood, DEONTIC | MOOD_RETURN))
    {
        return ERROR_UNSUPPORTED;
    }
    *has_selected_action = predicate || has_alternative;
    *selected_action = if predicate { first_action } else { alternative };
    0
}

pub(super) fn read_optional_programlet_number(
    present: bool,
    field: SentenceField,
    tokens: &SentenceView<'_>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
    value: &mut ProgramletNumber,
) -> u32 {
    if !present {
        return 0;
    }
    let error = resolve_programlet_value(tokens, field, symbols, arguments, slots, value);
    if error != 0 {
        return error;
    }
    if !matches!(value.kind, VALUE_UNSIGNED | VALUE_SIGNED) {
        return ERROR_UNSUPPORTED;
    }
    0
}

pub(super) fn unsigned_programlet_operand(
    present: bool,
    value: ProgramletNumber,
) -> Result<u32, u32> {
    if !present {
        return Ok(0);
    }
    if value.kind == VALUE_SIGNED && (value.bits as i32) < 0 {
        return Err(ERROR_UNSUPPORTED);
    }
    if value.bits > MAX_U16 {
        return Err(ERROR_MALFORMED);
    }
    Ok(value.bits)
}

pub(super) fn first_present_operand(
    first_present: bool,
    first: u32,
    second_present: bool,
    second: u32,
) -> Result<u32, u32> {
    if first_present {
        Ok(first)
    } else if second_present {
        Ok(second)
    } else {
        Err(ERROR_MALFORMED)
    }
}
