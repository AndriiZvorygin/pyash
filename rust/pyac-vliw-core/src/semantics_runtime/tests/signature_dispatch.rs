use super::*;

fn codelet(tokens: &[u32], boundaries: &[usize]) -> [u32; CODELET_WORDS] {
    assert!(tokens.len() < CODELET_WORDS);
    let mut result = [0; CODELET_WORDS];
    result[0] = 1;
    result[1..=tokens.len()].copy_from_slice(tokens);
    for boundary in boundaries {
        result[0] |= 1 << (boundary + 1);
    }
    result
}

#[test]
fn resolves_exact_numeric_and_evaluation_signatures() {
    let arithmetic = codelet(
        &[
            NUMBER_QUOTE,
            4,
            ACCUSATIVE,
            NUMBER_QUOTE,
            5,
            DESTINATION,
            PLUS,
            DEONTIC,
        ],
        &[2, 5, 7],
    );
    assert_eq!(
        select_signature_route(&arithmetic, 0, 1),
        Ok(ROUTE_ARITHMETIC)
    );

    let evaluation = codelet(
        &[
            NAME_TYPE,
            0x68b1,
            ACCUSATIVE,
            NAME_TYPE,
            NUMBER_TYPE,
            NAME_TYPE,
            0xaa90,
            DESTINATION,
            NAME_TYPE,
            0x4930,
            INSTRUMENTAL,
            PLUK,
            TLAS,
            DEONTIC,
        ],
        &[2, 7, 10, 13],
    );
    assert_eq!(
        select_signature_route(&evaluation, 0, 1),
        Ok(ROUTE_PLUK_TLAS)
    );
}

#[test]
fn case_source_order_does_not_change_the_selected_route() {
    let accusative_first = codelet(
        &[
            NUMBER_QUOTE,
            4,
            ACCUSATIVE,
            NUMBER_QUOTE,
            5,
            DESTINATION,
            PLUS,
            DEONTIC,
        ],
        &[2, 5, 7],
    );
    let destination_first = codelet(
        &[
            NUMBER_QUOTE,
            5,
            DESTINATION,
            NUMBER_QUOTE,
            4,
            ACCUSATIVE,
            PLUS,
            DEONTIC,
        ],
        &[2, 5, 7],
    );
    assert_eq!(
        select_signature_route(&accusative_first, 0, 1),
        Ok(ROUTE_ARITHMETIC)
    );
    assert_eq!(
        select_signature_route(&destination_first, 0, 1),
        Ok(ROUTE_ARITHMETIC)
    );
}

#[test]
fn routes_subtraction_from_its_source_case_instead_of_assuming_destination() {
    let left = 5.5f32.to_bits();
    let right = 2.0f32.to_bits();
    let subtract = codelet(
        &[
            0xd01d,
            left & 0xffff,
            left >> 16,
            ACCUSATIVE,
            0xd01d,
            right & 0xffff,
            right >> 16,
            SOURCE,
            SUBTRACT,
            DEONTIC,
        ],
        &[3, 7, 9],
    );

    assert_eq!(select_signature_route(&subtract, 0, 1), Ok(ROUTE_FLOAT));
}

#[test]
fn rejects_unknown_and_malformed_signatures_without_handler_fallthrough() {
    let unknown = codelet(
        &[
            NUMBER_QUOTE,
            4,
            ACCUSATIVE,
            NUMBER_QUOTE,
            5,
            DESTINATION,
            0x7777,
            DEONTIC,
        ],
        &[2, 5, 7],
    );
    assert_eq!(
        select_signature_route(&unknown, 0, 1),
        Err(ERROR_UNSUPPORTED)
    );

    let missing_mood_boundary = codelet(
        &[
            NUMBER_QUOTE,
            4,
            ACCUSATIVE,
            NUMBER_QUOTE,
            5,
            DESTINATION,
            PLUS,
            DEONTIC,
        ],
        &[2, 5],
    );
    assert_eq!(
        select_signature_route(&missing_mood_boundary, 0, 1),
        Err(ERROR_MALFORMED)
    );
}
