use super::*;

const INPUT: u32 = 0x4123;
const OUTPUT: u32 = 0x4567;
const WEIGHTS: u32 = 0x4890;
const NUMBER_QUOTE: u32 = 0x881d;
const DESTINATION: u32 = 0x243e;
const LOCATIVE: u32 = 0x615f;
const INSTRUMENTAL: u32 = 0x287e;
const SCALAR_WORD: u32 = 0x0d62;
const PRODUCE_WORD: u32 = 0x8944;
const DEONTIC: u32 = 0x295e;
const SOURCE: u32 = 0x313e;
const NAME_TYPE: u32 = 0x225e;
const LOOKUP_FIRST: u32 = 0xec4a;
const LOOKUP_SECOND: u32 = 0xa948;

fn append_group(words: &mut std::vec::Vec<u32>, tokens: &[u32], boundaries: &[usize]) -> usize {
    let start = words.len() / CODELET_WORDS;
    let mut codelet = [0; CODELET_WORDS];
    codelet[0] = 1;
    codelet[1..=tokens.len()].copy_from_slice(tokens);
    for boundary in boundaries {
        codelet[0] |= 1 << (boundary + 1);
    }
    words.extend(codelet);
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
