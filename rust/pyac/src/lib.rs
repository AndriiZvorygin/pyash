#![forbid(unsafe_code)]

pub mod backend;
pub mod catalog;
pub mod dictionary;
pub mod iwsp;
pub mod literal;
pub mod semantic;

pub use backend::riscv::{
    BackendError, RiscvProgram, compile_and_execute_numeric_arithmetic, compile_numeric_arithmetic,
    compile_numeric_invert, execute,
};
pub use catalog::{CatalogError, PyacCatalog, parse_catalog_pya};
pub use iwsp::{
    IwspError, IwspEvaluator, IwspScore, MAX_IWSP_CANDIDATE_CODELETS, MAX_IWSP_WIDTH,
    SealedIwspEvaluator,
};
pub use literal::{
    DateInstruction, VectorElements, VectorInstruction, decode_date, decode_quote_header,
    decode_vector, execute_date, execute_date_codelet, execute_vector, execute_vector_codelet,
    format_date, index_word,
};
pub use semantic::{
    ConditionalNumberInstruction, GOLDEN_NUMERIC_PLUS_CODELET, NumericArithmeticInstruction,
    NumericInvertInstruction, NumericOperandCase, NumericOperator, NumericPlusInstruction,
    NumericVectorArithmeticInstruction, NumericVectorOperand, SemanticError,
    decode_conditional_number, decode_numeric_arithmetic, decode_numeric_invert,
    decode_numeric_plus, decode_numeric_vector_arithmetic, execute_conditional_number,
    execute_conditional_number_codelets, execute_numeric_arithmetic,
    execute_numeric_arithmetic_codelet, execute_numeric_invert, execute_numeric_invert_codelet,
    execute_numeric_plus, execute_numeric_plus_codelet, execute_numeric_vector_arithmetic,
};

use std::fmt::{Display, Formatter};

pub const MAGIC: &[u8; 8] = b"PYACVLIW";
pub const FORMAT_VERSION: u16 = 1;
pub const WORD_BITS: u16 = 16;
pub const WORDS_PER_CODELET: usize = 16;
pub const HEADER_BYTES: usize = 32;
pub const CODELET_BYTES: usize = WORDS_PER_CODELET * 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PyacPack {
    pub version: u16,
    pub word_bits: u16,
    pub words_per_codelet: u16,
    pub codelet_bytes: u32,
    pub codelets: Vec<[u16; WORDS_PER_CODELET]>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PyacError {
    TooManyCodelets,
    TruncatedPack,
    InvalidMagic,
    UnsupportedVersion(u16),
    UnsupportedWordLayout {
        word_bits: u16,
        words_per_codelet: u16,
    },
    InvalidHeader {
        header_bytes: u16,
        codelet_bytes: u32,
        reserved: u32,
    },
    LengthMismatch {
        expected: usize,
        declared: u32,
        actual: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumericPackExecutionError {
    pub index: usize,
    pub source: SemanticError,
}

impl NumericPackExecutionError {
    pub fn code(&self) -> &'static str {
        self.source.code()
    }
}

impl Display for NumericPackExecutionError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "numeric codelet {} failed: {}",
            self.index, self.source
        )
    }
}

impl std::error::Error for NumericPackExecutionError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PyacValue {
    Unsigned(u64),
    Signed(i64),
    Float32(u32),
    Float64(u64),
    Fixed16(u16),
    Boolean(bool),
    DateEpochMs(u64),
    Vector(VectorElements),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackExecutionError {
    pub index: usize,
    pub source: SemanticError,
}

/// A section result; `section_index` is its source ordinal, while vector order
/// from `execute_pack_sections` records completion order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PyacSectionResult {
    pub section_index: usize,
    pub name_words: Vec<u16>,
    pub value: PyacValue,
}

fn map_independent_sections<T, F>(section_count: usize, worker_count: usize, execute: F) -> Vec<T>
where
    T: Send,
    F: Fn(usize) -> T + Sync,
{
    if section_count == 0 {
        return Vec::new();
    }
    let worker_count = worker_count.max(1).min(section_count);
    if worker_count == 1 {
        return (0..section_count).map(execute).collect();
    }

    let next_section = std::sync::atomic::AtomicUsize::new(0);
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            let sender = sender.clone();
            let execute = &execute;
            let next_section = &next_section;
            scope.spawn(move || {
                loop {
                    let section_index =
                        next_section.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if section_index >= section_count {
                        break;
                    }
                    if sender.send(execute(section_index)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(sender);
        receiver.into_iter().collect()
    })
}

impl PackExecutionError {
    pub fn code(&self) -> &'static str {
        self.source.code()
    }
}

impl Display for PackExecutionError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "PyAC codelet {} failed: {}",
            self.index, self.source
        )
    }
}

impl std::error::Error for PackExecutionError {}

impl PyacError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::TooManyCodelets => "too-many-codelets",
            Self::TruncatedPack => "truncated-pack",
            Self::InvalidMagic => "invalid-magic",
            Self::UnsupportedVersion(_) => "unsupported-version",
            Self::UnsupportedWordLayout { .. } => "unsupported-word-layout",
            Self::InvalidHeader { .. } => "invalid-header",
            Self::LengthMismatch { .. } => "truncated-pack",
        }
    }
}

impl Display for PyacError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooManyCodelets => {
                formatter.write_str("PyAC codelet count exceeds the 32-bit header field")
            }
            Self::TruncatedPack => {
                formatter.write_str("PyAC pack is shorter than its declared header")
            }
            Self::InvalidMagic => formatter.write_str("PyAC pack has an invalid magic value"),
            Self::UnsupportedVersion(version) => {
                write!(formatter, "PyAC pack version {version} is unsupported")
            }
            Self::UnsupportedWordLayout {
                word_bits,
                words_per_codelet,
            } => write!(
                formatter,
                "PyAC word layout is unsupported: {word_bits} bits, {words_per_codelet} words"
            ),
            Self::InvalidHeader {
                header_bytes,
                codelet_bytes,
                reserved,
            } => write!(
                formatter,
                "PyAC header is invalid: {header_bytes} header bytes, {codelet_bytes} codelet bytes, reserved {reserved}"
            ),
            Self::LengthMismatch {
                expected,
                declared,
                actual,
            } => write!(
                formatter,
                "PyAC length mismatch: expected {expected}, declared {declared}, actual {actual}"
            ),
        }
    }
}

impl std::error::Error for PyacError {}

fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

pub fn encode_pack(codelets: &[[u16; WORDS_PER_CODELET]]) -> Result<Vec<u8>, PyacError> {
    let count = u32::try_from(codelets.len()).map_err(|_| PyacError::TooManyCodelets)?;
    let payload_bytes = codelets
        .len()
        .checked_mul(CODELET_BYTES)
        .ok_or(PyacError::TooManyCodelets)?;
    let total_bytes = HEADER_BYTES
        .checked_add(payload_bytes)
        .ok_or(PyacError::TooManyCodelets)?;
    let total_bytes_u32 = u32::try_from(total_bytes).map_err(|_| PyacError::TooManyCodelets)?;
    let mut bytes = vec![0; total_bytes];

    bytes[..MAGIC.len()].copy_from_slice(MAGIC);
    write_u16(&mut bytes, 8, FORMAT_VERSION);
    write_u16(&mut bytes, 10, WORD_BITS);
    write_u16(&mut bytes, 12, WORDS_PER_CODELET as u16);
    write_u16(&mut bytes, 14, HEADER_BYTES as u16);
    write_u32(&mut bytes, 16, count);
    write_u32(&mut bytes, 20, CODELET_BYTES as u32);
    write_u32(&mut bytes, 24, total_bytes_u32);
    write_u32(&mut bytes, 28, 0);

    for (codelet_index, codelet) in codelets.iter().enumerate() {
        let start = HEADER_BYTES + codelet_index * CODELET_BYTES;
        for (word_index, word) in codelet.iter().enumerate() {
            write_u16(&mut bytes, start + word_index * 2, *word);
        }
    }
    Ok(bytes)
}

pub fn decode_pack(bytes: &[u8]) -> Result<PyacPack, PyacError> {
    if bytes.len() < HEADER_BYTES {
        return Err(PyacError::TruncatedPack);
    }
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(PyacError::InvalidMagic);
    }

    let version = read_u16(bytes, 8);
    let word_bits = read_u16(bytes, 10);
    let words_per_codelet = read_u16(bytes, 12);
    let header_bytes = read_u16(bytes, 14);
    let record_count = read_u32(bytes, 16) as usize;
    let codelet_bytes = read_u32(bytes, 20);
    let declared_bytes = read_u32(bytes, 24);
    let reserved = read_u32(bytes, 28);

    if version != FORMAT_VERSION {
        return Err(PyacError::UnsupportedVersion(version));
    }
    if word_bits != WORD_BITS || words_per_codelet != WORDS_PER_CODELET as u16 {
        return Err(PyacError::UnsupportedWordLayout {
            word_bits,
            words_per_codelet,
        });
    }
    if header_bytes as usize != HEADER_BYTES
        || codelet_bytes as usize != CODELET_BYTES
        || reserved != 0
    {
        return Err(PyacError::InvalidHeader {
            header_bytes,
            codelet_bytes,
            reserved,
        });
    }

    let expected_bytes =
        HEADER_BYTES
            .checked_add(record_count.checked_mul(CODELET_BYTES).ok_or(
                PyacError::LengthMismatch {
                    expected: usize::MAX,
                    declared: declared_bytes,
                    actual: bytes.len(),
                },
            )?)
            .ok_or(PyacError::LengthMismatch {
                expected: usize::MAX,
                declared: declared_bytes,
                actual: bytes.len(),
            })?;
    if declared_bytes as usize != expected_bytes || bytes.len() != expected_bytes {
        return Err(PyacError::LengthMismatch {
            expected: expected_bytes,
            declared: declared_bytes,
            actual: bytes.len(),
        });
    }

    let mut codelets = Vec::with_capacity(record_count);
    for codelet_index in 0..record_count {
        let start = HEADER_BYTES + codelet_index * CODELET_BYTES;
        let mut codelet = [0u16; WORDS_PER_CODELET];
        for (word_index, word) in codelet.iter_mut().enumerate() {
            *word = read_u16(bytes, start + word_index * 2);
        }
        codelets.push(codelet);
    }
    Ok(PyacPack {
        version,
        word_bits,
        words_per_codelet,
        codelet_bytes,
        codelets,
        bytes: bytes.to_vec(),
    })
}

pub fn execute_numeric_arithmetic_pack(
    pack: &PyacPack,
) -> Result<Vec<u64>, NumericPackExecutionError> {
    pack.codelets
        .iter()
        .enumerate()
        .map(|(index, codelet)| {
            execute_numeric_arithmetic_codelet(codelet)
                .map_err(|source| NumericPackExecutionError { index, source })
        })
        .collect()
}

fn programlet_error(error: u32) -> SemanticError {
    match error {
        pyac_vliw_core::ERROR_DIVISION_BY_ZERO => SemanticError::DivisionByZero,
        pyac_vliw_core::ERROR_FLOAT_DOMAIN => SemanticError::NonFiniteFloat,
        pyac_vliw_core::ERROR_FIXED16_DOMAIN => SemanticError::Fixed16Domain,
        pyac_vliw_core::ERROR_FRAME_CAPACITY => SemanticError::ProgramletFrameCapacity,
        pyac_vliw_core::ERROR_CONSTANT_WRITE => SemanticError::ProgramletConstantWrite,
        pyac_vliw_core::ERROR_STEP_BUDGET => SemanticError::ProgramletStepBudget,
        pyac_vliw_core::ERROR_PROGRAM_CAPACITY => SemanticError::ProgramletProgramCapacity,
        pyac_vliw_core::ERROR_CALL_DEPTH => SemanticError::ProgramletCallDepth,
        pyac_vliw_core::ERROR_UNSUPPORTED => SemanticError::UnsupportedProgramlet,
        _ => SemanticError::MalformedProgramlet,
    }
}

fn execute_shared_programlet(
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    error_index: usize,
) -> Result<PyacValue, PackExecutionError> {
    let mut sentence_words = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
    let mut sentence_boundaries = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
    let mut symbol_words = [0; pyac_vliw_core::PROGRAMLET_SCRATCH_WORDS];
    let mut frames =
        [pyac_vliw_core::ProgramletFrame::EMPTY; pyac_vliw_core::MAX_PROGRAMLET_CALL_DEPTH];
    let result = pyac_vliw_core::execute_numeric_programlet_at(
        words,
        base_codelet,
        codelet_count,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
        &mut sentence_words,
        &mut sentence_boundaries,
        &mut symbol_words,
        &mut frames,
    );
    if result.error != 0 {
        return Err(PackExecutionError {
            index: error_index,
            source: programlet_error(result.error),
        });
    }
    Ok(match result.value_kind {
        pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(result.values[0] != 0),
        pyac_vliw_core::VALUE_SIGNED => PyacValue::Signed(i64::from(result.values[0] as i32)),
        pyac_vliw_core::VALUE_FLOAT32 => PyacValue::Float32(result.values[0]),
        pyac_vliw_core::VALUE_FLOAT64 => {
            PyacValue::Float64(u64::from(result.values[0]) | (u64::from(result.values[1]) << 32))
        }
        pyac_vliw_core::VALUE_FIXED16 => PyacValue::Fixed16(result.values[0] as u16),
        _ => PyacValue::Unsigned(u64::from(result.values[0])),
    })
}

/// Executes independent named sections across available CPU threads.
/// Results are returned in completion order and retain their source ordinals.
pub fn execute_pack_sections(
    pack: &PyacPack,
) -> Result<Vec<PyacSectionResult>, PackExecutionError> {
    let words = pack
        .codelets
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect::<Vec<_>>();
    if !pyac_vliw_core::has_programlet_section_header(&words, pack.codelets.len()) {
        return Err(PackExecutionError {
            index: 0,
            source: SemanticError::UnsupportedProgramlet,
        });
    }
    let mut sections =
        [pyac_vliw_core::ProgramletSection::EMPTY; pyac_vliw_core::MAX_PROGRAMLET_SECTIONS];
    let section_count = pyac_vliw_core::scan_numeric_programlet_sections(
        &words,
        pack.codelets.len(),
        &mut sections,
    )
    .map_err(|error| PackExecutionError {
        index: 0,
        source: programlet_error(error),
    })?;

    let worker_count = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1);
    map_independent_sections(section_count, worker_count, |section_index| {
        let section = sections[section_index];
        let start = section.codelet_start as usize;
        let value = execute_shared_programlet(&words, start, section.codelet_count as usize, start);
        value.map(|value| PyacSectionResult {
            section_index,
            name_words: section.name_words[..section.name_length as usize]
                .iter()
                .map(|word| *word as u16)
                .collect(),
            value,
        })
    })
    .into_iter()
    .collect()
}

pub fn execute_pack(pack: &PyacPack) -> Result<Vec<PyacValue>, PackExecutionError> {
    use semantic::{
        NumericCodeletValue, execute_conditional_number_codelets, execute_numeric_codelet,
    };

    let words = pack
        .codelets
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect::<Vec<_>>();
    if pyac_vliw_core::has_programlet_section_header(&words, pack.codelets.len()) {
        let mut sections = execute_pack_sections(pack)?;
        // This compatibility API drops section identity, so retain its
        // historical source-order result contract. Callers that need actual
        // completion order should use execute_pack_sections instead.
        sections.sort_by_key(|section| section.section_index);
        return Ok(sections.into_iter().map(|section| section.value).collect());
    }
    if pyac_vliw_core::is_numeric_programlet(&words, pack.codelets.len()) {
        return execute_shared_programlet(&words, 0, pack.codelets.len(), 0)
            .map(|value| vec![value]);
    }

    let mut values = Vec::new();
    let mut index = 0;
    while index < pack.codelets.len() {
        let shared = pyac_vliw_core::interpret_group(&words, index, pack.codelets.len());
        if shared.error == pyac_vliw_core::ERROR_DIVISION_BY_ZERO {
            return Err(PackExecutionError {
                index,
                source: SemanticError::DivisionByZero,
            });
        }
        if shared.error == pyac_vliw_core::ERROR_FLOAT_DOMAIN {
            return Err(PackExecutionError {
                index,
                source: SemanticError::NonFiniteFloat,
            });
        }
        if shared.error == pyac_vliw_core::ERROR_FIXED16_DOMAIN {
            return Err(PackExecutionError {
                index,
                source: SemanticError::Fixed16Domain,
            });
        }
        if shared.error == 0 && shared.value_kind != 0 {
            let value = match shared.value_kind {
                pyac_vliw_core::VALUE_UNSIGNED => PyacValue::Unsigned(
                    u64::from(shared.values[0]) | (u64::from(shared.values[1]) << 32),
                ),
                pyac_vliw_core::VALUE_SIGNED => {
                    PyacValue::Signed(i64::from(shared.values[0] as i32))
                }
                pyac_vliw_core::VALUE_FLOAT32 => PyacValue::Float32(shared.values[0]),
                pyac_vliw_core::VALUE_FLOAT64 => PyacValue::Float64(
                    u64::from(shared.values[0]) | (u64::from(shared.values[1]) << 32),
                ),
                pyac_vliw_core::VALUE_FIXED16 => PyacValue::Fixed16(shared.values[0] as u16),
                pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(shared.values[0] != 0),
                pyac_vliw_core::VALUE_DATE => PyacValue::DateEpochMs(
                    u64::from(shared.values[0]) | (u64::from(shared.values[1]) << 32),
                ),
                pyac_vliw_core::VALUE_VECTOR_U16 => PyacValue::Vector(VectorElements::Numbers(
                    shared.values[..shared.length as usize]
                        .iter()
                        .map(|value| *value as u16)
                        .collect(),
                )),
                pyac_vliw_core::VALUE_VECTOR_U32 => PyacValue::Vector(VectorElements::Numbers32(
                    shared.values[..shared.length as usize].to_vec(),
                )),
                pyac_vliw_core::VALUE_VECTOR_BOOL => PyacValue::Vector(VectorElements::Booleans(
                    shared.values[..shared.length as usize]
                        .iter()
                        .map(|value| *value != 0)
                        .collect(),
                )),
                pyac_vliw_core::VALUE_VECTOR_FLOAT32 => PyacValue::Vector(VectorElements::Float32(
                    shared.values[..shared.length as usize].to_vec(),
                )),
                pyac_vliw_core::VALUE_VECTOR_FLOAT64 => {
                    let words = &shared.values[..shared.length as usize * 2];
                    PyacValue::Vector(VectorElements::Float64(
                        words
                            .chunks_exact(2)
                            .map(|pair| u64::from(pair[0]) | (u64::from(pair[1]) << 32))
                            .collect(),
                    ))
                }
                _ => unreachable!("shared VLIW core returned an unknown value kind"),
            };
            values.push(value);
            index += shared.consumed_codelets as usize;
            continue;
        }

        let start = index;
        while index < pack.codelets.len() && pack.codelets[index][0] & 1 == 0 {
            index += 1;
        }
        if index == pack.codelets.len() {
            return Err(PackExecutionError {
                index: start,
                source: SemanticError::UnsupportedCodelet,
            });
        }

        let group = &pack.codelets[start..=index];
        if group.len() > 1 {
            values.push(
                execute_conditional_number_codelets(group)
                    .map(|value| PyacValue::Unsigned(u64::from(value)))
                    .map_err(|source| PackExecutionError {
                        index: start,
                        source,
                    })?,
            );
        } else {
            let codelet = &group[0];
            if let Some(result) = execute_numeric_codelet(codelet) {
                values.push(
                    result
                        .map(|value| match value {
                            NumericCodeletValue::Unsigned(value) => PyacValue::Unsigned(value),
                            NumericCodeletValue::Signed(value) => PyacValue::Signed(value),
                            NumericCodeletValue::Vector(value) => PyacValue::Vector(value),
                        })
                        .map_err(|source| PackExecutionError {
                            index: start,
                            source,
                        })?,
                );
            } else if let Ok(value) = execute_date_codelet(codelet) {
                values.push(PyacValue::DateEpochMs(value));
            } else if let Ok(value) = execute_vector_codelet(codelet) {
                values.push(PyacValue::Vector(value));
            } else {
                return Err(PackExecutionError {
                    index: start,
                    source: SemanticError::UnsupportedCodelet,
                });
            }
        }
        index += 1;
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    const ONE_PLUS: [u16; WORDS_PER_CODELET] = [
        0x0149, 0x881d, 0x0001, 0x245e, 0x881d, 0x0001, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];

    #[test]
    fn independent_cpu_sections_are_returned_in_completion_order() {
        let start = Arc::new(Barrier::new(3));
        let completed = map_independent_sections(3, 3, {
            let start = Arc::clone(&start);
            move |section_index| {
                start.wait();
                let delay_ms = [40, 1, 20][section_index];
                std::thread::sleep(Duration::from_millis(delay_ms));
                section_index
            }
        });
        assert_eq!(completed, vec![1, 2, 0]);
    }

    #[test]
    fn encodes_the_shared_one_plus_one_fixture() {
        let bytes = encode_pack(&[ONE_PLUS]).expect("fixture fits");
        assert_eq!(&bytes[..8], b"PYACVLIW");
        assert_eq!(read_u16(&bytes, 8), 1);
        assert_eq!(read_u16(&bytes, 10), 16);
        assert_eq!(read_u16(&bytes, 12), 16);
        assert_eq!(read_u16(&bytes, 14), 32);
        assert_eq!(read_u32(&bytes, 16), 1);
        assert_eq!(read_u32(&bytes, 20), 32);
        assert_eq!(read_u32(&bytes, 24), 64);
        assert_eq!(read_u32(&bytes, 28), 0);
        assert_eq!(&bytes[32..34], &[0x49, 0x01]);
        assert_eq!(&bytes[46..48], &[0x64, 0x8a]);
        assert_eq!(&bytes[48..50], &[0x5e, 0x29]);
    }

    #[test]
    fn decodes_little_endian_codelets_and_round_trips() {
        let bytes = encode_pack(&[ONE_PLUS, [0; WORDS_PER_CODELET]]).expect("fixtures fit");
        let decoded = decode_pack(&bytes).expect("valid pack");
        assert_eq!(decoded.codelets, vec![ONE_PLUS, [0; WORDS_PER_CODELET]]);
        assert_eq!(decoded.bytes, bytes);
        assert_eq!(encode_pack(&decoded.codelets).expect("round trip"), bytes);
    }

    #[test]
    fn rejects_invalid_headers_with_stable_codes() {
        let bytes = encode_pack(&[ONE_PLUS]).expect("fixture fits");

        let mut bad_magic = bytes.clone();
        bad_magic[0] = b'X';
        assert_eq!(decode_pack(&bad_magic).unwrap_err().code(), "invalid-magic");

        let mut bad_version = bytes.clone();
        write_u16(&mut bad_version, 8, 2);
        assert_eq!(
            decode_pack(&bad_version).unwrap_err().code(),
            "unsupported-version"
        );

        let mut bad_layout = bytes.clone();
        write_u16(&mut bad_layout, 10, 8);
        assert_eq!(
            decode_pack(&bad_layout).unwrap_err().code(),
            "unsupported-word-layout"
        );

        let mut bad_reserved = bytes.clone();
        write_u32(&mut bad_reserved, 28, 1);
        assert_eq!(
            decode_pack(&bad_reserved).unwrap_err().code(),
            "invalid-header"
        );
    }

    #[test]
    fn rejects_truncation_and_declared_length_mismatch() {
        let bytes = encode_pack(&[ONE_PLUS]).expect("fixture fits");
        assert_eq!(
            decode_pack(&bytes[..31]).unwrap_err().code(),
            "truncated-pack"
        );

        let mut bad_length = bytes.clone();
        write_u32(&mut bad_length, 24, 32);
        assert_eq!(
            decode_pack(&bad_length).unwrap_err().code(),
            "truncated-pack"
        );
    }

    #[test]
    fn executes_numeric_codelets_after_pack_decode() {
        let mut subtract = ONE_PLUS;
        subtract[2] = 2;
        subtract[5] = 9;
        subtract[7] = 0xabd2;
        let bytes = encode_pack(&[ONE_PLUS, subtract]).expect("fixtures fit");
        let pack = decode_pack(&bytes).expect("valid pack");

        assert_eq!(execute_numeric_arithmetic_pack(&pack), Ok(vec![2, 0]));
    }

    #[test]
    fn preserves_the_failed_codelet_index() {
        let mut malformed = ONE_PLUS;
        malformed[7] = 0x1234;
        let bytes = encode_pack(&[ONE_PLUS, malformed]).expect("fixtures fit");
        let pack = decode_pack(&bytes).expect("valid pack");
        let error = execute_numeric_arithmetic_pack(&pack).expect_err("unknown operator");

        assert_eq!(error.index, 1);
        assert_eq!(error.code(), "unsupported-operator");
    }
}
