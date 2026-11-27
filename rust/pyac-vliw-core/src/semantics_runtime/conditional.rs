use super::*;

pub(super) fn conditional(words: &[impl VliwWord], start: usize, group_len: usize) -> CoreResult {
    if group_len != 2 {
        return CoreResult::failure(ERROR_BRANCH, group_len as u32);
    }
    let head0 = word(words, start, 0);
    let head1 = word(words, start + 1, 0);
    if head0 & 1 != 0 || head1 & 1 == 0 {
        return CoreResult::failure(ERROR_BRANCH, 2);
    }
    let mut last_slot = 0usize;
    let mut slot = 1;
    while slot < CODELET_WORDS {
        if head1 & (1 << slot) != 0 {
            last_slot = slot;
        }
        slot += 1;
    }
    if last_slot == 0 || !zero_tail(words, start + 1, last_slot + 1) {
        return CoreResult::failure(ERROR_BRANCH, 2);
    }
    let mut logical = [0u32; 18];
    let mut boundaries = [0usize; 8];
    let mut boundary_count = 0usize;
    let mut logical_len = 0usize;
    let mut vector_index = 0usize;
    while vector_index < 2 {
        let head = word(words, start + vector_index, 0);
        let completion = head & 1 != 0;
        let end = if vector_index == 1 {
            last_slot
        } else {
            CODELET_WORDS - 1
        };
        slot = 1;
        while slot <= end {
            array_put!(
                &mut logical,
                logical_len,
                word(words, start + vector_index, slot)
            );
            logical_len += 1;
            if (head & (1 << slot) != 0) == completion {
                if boundary_count >= boundaries.len() {
                    return CoreResult::failure(ERROR_BRANCH, 2);
                }
                array_put!(&mut boundaries, boundary_count, logical_len);
                boundary_count += 1;
            }
            slot += 1;
        }
        vector_index += 1;
    }
    // A conditional is `<value> na <value> so <test> cu <pick> na <verb> li
    // <pick> na <verb> li`. The pick may be a literal (`NUMBER_QUOTE n`) or a
    // bare truth word, so it is read structurally rather than at fixed offsets.
    let predicate = match array_at!(logical, 6) {
        EQUALLY => array_at!(logical, 1) == array_at!(logical, 4),
        TINY => array_at!(logical, 1) < array_at!(logical, 4),
        GIANT => array_at!(logical, 1) > array_at!(logical, 4),
        _ => return CoreResult::failure(ERROR_BRANCH, 2),
    };
    if array_at!(logical, 0) != NUMBER_QUOTE
        || array_at!(logical, 2) != ACCUSATIVE
        || array_at!(logical, 3) != NUMBER_QUOTE
        || array_at!(logical, 5) != SOURCE
        || array_at!(logical, 7) != CONDITIONAL
    {
        return CoreResult::failure(ERROR_BRANCH, 2);
    }
    // The two arms start after the conditional marker. Each is
    // `<pick> <accusative> <verb> <realis>`, and the pick is either a literal
    // pair or a single truth word.
    let mut arms = [0u32; 2];
    let mut cursor = 8usize;
    for arm in arms.iter_mut() {
        let pick = if array_at!(logical, cursor) == NUMBER_QUOTE {
            let value = array_at!(logical, cursor + 1);
            cursor += 2;
            value
        } else {
            let value = array_at!(logical, cursor);
            cursor += 1;
            value
        };
        if array_at!(logical, cursor) != ACCUSATIVE
            || !matches!(array_at!(logical, cursor + 1), NUMBER_VERB | BOOLEAN_VERB)
            || array_at!(logical, cursor + 2) != REALIS
        {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        cursor += 3;
        *arm = pick;
    }
    if cursor != logical_len {
        return CoreResult::failure(ERROR_BRANCH, 2);
    }
    let picked = arms[usize::from(!predicate)];
    // A boolean conditional answers truth/lie; a numeric one answers the value.
    if matches!(picked, TRUTH | LIE) {
        return CoreResult::scalar(VALUE_BOOLEAN, u32::from(picked == TRUTH), 0, 2);
    }
    if picked > MAX_U16 {
        return CoreResult::failure(ERROR_MALFORMED, 2);
    }
    CoreResult::scalar(VALUE_UNSIGNED, picked, 0, 2)
}
