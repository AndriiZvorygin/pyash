use super::*;

pub(super) fn number_kind_matches(expected: u32, actual: u32) -> bool {
    if expected == VALUE_NUMBER {
        matches!(actual, VALUE_NUMBER | VALUE_UNSIGNED | VALUE_SIGNED)
    } else {
        expected == actual
    }
}

pub(super) fn programlet_type_matches(expected: u32, actual: u32) -> bool {
    match expected {
        VALUE_FLOAT => expected == actual || matches!(actual, VALUE_FLOAT32 | VALUE_FLOAT64),
        VALUE_VECTOR_FLOAT => {
            expected == actual || matches!(actual, VALUE_VECTOR_FLOAT32 | VALUE_VECTOR_FLOAT64)
        }
        VALUE_NUMBER | VALUE_BOOLEAN => number_kind_matches(expected, actual),
        _ => expected == actual,
    }
}

pub(super) fn compare_programlet_numbers(left: ProgramletNumber, right: ProgramletNumber) -> u32 {
    match (left.kind == VALUE_SIGNED, right.kind == VALUE_SIGNED) {
        (true, true) => compare_signed(left.bits as i32, right.bits as i32),
        (true, false) => {
            let left = left.bits as i32;
            if left < 0 {
                0
            } else {
                compare_unsigned(left as u32, right.bits)
            }
        }
        (false, true) => {
            let signed_right = right.bits as i32;
            if signed_right < 0 {
                2
            } else {
                compare_unsigned(left.bits, signed_right as u32)
            }
        }
        (false, false) => compare_unsigned(left.bits, right.bits),
    }
}

pub(super) fn compare_signed(left: i32, right: i32) -> u32 {
    if left < right {
        0
    } else if left > right {
        2
    } else {
        1
    }
}

pub(super) fn compare_unsigned(left: u32, right: u32) -> u32 {
    if left < right {
        0
    } else if left > right {
        2
    } else {
        1
    }
}
