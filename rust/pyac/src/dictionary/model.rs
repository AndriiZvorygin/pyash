use std::fmt::{Display, Formatter};
use std::ops::Range;

use super::operation::OperationSignature;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DictionaryIndexError {
    EmptyKey,
    DuplicateKey(Vec<u16>),
    InvalidCodeletRange {
        key: Vec<u16>,
        start: u32,
        count: u32,
        pack_codelets: usize,
    },
    OverlappingCodeletRanges {
        first_key: Vec<u16>,
        second_key: Vec<u16>,
    },
    EmptyLexicalField {
        key: Vec<u16>,
        field: &'static str,
    },
    InvalidNormalization {
        key: Vec<u16>,
        surface: String,
        normalized: String,
    },
    EmptySourceField {
        key: Vec<u16>,
        field: &'static str,
    },
    MissingReference {
        key: Vec<u16>,
        reference: Vec<u16>,
    },
    InvalidOperationSignature {
        key: Vec<u16>,
        reason: &'static str,
    },
}

impl Display for DictionaryIndexError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyKey => formatter.write_str("dictionary entry has an empty Pyac key"),
            Self::DuplicateKey(key) => write!(formatter, "duplicate Pyac dictionary key {key:?}"),
            Self::InvalidCodeletRange {
                key,
                start,
                count,
                pack_codelets,
            } => write!(
                formatter,
                "entry {key:?} has invalid codelet range {start}..+{count} in a {pack_codelets}-codelet pack"
            ),
            Self::OverlappingCodeletRanges {
                first_key,
                second_key,
            } => write!(
                formatter,
                "dictionary entries {first_key:?} and {second_key:?} have overlapping codelet ranges"
            ),
            Self::EmptyLexicalField { key, field } => {
                write!(formatter, "entry {key:?} has an empty lexical {field}")
            }
            Self::InvalidNormalization { key, .. } => write!(
                formatter,
                "entry {key:?} normalized form must be the NFC form of its exact surface"
            ),
            Self::EmptySourceField { key, field } => {
                write!(formatter, "entry {key:?} has an empty source-link {field}")
            }
            Self::MissingReference { key, reference } => {
                write!(
                    formatter,
                    "entry {key:?} references missing Pyac key {reference:?}"
                )
            }
            Self::InvalidOperationSignature { key, reason } => {
                write!(
                    formatter,
                    "entry {key:?} has an invalid operation signature: {reason}"
                )
            }
        }
    }
}

impl std::error::Error for DictionaryIndexError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LexicalForm {
    pub language: String,
    pub surface: String,
    pub normalized: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceLink {
    pub dataset: String,
    pub release: String,
    pub identifier: String,
    pub relation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictionaryEntry {
    pub key: Vec<u16>,
    pub codelet_start: u32,
    pub codelet_count: u32,
    pub lexical_forms: Vec<LexicalForm>,
    pub source_links: Vec<SourceLink>,
    pub task_keys: Vec<Vec<u16>>,
    pub references: Vec<Vec<u16>>,
    pub operation_signatures: Vec<OperationSignature>,
}

impl DictionaryEntry {
    pub fn codelet_range(&self) -> Range<usize> {
        let start = self.codelet_start as usize;
        start..start + self.codelet_count as usize
    }
}
