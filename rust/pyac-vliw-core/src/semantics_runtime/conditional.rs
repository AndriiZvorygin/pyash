use super::*;

pub(super) fn conditional(words: &[u32], start: usize, group_len: usize) -> CoreResult {
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
    let mut i = 0;
    if logical_len == 16 {
        let expected = [3usize, 6, 8, 10, 12, 14, 16];
        if boundary_count != expected.len() {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        while i < expected.len() {
            if array_at!(boundaries, i) != array_at!(expected, i) {
                return CoreResult::failure(ERROR_BRANCH, 2);
            }
            i += 1;
        }
        if !matches!(array_at!(logical, 6), EQUALLY | TINY | GIANT)
            || array_at!(logical, 0) != NUMBER_QUOTE
            || array_at!(logical, 2) != ACCUSATIVE
            || array_at!(logical, 3) != NUMBER_QUOTE
            || array_at!(logical, 5) != SOURCE
            || array_at!(logical, 7) != CONDITIONAL
            || !matches!(array_at!(logical, 8), TRUTH | LIE)
            || array_at!(logical, 9) != ACCUSATIVE
            || !matches!(array_at!(logical, 10), NUMBER_VERB | BOOLEAN_VERB)
            || array_at!(logical, 11) != REALIS
            || !matches!(array_at!(logical, 12), TRUTH | LIE)
            || array_at!(logical, 13) != ACCUSATIVE
            || !matches!(array_at!(logical, 14), NUMBER_VERB | BOOLEAN_VERB)
            || array_at!(logical, 15) != REALIS
        {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        let predicate = match array_at!(logical, 6) {
            EQUALLY => array_at!(logical, 1) == array_at!(logical, 4),
            TINY => array_at!(logical, 1) < array_at!(logical, 4),
            GIANT => array_at!(logical, 1) > array_at!(logical, 4),
            _ => false,
        };
        let value = if predicate {
            array_at!(logical, 8)
        } else {
            array_at!(logical, 12)
        };
        return CoreResult::scalar(VALUE_BOOLEAN, u32::from(value == TRUTH), 0, 2);
    }

    let expected = [3usize, 6, 8, 11, 13, 16, 18];
    if logical_len != 18 || boundary_count != expected.len() {
        return CoreResult::failure(ERROR_BRANCH, 2);
    }
    while i < expected.len() {
        if array_at!(boundaries, i) != array_at!(expected, i) {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        i += 1;
    }
    let shape = [
        (0, NUMBER_QUOTE),
        (2, ACCUSATIVE),
        (3, NUMBER_QUOTE),
        (5, SOURCE),
        (7, CONDITIONAL),
        (8, NUMBER_QUOTE),
        (10, ACCUSATIVE),
        (11, NUMBER_VERB),
        (12, REALIS),
        (13, NUMBER_QUOTE),
        (15, ACCUSATIVE),
        (16, NUMBER_VERB),
        (17, REALIS),
    ];
    i = 0;
    while i < shape.len() {
        let expected = array_at!(shape, i);
        if array_at!(logical, expected.0) != expected.1 {
            return CoreResult::failure(ERROR_BRANCH, 2);
        }
        i += 1;
    }
    let predicate = match array_at!(logical, 6) {
        EQUALLY => array_at!(logical, 1) == array_at!(logical, 4),
        TINY => array_at!(logical, 1) < array_at!(logical, 4),
        GIANT => array_at!(logical, 1) > array_at!(logical, 4),
        _ => return CoreResult::failure(ERROR_BRANCH, 2),
    };
    let value = if predicate {
        array_at!(logical, 9)
    } else {
        array_at!(logical, 14)
    };
    if value > MAX_U16 {
        return CoreResult::failure(ERROR_MALFORMED, 2);
    }
    CoreResult::scalar(VALUE_UNSIGNED, value, 0, 2)
}
