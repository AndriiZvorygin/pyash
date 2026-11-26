use std::hint::black_box;
use std::time::Instant;

use pyac::dictionary::{
    DictionaryEntry, DictionaryIndex, LexicalForm, OperationParameter, ArgumentSlot,
    OperationSignature, OperationSignatureKey, SourceLink,
};

const ENTRY_COUNT: usize = 100_000;
const LINEAR_QUERY_COUNT: usize = 100;

fn main() {
    let entries = (0..ENTRY_COUNT)
        .map(|index| DictionaryEntry {
            key: key_for(index).to_vec(),
            codelet_start: index as u32,
            codelet_count: 1,
            lexical_forms: vec![LexicalForm {
                language: "en".into(),
                surface: format!("term-{index:06}"),
                normalized: format!("term-{index:06}"),
            }],
            source_links: vec![SourceLink {
                dataset: "wordnet".into(),
                release: "2025".into(),
                identifier: format!("n:{index:08}"),
                relation: "same-sense".into(),
            }],
            task_keys: Vec::new(),
            references: Vec::new(),
            operation_signatures: vec![OperationSignature {
                verb: key_for(index).to_vec(),
                mood: vec![600],
                arguments: vec![OperationParameter {
                    case_type: ArgumentSlot {
                        grammatical_case: vec![601],
                        noun_class: vec![602],
                    },
                    tag_label: "input value".into(),
                    descriptive_specification: "the value consumed by this operation".into(),
                }],
                results: Vec::new(),
            }],
        })
        .collect();

    let start = Instant::now();
    let index = DictionaryIndex::new(ENTRY_COUNT, entries).expect("valid synthetic index");
    let build_time = start.elapsed();
    let queries = (0..ENTRY_COUNT)
        .map(|query| {
            let target = query * 7919 % ENTRY_COUNT;
            (
                key_for(target),
                format!("term-{target:06}"),
                format!("n:{target:08}"),
                OperationSignatureKey::new(
                    key_for(target).to_vec(),
                    vec![600],
                    vec![ArgumentSlot {
                        grammatical_case: vec![601],
                        noun_class: vec![602],
                    }],
                ),
            )
        })
        .collect::<Vec<_>>();

    let start = Instant::now();
    let key_hits = queries
        .iter()
        .map(|(key, _, _, _)| black_box(index.by_key(black_box(key)).is_some()) as usize)
        .sum::<usize>();
    let key_time = start.elapsed();

    let start = Instant::now();
    let surface_hits = queries
        .iter()
        .map(|(_, surface, _, _)| {
            black_box(
                index
                    .by_surface(black_box("en"), black_box(surface))
                    .count(),
            )
        })
        .sum::<usize>();
    let surface_time = start.elapsed();

    let start = Instant::now();
    let source_hits = queries
        .iter()
        .map(|(_, _, identifier, _)| {
            black_box(
                index
                    .by_source(
                        black_box("wordnet"),
                        black_box("2025"),
                        black_box(identifier),
                    )
                    .count(),
            )
        })
        .sum::<usize>();
    let source_time = start.elapsed();

    let start = Instant::now();
    let operation_hits = queries
        .iter()
        .map(|(_, _, _, signature)| {
            black_box(index.by_operation_signature(black_box(signature)).count())
        })
        .sum::<usize>();
    let operation_time = start.elapsed();

    let linear_queries = &queries[..LINEAR_QUERY_COUNT];
    let start = Instant::now();
    let linear_key_hits = linear_queries
        .iter()
        .map(|(key, _, _, _)| {
            black_box(
                index
                    .entries()
                    .iter()
                    .find(|entry| entry.key.as_slice() == key)
                    .is_some(),
            ) as usize
        })
        .sum::<usize>();
    let linear_key_time = start.elapsed();

    let start = Instant::now();
    let linear_surface_hits = linear_queries
        .iter()
        .map(|(_, surface, _, _)| {
            black_box(index.entries().iter().any(|entry| {
                entry
                    .lexical_forms
                    .iter()
                    .any(|form| form.language == "en" && form.normalized == *surface)
            })) as usize
        })
        .sum::<usize>();
    let linear_surface_time = start.elapsed();

    let start = Instant::now();
    let linear_source_hits = linear_queries
        .iter()
        .map(|(_, _, identifier, _)| {
            black_box(index.entries().iter().any(|entry| {
                entry.source_links.iter().any(|link| {
                    link.dataset == "wordnet"
                        && link.release == "2025"
                        && link.identifier == *identifier
                })
            })) as usize
        })
        .sum::<usize>();
    let linear_source_time = start.elapsed();

    let start = Instant::now();
    let linear_operation_hits = linear_queries
        .iter()
        .map(|(_, _, _, key)| {
            black_box(index.entries().iter().any(|entry| {
                entry.operation_signatures.iter().any(|signature| {
                    signature.verb == key.verb()
                        && signature.mood == key.mood()
                        && signature
                            .arguments
                            .iter()
                            .map(|argument| &argument.key)
                            .eq(key.arguments().iter())
                })
            })) as usize
        })
        .sum::<usize>();
    let linear_operation_time = start.elapsed();

    println!("entries: {ENTRY_COUNT}");
    println!("index build: {build_time:?}");
    println!("posting arrays: {} bytes", index.posting_storage_bytes());
    report("indexed Pyac key", key_time, ENTRY_COUNT, key_hits);
    report(
        "indexed language + surface",
        surface_time,
        ENTRY_COUNT,
        surface_hits,
    );
    report(
        "indexed dataset + release + ID",
        source_time,
        ENTRY_COUNT,
        source_hits,
    );
    report(
        "indexed operation signature",
        operation_time,
        ENTRY_COUNT,
        operation_hits,
    );
    report(
        "linear Pyac key",
        linear_key_time,
        LINEAR_QUERY_COUNT,
        linear_key_hits,
    );
    report(
        "linear language + surface",
        linear_surface_time,
        LINEAR_QUERY_COUNT,
        linear_surface_hits,
    );
    report(
        "linear dataset + release + ID",
        linear_source_time,
        LINEAR_QUERY_COUNT,
        linear_source_hits,
    );
    report(
        "linear operation signature",
        linear_operation_time,
        LINEAR_QUERY_COUNT,
        linear_operation_hits,
    );
}

fn key_for(index: usize) -> [u16; 2] {
    [(index & 0xffff) as u16, (index >> 16) as u16]
}

fn report(label: &str, elapsed: std::time::Duration, queries: usize, hits: usize) {
    println!(
        "{label} lookup: {elapsed:?} ({:.0} queries/s, {hits} hits)",
        queries as f64 / elapsed.as_secs_f64()
    );
}
