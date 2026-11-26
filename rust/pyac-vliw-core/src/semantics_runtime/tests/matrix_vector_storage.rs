use super::*;

const INPUT: u32 = 0x4123;
const OUTPUT: u32 = 0x4567;
/// The atom `hgip` means "cabbage". This fixture uses it as a section name for
/// weights, so the constant says both: what the word means, and what the test
/// is doing with it.
const CABBAGE: u32 = 0x4890;
const WEIGHTS: u32 = CABBAGE;
const NUMBER_QUOTE: u32 = 0x881d;
const DESTINATION: u32 = 0x243e;
const LOCATIVE: u32 = 0x615f;
const MULTIPLICATIVE: u32 = 0x6357;
const INSTRUMENTAL: u32 = 0x287e;
const SCALAR_WORD: u32 = 0x0d62;
const PRODUCE_WORD: u32 = 0x8944;
const DEONTIC: u32 = 0x295e;
const SOURCE: u32 = 0x313e;
const NAME_TYPE: u32 = 0x225e;
const LOOKUP_FIRST: u32 = 0xec4a;
const LOOKUP_SECOND: u32 = 0xa948;
const INDEX_FIRST: u32 = 0xa92b;
const INDEX_SECOND: u32 = 0x28ea;
const NUMBER_WIDTH_TYPE: u32 = 0x327e;

fn append_group(words: &mut std::vec::Vec<u32>, tokens: &[u32], boundaries: &[usize]) -> usize {
    let start = words.len() / CODELET_WORDS;
    for (chunk_index, chunk) in tokens.chunks(CODELET_WORDS - 1).enumerate() {
        let final_chunk = (chunk_index + 1) * (CODELET_WORDS - 1) >= tokens.len();
        let mut codelet = [0; CODELET_WORDS];
        codelet[0] = u32::from(final_chunk);
        codelet[1..=chunk.len()].copy_from_slice(chunk);
        let mut slot = 0;
        while slot < CODELET_WORDS - 1 {
            let offset = chunk_index * (CODELET_WORDS - 1) + slot;
            let is_boundary = boundaries.contains(&offset);
            if is_boundary == final_chunk {
                codelet[0] |= 1 << (slot + 1);
            }
            slot += 1;
        }
        words.extend(codelet);
    }
    start
}

fn append_matrix_row_dot(words: &mut std::vec::Vec<u32>, row: u16) -> usize {
    append_group(
        words,
        &[
            NAME_TYPE,
            INPUT,
            ACCUSATIVE,
            NAME_TYPE,
            OUTPUT,
            DESTINATION,
            NUMBER_QUOTE,
            u32::from(row),
            LOCATIVE,
            NAME_TYPE,
            WEIGHTS,
            INSTRUMENTAL,
            SCALAR_WORD,
            PRODUCE_WORD,
            DEONTIC,
        ],
        &[2, 5, 8, 11, 14],
    )
}

fn append_embedding_lookup(words: &mut std::vec::Vec<u32>, alias: u32, row: u16) -> usize {
    append_group(
        words,
        &[
            NAME_TYPE,
            WEIGHTS,
            SOURCE,
            NAME_TYPE,
            alias,
            DESTINATION,
            NUMBER_QUOTE,
            u32::from(row),
            LOCATIVE,
            LOOKUP_FIRST,
            LOOKUP_SECOND,
            DEONTIC,
        ],
        &[2, 5, 8, 11],
    )
}

fn append_embedding_lookup_from_index(words: &mut std::vec::Vec<u32>, alias: u32) -> usize {
    append_group(
        words,
        &[
            NAME_TYPE,
            WEIGHTS,
            SOURCE,
            NAME_TYPE,
            alias,
            DESTINATION,
            NAME_TYPE,
            INDEX_FIRST,
            INDEX_SECOND,
            LOCATIVE,
            LOOKUP_FIRST,
            LOOKUP_SECOND,
            DEONTIC,
        ],
        &[2, 5, 9, 12],
    )
}

fn append_embedding_lookup_from_index_at(
    words: &mut std::vec::Vec<u32>,
    alias: u32,
    position: u16,
) -> usize {
    append_group(
        words,
        &[
            NAME_TYPE,
            WEIGHTS,
            SOURCE,
            NAME_TYPE,
            alias,
            DESTINATION,
            NAME_TYPE,
            INDEX_FIRST,
            INDEX_SECOND,
            LOCATIVE,
            NUMBER_QUOTE,
            u32::from(position),
            MULTIPLICATIVE,
            LOOKUP_FIRST,
            LOOKUP_SECOND,
            DEONTIC,
        ],
        &[2, 5, 9, 12, 15],
    )
}

fn append_named_dot(words: &mut std::vec::Vec<u32>, alias: u32) -> usize {
    append_group(
        words,
        &[
            NAME_TYPE,
            INPUT,
            ACCUSATIVE,
            NAME_TYPE,
            alias,
            INSTRUMENTAL,
            SCALAR_WORD,
            PRODUCE_WORD,
            DEONTIC,
        ],
        &[2, 5, 8],
    )
}

struct MatrixStorage {
    descriptors: std::vec::Vec<u32>,
    names: std::vec::Vec<u32>,
    payload: std::vec::Vec<u32>,
}

impl MatrixStorage {
    fn view(&self) -> StorageView<'_> {
        StorageView::new(&self.descriptors, &self.names, &self.payload)
    }
}

fn storage_for_f32(input: &[f32], matrix: &[f32], rows: u32, columns: u32) -> MatrixStorage {
    let input_bytes = (input.len() * 4) as u32;
    let matrix_bytes = (matrix.len() * 4) as u32;
    let descriptors = std::vec![
        2,
        0,
        1,
        0,
        input_bytes,
        4,
        input.len() as u32,
        0xaa6c,
        1,
        columns,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        input_bytes,
        matrix_bytes,
        4,
        matrix.len() as u32,
        0xaa6c,
        2,
        rows,
        columns,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let names = std::vec![INPUT, WEIGHTS];
    let payload = input
        .iter()
        .chain(matrix)
        .map(|value| value.to_bits())
        .collect::<std::vec::Vec<_>>();
    MatrixStorage {
        descriptors,
        names,
        payload,
    }
}

fn storage_for_f64(input: &[f64], matrix: &[f64], rows: u32, columns: u32) -> MatrixStorage {
    let input_bytes = (input.len() * 8) as u32;
    let matrix_bytes = (matrix.len() * 8) as u32;
    let descriptors = std::vec![
        2,
        0,
        1,
        0,
        input_bytes,
        8,
        input.len() as u32,
        0xaa6c,
        1,
        columns,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        input_bytes,
        matrix_bytes,
        8,
        matrix.len() as u32,
        0xaa6c,
        2,
        rows,
        columns,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let names = std::vec![INPUT, WEIGHTS];
    let payload = input
        .iter()
        .chain(matrix)
        .flat_map(|value| {
            let bits = value.to_bits();
            [bits as u32, (bits >> 32) as u32]
        })
        .collect();
    MatrixStorage {
        descriptors,
        names,
        payload,
    }
}

fn storage_with_index(
    input: &[f32],
    matrix: &[f32],
    rows: u32,
    columns: u32,
    index: u16,
) -> MatrixStorage {
    let mut storage = storage_for_f32(input, matrix, rows, columns);
    let index_offset = ((input.len() + matrix.len()) * 4) as u32;
    storage.descriptors[0] = 3;
    storage.descriptors.extend([
        2,
        2,
        index_offset,
        2,
        2,
        1,
        NUMBER_WIDTH_TYPE,
        1,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ]);
    storage.names.extend([INDEX_FIRST, INDEX_SECOND]);
    storage.payload.push(u32::from(index));
    storage
}

fn storage_with_index_sequence(
    input: &[f32],
    matrix: &[f32],
    rows: u32,
    columns: u32,
    indexes: &[u16],
) -> MatrixStorage {
    let mut storage = storage_for_f32(input, matrix, rows, columns);
    let index_offset = ((input.len() + matrix.len()) * 4) as u32;
    storage.descriptors[0] = 3;
    storage.descriptors.extend([
        2,
        2,
        index_offset,
        (indexes.len() * 2) as u32,
        2,
        indexes.len() as u32,
        NUMBER_WIDTH_TYPE,
        1,
        indexes.len() as u32,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ]);
    storage.names.extend([INDEX_FIRST, INDEX_SECOND]);
    for chunk in indexes.chunks(2) {
        let low = u32::from(chunk[0]);
        let high = chunk.get(1).copied().map(u32::from).unwrap_or(0);
        storage.payload.push(low | (high << 16));
    }
    storage
}

#[test]
fn storage_view_retains_rank_two_dimensions() {
    let storage = storage_for_f32(&[1.0; 4], &[1.0; 12], 3, 4);
    let storage = storage.view();
    assert_eq!(storage.shape(0, 0), Some(4));
    assert_eq!(storage.shape(0, 1), None);
    assert_eq!(storage.shape(1, 0), Some(3));
    assert_eq!(storage.shape(1, 1), Some(4));
    assert_eq!(storage.shape(1, 2), None);
}

#[test]
fn matrix_vector_dot_sentences_select_rows_by_the_output_index() {
    let input = [1.0, 2.0, 3.0, 4.0];
    let matrix = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0];
    let storage = storage_for_f32(&input, &matrix, 3, 4);
    let storage = storage.view();
    let mut words = std::vec::Vec::new();
    let starts = (0..3)
        .map(|row| append_matrix_row_dot(&mut words, row))
        .collect::<std::vec::Vec<_>>();

    let actual = starts
        .iter()
        .map(|start| {
            let result =
                interpret_group_with_storage(&words, *start, words.len() / CODELET_WORDS, &storage);
            assert_eq!(result.error, 0, "{result:?}");
            assert_eq!(result.value_kind, VALUE_FLOAT32);
            f32::from_bits(result.values[0])
        })
        .collect::<std::vec::Vec<_>>();
    assert_eq!(actual, [1.0, 2.0, 7.0]);
}

#[test]
fn rejects_matrix_rows_outside_the_declared_shape() {
    let storage = storage_for_f32(&[1.0; 4], &[1.0; 12], 3, 4);
    let storage = storage.view();
    let mut words = std::vec::Vec::new();
    let start = append_matrix_row_dot(&mut words, 3);
    let result = interpret_group_with_storage(&words, start, 1, &storage);
    assert_eq!(result.error, ERROR_VECTOR_WIDTH);
}

#[test]
fn rejects_matrix_shape_that_does_not_match_its_payload_length() {
    let mut storage = storage_for_f32(&[1.0; 4], &[1.0; 12], 3, 4);
    storage.descriptors[25] = 4;
    let storage = storage.view();
    let mut words = std::vec::Vec::new();
    let start = append_matrix_row_dot(&mut words, 0);
    let result = interpret_group_with_storage(&words, start, 1, &storage);
    assert_eq!(result.error, ERROR_MALFORMED);
}

#[test]
fn embedding_lookup_binds_storage_backed_rows_wider_than_inline_vectors() {
    let input = [1.0f32; 20];
    let matrix = [1.0f32; 20]
        .into_iter()
        .chain([2.0f32; 20])
        .chain([3.0f32; 20])
        .collect::<std::vec::Vec<_>>();
    let storage = storage_for_f32(&input, &matrix, 3, 20);
    let storage = storage.view();
    let alias = 0x6a71;
    let mut words = std::vec::Vec::new();
    let first = append_embedding_lookup(&mut words, alias, 0);
    let first_dot = append_named_dot(&mut words, alias);
    let second = append_embedding_lookup(&mut words, alias, 1);
    let second_dot = append_named_dot(&mut words, alias);
    let third = append_embedding_lookup(&mut words, alias, 2);
    let third_dot = append_named_dot(&mut words, alias);
    let codelet_count = words.len() / CODELET_WORDS;

    for start in [first, second, third] {
        let result = interpret_group_with_storage(&words, start, codelet_count, &storage);
        assert_eq!(result.error, 0, "{result:?}");
        assert_eq!(result.value_kind, 0);
        assert_eq!(result.consumed_codelets, 1);
    }
    let results = [first_dot, second_dot, third_dot].map(|start| {
        let result = interpret_group_with_storage(&words, start, codelet_count, &storage);
        assert_eq!(result.error, 0, "{result:?}");
        f32::from_bits(result.values[0])
    });
    assert_eq!(results, [20.0, 40.0, 60.0]);
}

#[test]
fn embedding_lookup_rejects_rows_outside_the_matrix() {
    let storage = storage_for_f32(&[1.0; 4], &[1.0; 12], 3, 4);
    let storage = storage.view();
    let mut words = std::vec::Vec::new();
    let start = append_embedding_lookup(&mut words, 0x6a71, 3);
    let result = interpret_group_with_storage(&words, start, 1, &storage);
    assert_eq!(result.error, ERROR_VECTOR_WIDTH);
}

#[test]
fn embedding_lookup_selects_rows_from_a_named_u16_storage_value() {
    let input = [1.0f32; 20];
    let matrix = [1.0f32; 20]
        .into_iter()
        .chain([2.0f32; 20])
        .chain([3.0f32; 20])
        .collect::<std::vec::Vec<_>>();
    for (index, expected) in [(0, 20.0), (1, 40.0), (2, 60.0)] {
        let storage_data = storage_with_index(&input, &matrix, 3, 20, index);
        let storage = storage_data.view();
        let mut words = std::vec::Vec::new();
        let lookup = append_embedding_lookup_from_index(&mut words, 0x6a71);
        let dot = append_named_dot(&mut words, 0x6a71);
        let codelet_count = words.len() / CODELET_WORDS;

        let bound = interpret_group_with_storage(&words, lookup, codelet_count, &storage);
        assert_eq!(bound.error, 0, "{bound:?}");
        let result = interpret_group_with_storage(&words, dot, codelet_count, &storage);
        assert_eq!(result.error, 0, "{result:?}");
        assert_eq!(f32::from_bits(result.values[0]), expected);
    }
}

#[test]
fn embedding_lookup_selects_multiple_rows_by_position_from_a_named_u16_sequence() {
    let input = [1.0f32; 20];
    let matrix = [1.0f32; 20]
        .into_iter()
        .chain([2.0f32; 20])
        .chain([3.0f32; 20])
        .collect::<std::vec::Vec<_>>();
    let storage_data = storage_with_index_sequence(&input, &matrix, 3, 20, &[2, 0]);
    let storage = storage_data.view();
    let mut words = std::vec::Vec::new();
    let first_lookup = append_embedding_lookup_from_index_at(&mut words, 0x6a71, 0);
    let first_dot = append_named_dot(&mut words, 0x6a71);
    let second_lookup = append_embedding_lookup_from_index_at(&mut words, 0x6a71, 1);
    let second_dot = append_named_dot(&mut words, 0x6a71);
    let codelet_count = words.len() / CODELET_WORDS;

    for lookup in [first_lookup, second_lookup] {
        let result = interpret_group_with_storage(&words, lookup, codelet_count, &storage);
        assert_eq!(result.error, 0, "{result:?}");
        assert_eq!(result.value_kind, 0);
    }
    let outputs = [first_dot, second_dot].map(|start| {
        let result = interpret_group_with_storage(&words, start, codelet_count, &storage);
        assert_eq!(result.error, 0, "{result:?}");
        f32::from_bits(result.values[0])
    });
    assert_eq!(outputs, [60.0, 20.0]);
}

#[test]
fn embedding_lookup_rejects_sequence_position_and_token_id_out_of_bounds() {
    let input = [1.0f32; 4];
    let matrix = [1.0f32; 12];
    let mut words = std::vec::Vec::new();
    let position_out_of_bounds = append_embedding_lookup_from_index_at(&mut words, 0x6a71, 2);
    let token_id_out_of_bounds = append_embedding_lookup_from_index_at(&mut words, 0x6a71, 1);
    let codelet_count = words.len() / CODELET_WORDS;

    let sequence = storage_with_index_sequence(&input, &matrix, 3, 4, &[1, 3]);
    let sequence = sequence.view();
    assert_eq!(
        interpret_group_with_storage(&words, position_out_of_bounds, codelet_count, &sequence)
            .error,
        ERROR_VECTOR_WIDTH
    );
    assert_eq!(
        interpret_group_with_storage(&words, token_id_out_of_bounds, codelet_count, &sequence)
            .error,
        ERROR_VECTOR_WIDTH
    );
}

#[test]
fn embedding_lookup_checks_dynamic_index_bounds_and_dtype() {
    let input = [1.0f32; 4];
    let matrix = [1.0f32; 12];
    let mut words = std::vec::Vec::new();
    let lookup = append_embedding_lookup_from_index(&mut words, 0x6a71);

    let out_of_bounds_data = storage_with_index(&input, &matrix, 3, 4, 3);
    let out_of_bounds = out_of_bounds_data.view();
    assert_eq!(
        interpret_group_with_storage(&words, lookup, 1, &out_of_bounds).error,
        ERROR_VECTOR_WIDTH
    );

    let mut wrong_type = storage_with_index(&input, &matrix, 3, 4, 1);
    wrong_type.descriptors[39] = 0xaa6c;
    let wrong_type = wrong_type.view();
    assert_eq!(
        interpret_group_with_storage(&words, lookup, 1, &wrong_type).error,
        ERROR_UNSUPPORTED
    );

    let missing_index_data = storage_for_f32(&input, &matrix, 3, 4);
    let missing_index = missing_index_data.view();
    assert_eq!(
        interpret_group_with_storage(&words, lookup, 1, &missing_index).error,
        ERROR_UNSUPPORTED
    );
}

#[test]
fn matrix_vector_row_products_preserve_float64_precision() {
    let storage = storage_for_f64(&[1.5, -2.0], &[2.0, 3.0, 4.0, -1.0], 2, 2);
    let storage = storage.view();
    let mut words = std::vec::Vec::new();
    let starts = (0..2)
        .map(|row| append_matrix_row_dot(&mut words, row))
        .collect::<std::vec::Vec<_>>();
    assert_eq!(storage.section_count(), 2);
    assert_eq!(storage.shape(1, 0), Some(2));
    assert_eq!(storage.shape(1, 1), Some(2));
    let mut cursor = super::super::scalar_product::Cursor {
        start: starts[0],
        codelet: starts[0],
        slot: 10,
        end: starts[0] + 1,
    };
    let matrix_row = super::super::scalar_product::read_operand_with_row_index(
        &mut cursor,
        &words,
        starts[0],
        1,
        2,
        Some(0),
        &storage,
    )
    .expect("matrix row resolves");
    assert_eq!(matrix_row.kind, VALUE_VECTOR_FLOAT64);
    assert_eq!(matrix_row.length, 2);
    assert_eq!(matrix_row.storage_byte_offset, 16);
    let actual = starts
        .iter()
        .map(|start| {
            let result = interpret_group_with_storage(&words, *start, 2, &storage);
            assert_eq!(result.error, 0, "{result:?}");
            assert_eq!(result.value_kind, VALUE_FLOAT64);
            f64::from_bits(u64::from(result.values[0]) | (u64::from(result.values[1]) << 32))
        })
        .collect::<std::vec::Vec<_>>();
    assert_eq!(actual, [-3.0, 8.0]);
}
