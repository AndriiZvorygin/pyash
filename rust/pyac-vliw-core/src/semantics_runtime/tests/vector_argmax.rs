use super::*;

fn argmax(values: [f32; 2]) -> CoreResult {
    let mut tokens = std::vec![0xd11d];
    for value in values {
        let bits = value.to_bits();
        tokens.extend([bits & 0xffff, bits >> 16]);
    }
    tokens.extend([
        ACCUSATIVE,
        NAME_TYPE,
        NUMBER_TYPE,
        NAME_TYPE,
        0x6851,
        DESTINATION,
        0xa9b2,
        0xa831,
        DEONTIC,
    ]);
    let mut words = std::vec::Vec::new();
    append_sentence(&mut words, &tokens, &[5, 10, 13]);
    interpret_group(&words, 0, 1)
}

#[test]
fn maximum_index_is_a_sentence_dispatched_float_vector_operation() {
    let financial = argmax([1.0, 0.25]);
    assert_eq!(financial.error, 0, "{financial:?}");
    assert_eq!(financial.value_kind, VALUE_UNSIGNED);
    assert_eq!(financial.values[0], 0);

    let river = argmax([0.25, 1.0]);
    assert_eq!(river.error, 0, "{river:?}");
    assert_eq!(river.values[0], 1);

    let tied = argmax([1.0, 1.0]);
    assert_eq!(tied.error, 0, "{tied:?}");
    assert_eq!(tied.values[0], 0);
}
