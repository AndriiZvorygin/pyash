use super::*;

pub(super) fn evaluate_boolean_leaf(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
) -> Result<bool, u32> {
    let symbols = [0; MAX_PROGRAMLET_SYMBOL_WORDS];
    let arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let slots = [NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS];
    evaluate_boolean_leaf_with_env(sentence, tokens, &symbols, &arguments, &slots)
}

pub(super) fn evaluate_boolean_leaf_with_env(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<bool, u32> {
    if sentence.mood == REALIS
        && sentence.verb_length == 1
        && sentence_at!(*tokens, sentence.verb_start) == BOOLEAN_VERB
    {
        if sentence.field_count != 1 {
            return Err(ERROR_UNSUPPORTED);
        }
        let Some(value) = sentence.field(ACCUSATIVE) else {
            return Err(ERROR_MALFORMED);
        };
        if value.length != 1 {
            return Err(ERROR_UNSUPPORTED);
        }
        return match sentence_at!(*tokens, value.start) {
            TRUTH => Ok(true),
            LIE => Ok(false),
            _ => Err(ERROR_UNSUPPORTED),
        };
    }
    if matches!(sentence.mood, DEONTIC | CONDITIONAL) && sentence.verb_length == 1 {
        let comparator = sentence_at!(*tokens, sentence.verb_start);
        if matches!(comparator, EQUALLY | TINY | GIANT) {
            let left_field = match sentence.field(NOMINATIVE) {
                Some(field) => field,
                None => sentence.field(ACCUSATIVE).ok_or(ERROR_MALFORMED)?,
            };
            let right_field = sentence.field(SOURCE).ok_or(ERROR_MALFORMED)?;
            let mut left = ProgramletNumber::EMPTY;
            let left_end = left_field
                .start
                .checked_add(left_field.length)
                .ok_or(ERROR_MALFORMED)?;
            let left_error = comparison_operand(
                tokens,
                left_field.start,
                left_end,
                symbols,
                arguments,
                slots,
                &mut left,
            );
            if left_error != 0 {
                return Err(left_error);
            }
            let mut right = ProgramletNumber::EMPTY;
            let right_end = right_field
                .start
                .checked_add(right_field.length)
                .ok_or(ERROR_MALFORMED)?;
            let right_error = comparison_operand(
                tokens,
                right_field.start,
                right_end,
                symbols,
                arguments,
                slots,
                &mut right,
            );
            if right_error != 0 {
                return Err(right_error);
            }
            if (left.kind == VALUE_BOOLEAN) != (right.kind == VALUE_BOOLEAN) {
                return Err(ERROR_UNSUPPORTED);
            }
            if comparator != EQUALLY && left.kind == VALUE_BOOLEAN {
                return Err(ERROR_UNSUPPORTED);
            }
            let ordering = compare_programlet_numbers(left, right);
            return Ok(match comparator {
                EQUALLY => ordering == 1,
                TINY => ordering == 0,
                GIANT => ordering == 2,
                _ => return Err(ERROR_UNSUPPORTED),
            });
        }
    }
    Err(ERROR_UNSUPPORTED)
}

pub(super) fn evaluate_boolean_expression(
    tokens: &SentenceView<'_, impl VliwWord>,
    start: usize,
    end: usize,
) -> Result<bool, u32> {
    let symbols = [0; MAX_PROGRAMLET_SYMBOL_WORDS];
    let arguments = [ProgramletArgument::EMPTY; MAX_PROGRAMLET_ARGUMENTS];
    let slots = [NumericLocalSlot::EMPTY; MAX_PROGRAMLET_LOCAL_SLOTS];
    evaluate_boolean_expression_with_env(tokens, start, end, &symbols, &arguments, &slots)
}

pub(super) fn evaluate_boolean_expression_with_env(
    tokens: &SentenceView<'_, impl VliwWord>,
    start: usize,
    end: usize,
    symbols: &[u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &[NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<bool, u32> {
    let mut stack = [BooleanEvalFrame::EMPTY; MAX_BOOLEAN_EXPRESSION_DEPTH];
    stack[0].start = start;
    stack[0].end = end;
    let mut depth = 1usize;
    let mut returned_value = 0u32;
    let mut has_returned_value = false;

    while depth > 0 || has_returned_value {
        if has_returned_value {
            if depth == 0 {
                return Ok(returned_value != 0);
            }
            let parent_index = depth - 1;
            let mut parent = array_at!(stack, parent_index);
            if parent.state == 1 {
                parent.left_value = returned_value;
                let short_circuit = (parent.operator == AND_GRAMMAR && returned_value == 0)
                    || (parent.operator == OR_GRAMMAR && returned_value != 0);
                if parent.operator == NEGATORY_QUANTIFIER {
                    returned_value = u32::from(returned_value == 0);
                    depth -= 1;
                } else if short_circuit {
                    returned_value = u32::from(parent.operator == OR_GRAMMAR);
                    depth -= 1;
                } else {
                    parent.state = 2;
                    let (right_start, right_end) = (parent.right_start, parent.right_end);
                    array_put!(&mut stack, parent_index, parent);
                    if depth == stack.len() {
                        return Err(ERROR_FRAME_CAPACITY);
                    }
                    array_put!(
                        &mut stack,
                        depth,
                        BooleanEvalFrame {
                            start: right_start,
                            end: right_end,
                            ..BooleanEvalFrame::EMPTY
                        }
                    );
                    depth += 1;
                    has_returned_value = false;
                }
            } else if parent.state == 2 {
                depth -= 1;
            } else {
                return Err(ERROR_MALFORMED);
            }
            continue;
        }

        let frame_index = depth - 1;
        let mut frame = array_at!(stack, frame_index);
        let mut sentence = ParsedSentence::empty();
        let parse_error = parse_sentence_range(tokens, frame.start, frame.end, &mut sentence);
        if parse_error != 0 {
            return Err(parse_error);
        }

        let operator =
            if matches!(sentence.mood, DEONTIC | CONDITIONAL) && sentence.verb_length == 1 {
                sentence_at!(*tokens, sentence.verb_start)
            } else {
                0
            };
        if !matches!(operator, NEGATORY_QUANTIFIER | AND_GRAMMAR | OR_GRAMMAR) {
            returned_value = u32::from(evaluate_boolean_leaf_with_env(
                &sentence, tokens, symbols, arguments, slots,
            )?);
            depth -= 1;
            has_returned_value = true;
            continue;
        }

        let expected_fields = if operator == NEGATORY_QUANTIFIER {
            1
        } else {
            2
        };
        if !matches!(sentence.mood, DEONTIC | CONDITIONAL)
            || sentence.field_count != expected_fields
        {
            return Err(ERROR_UNSUPPORTED);
        }
        let Some(left) = sentence.field(ACCUSATIVE) else {
            return Err(ERROR_MALFORMED);
        };
        let (left_start, left_end) = embedded_clause_range(tokens, left)?;
        let mut right_range = (0usize, 0usize);
        if operator != NEGATORY_QUANTIFIER {
            let Some(right) = sentence.field(COMITATIVE) else {
                return Err(ERROR_MALFORMED);
            };
            right_range = embedded_clause_range(tokens, right)?;
        } else if sentence.field(COMITATIVE).is_some() {
            return Err(ERROR_UNSUPPORTED);
        }

        frame.state = 1;
        frame.operator = operator;
        frame.right_start = right_range.0;
        frame.right_end = right_range.1;
        array_put!(&mut stack, frame_index, frame);
        if depth == stack.len() {
            return Err(ERROR_FRAME_CAPACITY);
        }
        array_put!(
            &mut stack,
            depth,
            BooleanEvalFrame {
                start: left_start,
                end: left_end,
                ..BooleanEvalFrame::EMPTY
            }
        );
        depth += 1;
    }

    Err(ERROR_MALFORMED)
}

pub(super) fn boolean_composition(
    words: &[impl VliwWord],
    start: usize,
    codelet_count: usize,
) -> Option<CoreResult> {
    let Ok((token_count, next_codelet)) = collect_sentence(words, codelet_count, start) else {
        return None;
    };
    let tokens = SentenceView::new(words, start, token_count);
    let mut sentence = ParsedSentence::empty();
    if parse_sentence(&tokens, &mut sentence) != 0
        || sentence.mood != DEONTIC
        || sentence.verb_length != 1
        || !matches!(
            sentence_at!(tokens, sentence.verb_start),
            NEGATORY_QUANTIFIER | AND_GRAMMAR | OR_GRAMMAR
        )
    {
        return None;
    }
    match evaluate_boolean_expression(&tokens, 0, tokens.len()) {
        Ok(value) => Some(CoreResult::scalar(
            VALUE_BOOLEAN,
            u32::from(value),
            0,
            (next_codelet - start) as u32,
        )),
        Err(error) => Some(CoreResult::failure(error, (next_codelet - start) as u32)),
    }
}

pub(super) fn boolean_comparison(
    words: &[impl VliwWord],
    start: usize,
    codelet_count: usize,
) -> Option<CoreResult> {
    let Ok((token_count, next_codelet)) = collect_sentence(words, codelet_count, start) else {
        return None;
    };
    let tokens = SentenceView::new(words, start, token_count);
    let mut sentence = ParsedSentence::empty();
    if parse_sentence(&tokens, &mut sentence) != 0
        || sentence.mood != DEONTIC
        || sentence.verb_length != 1
        || !matches!(
            sentence_at!(tokens, sentence.verb_start),
            EQUALLY | TINY | GIANT
        )
    {
        return None;
    }
    match evaluate_boolean_leaf(&sentence, &tokens) {
        Ok(value) => Some(CoreResult::scalar(
            VALUE_BOOLEAN,
            u32::from(value),
            0,
            (next_codelet - start) as u32,
        )),
        Err(error) => Some(CoreResult::failure(error, (next_codelet - start) as u32)),
    }
}
