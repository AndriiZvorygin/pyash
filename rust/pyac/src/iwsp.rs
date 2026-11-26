//! Bounded host orchestration for the IWSP score/evaluate boundary.
//!
//! Candidate code is a PyAC pack executed by the shared Rust VLIW runtime. Its
//! final `width` scalar float32 results are predictions. Reference values stay
//! in this trusted evaluator and are passed to the existing Pyash `pluk tlas`
//! operation only after candidate execution has finished.

use crate::{
    PackExecutionError, PyacPack, PyacValue, WORDS_PER_CODELET, decode_pack, encode_pack,
    execute_pack,
};

pub const MAX_IWSP_WIDTH: usize = pyac_vliw_core::MAX_VECTOR_LANES;

const NOMINATIVE: u32 = 0x24de;
const ACCUSATIVE: u32 = 0x245e;
const DESTINATION: u32 = 0x243e;
const INSTRUMENTAL: u32 = 0x287e;
const REALIS: u32 = 0x217e;
const DEONTIC: u32 = 0x295e;
const NAME_TYPE: u32 = 0x225e;
const NUMBER_TYPE: u32 = 0x327e;
const PLUK: u32 = 0x2a64;
const TLAS: u32 = 0x896a;
const PREDICTION: u32 = 0x68b1;
const ANSWER: u32 = 0x4930;
/// `hgut` = count. The slot holds how many predictions were right; the atom
/// itself just means "count".
const HGUT_COUNT: u32 = 0xaa90;
const CORRECT_COUNT: u32 = HGUT_COUNT;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IwspScore {
    pub correct: u32,
    pub total: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub enum IwspError {
    InvalidReferenceWidth,
    ReferenceNonFinite { index: usize },
    CandidateExecution(PackExecutionError),
    CandidateOutputCount { expected: usize, available: usize },
    CandidateOutputType { index: usize },
    CandidateNonFinite { index: usize },
    JudgePack,
    JudgeExecution(PackExecutionError),
    JudgeResult,
}

impl std::fmt::Display for IwspError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidReferenceWidth => write!(
                formatter,
                "IWSP reference widths must use a supported vector length (1, 2, 3, 4, 8, or {MAX_IWSP_WIDTH}) and match across splits"
            ),
            Self::ReferenceNonFinite { index } => {
                write!(formatter, "IWSP reference value {index} is not finite")
            }
            Self::CandidateExecution(error) => write!(formatter, "candidate failed: {error}"),
            Self::CandidateOutputCount {
                expected,
                available,
            } => write!(
                formatter,
                "candidate must end with {expected} float32 predictions; only {available} results are available"
            ),
            Self::CandidateOutputType { index } => {
                write!(
                    formatter,
                    "candidate prediction {index} is not a float32 scalar"
                )
            }
            Self::CandidateNonFinite { index } => {
                write!(formatter, "candidate prediction {index} is not finite")
            }
            Self::JudgePack => formatter.write_str("trusted Pyash judge pack could not be built"),
            Self::JudgeExecution(error) => write!(formatter, "trusted Pyash judge failed: {error}"),
            Self::JudgeResult => {
                formatter.write_str("trusted Pyash judge returned an invalid result")
            }
        }
    }
}

impl std::error::Error for IwspError {}

/// Trusted references are kept separate from the candidate pack.
pub struct IwspEvaluator {
    visible_reference: Vec<u32>,
    held_out_reference: Vec<u32>,
}

/// A one-use evaluator for the sealed split. Consuming it prevents repeated
/// held-out queries through this API.
pub struct SealedIwspEvaluator {
    held_out_reference: Vec<u32>,
}

impl IwspEvaluator {
    pub fn new(visible_reference: &[f32], held_out_reference: &[f32]) -> Result<Self, IwspError> {
        if visible_reference.is_empty()
            || visible_reference.len() > MAX_IWSP_WIDTH
            || vector_quote(visible_reference.len()).is_none()
            || visible_reference.len() != held_out_reference.len()
        {
            return Err(IwspError::InvalidReferenceWidth);
        }
        let visible_reference = reference_bits(visible_reference)?;
        let held_out_reference = reference_bits(held_out_reference)?;
        Ok(Self {
            visible_reference,
            held_out_reference,
        })
    }

    /// Scores the candidate's final `width` scalar outputs against visible data.
    pub fn score_visible(&self, candidate: &PyacPack) -> Result<IwspScore, IwspError> {
        score_pack(candidate, &self.visible_reference)
    }

    /// Scores predictions produced by any conforming PyAC execution target.
    pub fn score_visible_predictions(&self, predictions: &[f32]) -> Result<IwspScore, IwspError> {
        score_predictions(predictions, &self.visible_reference)
    }

    /// Ends the visible-feedback phase and yields a one-use held-out evaluator.
    pub fn seal(self) -> SealedIwspEvaluator {
        SealedIwspEvaluator {
            held_out_reference: self.held_out_reference,
        }
    }
}

impl SealedIwspEvaluator {
    /// Evaluates one sealed candidate. The evaluator is consumed, so this API
    /// cannot be queried repeatedly to tune against held-out labels.
    pub fn evaluate(self, candidate: &PyacPack) -> Result<IwspScore, IwspError> {
        score_pack(candidate, &self.held_out_reference)
    }

    /// Evaluates predictions from a sealed candidate on the held-out split.
    pub fn evaluate_predictions(self, predictions: &[f32]) -> Result<IwspScore, IwspError> {
        score_predictions(predictions, &self.held_out_reference)
    }
}

fn reference_bits(values: &[f32]) -> Result<Vec<u32>, IwspError> {
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            value
                .is_finite()
                .then_some(value.to_bits())
                .ok_or(IwspError::ReferenceNonFinite { index })
        })
        .collect()
}

fn score_pack(candidate: &PyacPack, reference: &[u32]) -> Result<IwspScore, IwspError> {
    let outputs = execute_pack(candidate).map_err(IwspError::CandidateExecution)?;
    let start =
        outputs
            .len()
            .checked_sub(reference.len())
            .ok_or(IwspError::CandidateOutputCount {
                expected: reference.len(),
                available: outputs.len(),
            })?;
    let predictions = outputs[start..]
        .iter()
        .enumerate()
        .map(|(index, output)| match output {
            PyacValue::Float32(bits) if f32::from_bits(*bits).is_finite() => Ok(*bits),
            PyacValue::Float32(_) => Err(IwspError::CandidateNonFinite { index }),
            _ => Err(IwspError::CandidateOutputType { index }),
        })
        .collect::<Result<Vec<_>, _>>()?;
    score_prediction_bits(&predictions, reference)
}

fn score_predictions(predictions: &[f32], reference: &[u32]) -> Result<IwspScore, IwspError> {
    if predictions.len() != reference.len() {
        return Err(IwspError::CandidateOutputCount {
            expected: reference.len(),
            available: predictions.len(),
        });
    }
    let bits = predictions
        .iter()
        .enumerate()
        .map(|(index, value)| {
            value
                .is_finite()
                .then_some(value.to_bits())
                .ok_or(IwspError::CandidateNonFinite { index })
        })
        .collect::<Result<Vec<_>, _>>()?;
    score_prediction_bits(&bits, reference)
}

fn score_prediction_bits(predictions: &[u32], reference: &[u32]) -> Result<IwspScore, IwspError> {
    let judge = build_judge_pack(predictions, reference).ok_or(IwspError::JudgePack)?;
    let results = execute_pack(&judge).map_err(IwspError::JudgeExecution)?;
    match results.last() {
        Some(PyacValue::Unsigned(correct)) => Ok(IwspScore {
            correct: *correct as u32,
            total: reference.len() as u32,
        }),
        _ => Err(IwspError::JudgeResult),
    }
}

fn vector_quote(width: usize) -> Option<u32> {
    match width {
        1 => Some(0xd61d),
        2 => Some(0xd11d),
        3 => Some(0xd71d),
        4 => Some(0xd21d),
        8 => Some(0xd31d),
        16 => Some(0xd41d),
        _ => None,
    }
}

fn append_group(
    codelets: &mut Vec<[u16; WORDS_PER_CODELET]>,
    tokens: &[u32],
    boundaries: &[usize],
) -> Option<()> {
    if tokens.is_empty() || tokens.iter().any(|token| *token > u32::from(u16::MAX)) {
        return None;
    }
    let chunk_count = tokens.len().div_ceil(WORDS_PER_CODELET - 1);
    for (chunk_index, chunk) in tokens.chunks(WORDS_PER_CODELET - 1).enumerate() {
        let complete = chunk_index + 1 == chunk_count;
        let token_start = chunk_index * (WORDS_PER_CODELET - 1);
        let mut codelet = [0u16; WORDS_PER_CODELET];
        codelet[0] = u16::from(complete);
        for (offset, token) in chunk.iter().enumerate() {
            codelet[offset + 1] = *token as u16;
            let boundary = boundaries.contains(&(token_start + offset));
            if boundary == complete {
                codelet[0] |= 1 << (offset + 1);
            }
        }
        codelets.push(codelet);
    }
    Some(())
}

fn append_vector(
    codelets: &mut Vec<[u16; WORDS_PER_CODELET]>,
    name: u32,
    values: &[u32],
) -> Option<()> {
    let mut tokens = vec![name, NOMINATIVE, vector_quote(values.len())?];
    for bits in values {
        tokens.extend([bits & 0xffff, bits >> 16]);
    }
    let accusative = tokens.len();
    tokens.extend([ACCUSATIVE, REALIS]);
    append_group(codelets, &tokens, &[1, accusative, accusative + 1])
}

fn build_judge_pack(predictions: &[u32], reference: &[u32]) -> Option<PyacPack> {
    let mut codelets = Vec::new();
    append_vector(&mut codelets, PREDICTION, predictions)?;
    append_vector(&mut codelets, ANSWER, reference)?;
    // `gi <prediction> ka | do gi <count> ma | gi <answer> yu | pluk tlas tu`.
    // The destination carries one class tag (`do`) and one `gi`, because it is a
    // typed number held under a name.
    let sentence = [
        NAME_TYPE,
        PREDICTION,
        ACCUSATIVE,
        NUMBER_TYPE,
        NAME_TYPE,
        CORRECT_COUNT,
        DESTINATION,
        NAME_TYPE,
        ANSWER,
        INSTRUMENTAL,
        PLUK,
        TLAS,
        DEONTIC,
    ];
    append_group(&mut codelets, &sentence, &[2, 6, 9, 12])?;
    decode_pack(&encode_pack(&codelets).ok()?).ok()
}
