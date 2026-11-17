use crate::WORDS_PER_CODELET;
use crate::literal::{UINT_SORT_DENOTE, VectorElements, decode_quote_header, index_word};

const HEAD: u16 = 0x0149;
const NUMBER_QUOTE: u16 = 0x881d;
const ACCUSATIVE_CASE: u16 = 0x245e;
const SOURCE_CASE: u16 = 0x313e;
const DESTINATION_CASE: u16 = 0x243e;
const COMITATIVE_CASE: u16 = 0x490f;
const INSTRUMENTAL_CASE: u16 = 0x287e;
const DATIVE_CASE: u16 = 0x207e;
const DEONTIC_MOOD: u16 = 0x295e;
const REALIS_MOOD: u16 = 0x217e;
const CONDITIONAL_MOOD: u16 = 0x29be;
const NUMBER_VERB: u16 = 0xea30;
const EQUALLY: u16 = 0x4809;

const PLUS: u16 = 0x8a64;
const SUBTRACT: u16 = 0xabd2;
const MULTIPLY: u16 = 0xec90;
const DIVIDE: u16 = 0x8893;
const XOR: u16 = 0xa810;
const EXPONENTIAL: u16 = 0x8c29;
const REMAINS: u16 = 0xe82a;
const INVERT: u16 = 0xaad2;

/// The legacy golden codelet: one plus one.
///
/// The golden is the shared fixture for every implementation of the numeric
/// semantics, so a destination compiles the same bytes the interpreter runs.
pub const GOLDEN_NUMERIC_PLUS_CODELET: [u16; WORDS_PER_CODELET] = [
    0x0149, 0x881d, 0x0001, 0x245e, 0x881d, 0x0001, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumericOperator {
    Plus,
    Subtract,
    Multiply,
    Divide,
    Xor,
    Exponential,
    Remains,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumericOperandCase {
    From,
    To,
    With,
    By,
}

impl NumericOperandCase {
    fn from_word(word: u16) -> Option<Self> {
        match word {
            SOURCE_CASE => Some(Self::From),
            DESTINATION_CASE => Some(Self::To),
            COMITATIVE_CASE => Some(Self::With),
            INSTRUMENTAL_CASE => Some(Self::By),
            _ => None,
        }
    }
}

impl NumericOperator {
    fn from_word(word: u16) -> Option<Self> {
        match word {
            PLUS => Some(Self::Plus),
            SUBTRACT => Some(Self::Subtract),
            MULTIPLY => Some(Self::Multiply),
            DIVIDE => Some(Self::Divide),
            XOR => Some(Self::Xor),
            EXPONENTIAL => Some(Self::Exponential),
            REMAINS => Some(Self::Remains),
            _ => None,
        }
    }

    fn word(self) -> u16 {
        match self {
            Self::Plus => PLUS,
            Self::Subtract => SUBTRACT,
            Self::Multiply => MULTIPLY,
            Self::Divide => DIVIDE,
            Self::Xor => XOR,
            Self::Exponential => EXPONENTIAL,
            Self::Remains => REMAINS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumericArithmeticInstruction {
    pub operator: NumericOperator,
    pub ob: u16,
    pub operand: u16,
    pub operand_case: NumericOperandCase,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumericVectorArithmeticInstruction {
    pub operator: NumericOperator,
    pub elements: Vec<u16>,
    pub operand: NumericVectorOperand,
    pub operand_case: NumericOperandCase,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NumericVectorOperand {
    Scalar(u16),
    Vector(Vec<u16>),
}

/// The legacy invert codelet carries the value in the accusative phrase and
/// the bound it is inverted about in the dative phrase. Pyash inverts a
/// number by negating it, so the bound is fixed at zero.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumericInvertInstruction {
    pub ob: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumericPlusInstruction {
    pub ob: u16,
    pub to: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConditionalNumberInstruction {
    pub left: u16,
    pub right: u16,
    pub consequence: u16,
    pub alternative: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticError {
    InvalidShape {
        index: usize,
        expected: u16,
        actual: u16,
    },
    NonzeroTail {
        index: usize,
        actual: u16,
    },
    UnsupportedOperator {
        actual: u16,
    },
    UnsupportedCase {
        actual: u16,
    },
    UnsupportedBound {
        actual: u16,
    },
    UnsupportedVectorWidth {
        actual: usize,
        maximum: usize,
    },
    InvalidBranchShape {
        index: usize,
        expected: u16,
        actual: u16,
    },
    UnsupportedBranch,
    VectorWidthMismatch {
        left: usize,
        right: usize,
    },
    UnsupportedCodelet,
    DivisionByZero,
    MalformedProgramlet,
    UnsupportedProgramlet,
    ProgramletFrameCapacity,
    ProgramletConstantWrite,
    ProgramletStepBudget,
    ProgramletProgramCapacity,
}

impl SemanticError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidShape { .. } => "malformed-codelet",
            Self::NonzeroTail { .. } => "nonzero-tail",
            Self::UnsupportedOperator { .. } => "unsupported-operator",
            Self::UnsupportedCase { .. } => "unsupported-case",
            Self::UnsupportedBound { .. } => "unsupported-sentence",
            Self::UnsupportedVectorWidth { .. } => "unsupported-vector-width",
            Self::InvalidBranchShape { .. } => "malformed-branch",
            Self::UnsupportedBranch => "unsupported-branch",
            Self::VectorWidthMismatch { .. } => "vector-width-mismatch",
            Self::UnsupportedCodelet => "unsupported-codelet",
            Self::DivisionByZero => "division-by-zero",
            Self::MalformedProgramlet => "malformed-programlet",
            Self::UnsupportedProgramlet => "unsupported-programlet",
            Self::ProgramletFrameCapacity => "programlet-frame-capacity",
            Self::ProgramletConstantWrite => "programlet-constant-write",
            Self::ProgramletStepBudget => "programlet-step-budget",
            Self::ProgramletProgramCapacity => "programlet-program-capacity",
        }
    }
}

impl std::fmt::Display for SemanticError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidShape {
                index,
                expected,
                actual,
            } => write!(
                formatter,
                "numeric-plus marker at word {index} expected 0x{expected:04x}, got 0x{actual:04x}"
            ),
            Self::NonzeroTail { index, actual } => {
                write!(
                    formatter,
                    "numeric-plus tail at word {index} is 0x{actual:04x}"
                )
            }
            Self::UnsupportedOperator { actual } => {
                write!(
                    formatter,
                    "numeric arithmetic operator 0x{actual:04x} is unsupported"
                )
            }
            Self::UnsupportedCase { actual } => write!(
                formatter,
                "numeric arithmetic has an unsupported operand case 0x{actual:04x}"
            ),
            Self::UnsupportedBound { actual } => {
                write!(
                    formatter,
                    "numeric invert only supports a zero bound, got {actual}"
                )
            }
            Self::UnsupportedVectorWidth { actual, maximum } => write!(
                formatter,
                "numeric vector arithmetic width {actual} is outside the supported range 2..={maximum}"
            ),
            Self::InvalidBranchShape {
                index,
                expected,
                actual,
            } => write!(
                formatter,
                "conditional branch word {index} expected 0x{expected:04x}, got 0x{actual:04x}"
            ),
            Self::UnsupportedBranch => {
                formatter.write_str("the conditional branch shape is not supported")
            }
            Self::VectorWidthMismatch { left, right } => write!(
                formatter,
                "numeric vector arithmetic requires equal operand widths, got {left} and {right}"
            ),
            Self::UnsupportedCodelet => formatter.write_str("the codelet family is unsupported"),
            Self::DivisionByZero => formatter.write_str("numeric division cannot divide by zero"),
            Self::MalformedProgramlet => {
                formatter.write_str("the canonical Pyash programlet is malformed")
            }
            Self::UnsupportedProgramlet => {
                formatter.write_str("the canonical Pyash programlet form is not supported")
            }
            Self::ProgramletFrameCapacity => {
                formatter.write_str("the programlet runtime frame capacity was exceeded")
            }
            Self::ProgramletConstantWrite => {
                formatter.write_str("a programlet attempted to write a constant quantity")
            }
            Self::ProgramletStepBudget => {
                formatter.write_str("the programlet execution step budget was exhausted")
            }
            Self::ProgramletProgramCapacity => {
                formatter.write_str("the programlet exceeds the supported codelet capacity")
            }
        }
    }
}

impl std::error::Error for SemanticError {}

fn expect(
    words: &[u16; WORDS_PER_CODELET],
    index: usize,
    expected: u16,
) -> Result<(), SemanticError> {
    let actual = words[index];
    if actual == expected {
        Ok(())
    } else {
        Err(SemanticError::InvalidShape {
            index,
            expected,
            actual,
        })
    }
}

pub fn decode_numeric_plus(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<NumericPlusInstruction, SemanticError> {
    let instruction = decode_numeric_arithmetic(words)?;
    if instruction.operator != NumericOperator::Plus {
        return Err(SemanticError::UnsupportedOperator {
            actual: instruction.operator.word(),
        });
    }
    if instruction.operand_case != NumericOperandCase::To {
        return Err(SemanticError::UnsupportedCase { actual: words[6] });
    }
    Ok(NumericPlusInstruction {
        ob: instruction.ob,
        to: instruction.operand,
    })
}

pub fn decode_numeric_arithmetic(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<NumericArithmeticInstruction, SemanticError> {
    expect(words, 0, HEAD)?;
    expect(words, 1, NUMBER_QUOTE)?;
    expect(words, 3, ACCUSATIVE_CASE)?;
    expect(words, 4, NUMBER_QUOTE)?;
    let operand_case = NumericOperandCase::from_word(words[6])
        .ok_or(SemanticError::UnsupportedCase { actual: words[6] })?;
    expect(words, 8, DEONTIC_MOOD)?;
    let operator = NumericOperator::from_word(words[7])
        .ok_or(SemanticError::UnsupportedOperator { actual: words[7] })?;
    for (index, actual) in words.iter().enumerate().skip(9) {
        if *actual != 0 {
            return Err(SemanticError::NonzeroTail {
                index,
                actual: *actual,
            });
        }
    }
    Ok(NumericArithmeticInstruction {
        operator,
        ob: words[2],
        operand: words[5],
        operand_case,
    })
}

/// Decode elementwise arithmetic over established unsigned vector quotes.
/// The right operand may be a scalar or a same-width vector quote.
pub fn decode_numeric_vector_arithmetic(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<NumericVectorArithmeticInstruction, SemanticError> {
    let header = decode_quote_header(words[1]).ok_or(SemanticError::UnsupportedCodelet)?;
    if header.sort != UINT_SORT_DENOTE || header.scalar_bytes != 2 || header.vector_thickness == 0 {
        return Err(SemanticError::UnsupportedCodelet);
    }
    let count = if header.explicit_vector_length {
        usize::from(words[2])
    } else {
        header
            .vector_words
            .ok_or(SemanticError::UnsupportedCodelet)?
    };
    if !(2..=8).contains(&count) {
        return Err(SemanticError::UnsupportedVectorWidth {
            actual: count,
            maximum: 8,
        });
    }

    let payload_start = if header.explicit_vector_length { 3 } else { 2 };
    let payload_end = payload_start + count;
    let accusative_offset = payload_end;
    let right_quote_offset = accusative_offset + 1;
    let (operand, case_offset) = if words[right_quote_offset] == NUMBER_QUOTE {
        (
            NumericVectorOperand::Scalar(words[right_quote_offset + 1]),
            right_quote_offset + 2,
        )
    } else {
        let right_header = decode_quote_header(words[right_quote_offset])
            .ok_or(SemanticError::UnsupportedCodelet)?;
        if right_header.sort != UINT_SORT_DENOTE
            || right_header.scalar_bytes != 2
            || right_header.vector_thickness == 0
        {
            return Err(SemanticError::UnsupportedCodelet);
        }
        let right_count = if right_header.explicit_vector_length {
            usize::from(words[right_quote_offset + 1])
        } else {
            right_header
                .vector_words
                .ok_or(SemanticError::UnsupportedCodelet)?
        };
        if right_count != count {
            return Err(SemanticError::VectorWidthMismatch {
                left: count,
                right: right_count,
            });
        }
        if !(2..=4).contains(&count) {
            return Err(SemanticError::UnsupportedVectorWidth {
                actual: count,
                maximum: 4,
            });
        }
        let right_payload_start = right_quote_offset
            + if right_header.explicit_vector_length {
                2
            } else {
                1
            };
        let right_end = right_payload_start + right_count;
        if right_end > WORDS_PER_CODELET {
            return Err(SemanticError::UnsupportedVectorWidth {
                actual: count,
                maximum: 4,
            });
        }
        (
            NumericVectorOperand::Vector(words[right_payload_start..right_end].to_vec()),
            right_end,
        )
    };
    let operator_offset = case_offset + 1;
    let mood_offset = operator_offset + 1;
    if mood_offset >= WORDS_PER_CODELET {
        return Err(SemanticError::UnsupportedVectorWidth {
            actual: count,
            maximum: if matches!(&operand, NumericVectorOperand::Vector(_)) {
                4
            } else {
                8
            },
        });
    }

    expect(words, accusative_offset, ACCUSATIVE_CASE)?;
    if matches!(&operand, NumericVectorOperand::Scalar(_)) {
        expect(words, right_quote_offset, NUMBER_QUOTE)?;
    }
    expect(words, mood_offset, DEONTIC_MOOD)?;
    let operand_case = NumericOperandCase::from_word(words[case_offset]).ok_or(
        SemanticError::UnsupportedCase {
            actual: words[case_offset],
        },
    )?;
    let operator = NumericOperator::from_word(words[operator_offset]).ok_or(
        SemanticError::UnsupportedOperator {
            actual: words[operator_offset],
        },
    )?;
    expect(
        words,
        0,
        index_word(&[accusative_offset, case_offset, mood_offset]),
    )?;
    for (index, actual) in words.iter().enumerate().skip(mood_offset + 1) {
        if *actual != 0 {
            return Err(SemanticError::NonzeroTail {
                index,
                actual: *actual,
            });
        }
    }

    Ok(NumericVectorArithmeticInstruction {
        operator,
        elements: words[payload_start..payload_end].to_vec(),
        operand,
        operand_case,
    })
}

pub fn execute_numeric_plus(instruction: &NumericPlusInstruction) -> u16 {
    instruction.ob.saturating_add(instruction.to)
}

/// Decode a Pyash conditional with an inline numeric equality test and two
/// inline numeric-literal arms. The input vectors are one completion-marked
/// sentence group, as emitted by the reference VLIW sentence encoder.
pub fn decode_conditional_number(
    codelets: &[[u16; WORDS_PER_CODELET]],
) -> Result<ConditionalNumberInstruction, SemanticError> {
    if codelets.len() < 2
        || codelets.first().is_some_and(|codelet| codelet[0] & 1 != 0)
        || codelets
            .iter()
            .take(codelets.len() - 1)
            .any(|codelet| codelet[0] & 1 != 0)
        || codelets.last().is_some_and(|codelet| codelet[0] & 1 == 0)
    {
        return Err(SemanticError::UnsupportedBranch);
    }

    let final_head = codelets.last().expect("non-empty branch group")[0];
    let last_slot = (1..WORDS_PER_CODELET)
        .rev()
        .find(|slot| final_head & (1 << slot) != 0)
        .ok_or(SemanticError::UnsupportedBranch)?;
    if codelets.last().expect("non-empty branch group")[last_slot + 1..]
        .iter()
        .any(|word| *word != 0)
    {
        return Err(SemanticError::UnsupportedBranch);
    }

    let mut words = Vec::with_capacity((codelets.len() - 1) * (WORDS_PER_CODELET - 1) + last_slot);
    let mut boundaries = Vec::new();
    for (vector_index, codelet) in codelets.iter().enumerate() {
        let completion = codelet[0] & 1 != 0;
        let end_slot = if vector_index + 1 == codelets.len() {
            last_slot
        } else {
            WORDS_PER_CODELET - 1
        };
        for slot in 1..=end_slot {
            words.push(codelet[slot]);
            if (codelet[0] & (1 << slot) != 0) == completion {
                boundaries.push(vector_index * (WORDS_PER_CODELET - 1) + slot);
            }
        }
    }

    const EXPECTED_BOUNDARIES: [usize; 7] = [3, 6, 8, 11, 13, 16, 18];
    if words.len() != 18 || boundaries != EXPECTED_BOUNDARIES {
        return Err(SemanticError::UnsupportedBranch);
    }

    for (index, expected) in [
        (0, NUMBER_QUOTE),
        (2, ACCUSATIVE_CASE),
        (3, NUMBER_QUOTE),
        (5, SOURCE_CASE),
        (6, EQUALLY),
        (7, CONDITIONAL_MOOD),
        (8, NUMBER_QUOTE),
        (10, ACCUSATIVE_CASE),
        (11, NUMBER_VERB),
        (12, REALIS_MOOD),
        (13, NUMBER_QUOTE),
        (15, ACCUSATIVE_CASE),
        (16, NUMBER_VERB),
        (17, REALIS_MOOD),
    ] {
        let actual = words[index];
        if actual != expected {
            return Err(SemanticError::InvalidBranchShape {
                index,
                expected,
                actual,
            });
        }
    }

    Ok(ConditionalNumberInstruction {
        left: words[1],
        right: words[4],
        consequence: words[9],
        alternative: words[14],
    })
}

pub fn execute_conditional_number(instruction: &ConditionalNumberInstruction) -> u16 {
    if instruction.left == instruction.right {
        instruction.consequence
    } else {
        instruction.alternative
    }
}

pub fn execute_conditional_number_codelets(
    codelets: &[[u16; WORDS_PER_CODELET]],
) -> Result<u16, SemanticError> {
    let instruction = decode_conditional_number(codelets)?;
    Ok(execute_conditional_number(&instruction))
}

/// Saturating exponentiation, matching the JavaScript reference backend:
/// the result is truncated and clamped into the unsigned 16-bit range.
fn saturating_power(base: u16, exponent: u16) -> u64 {
    let mut result: u64 = 1;
    let mut factor: u64 = u64::from(base);
    let mut remaining = exponent;
    while remaining > 0 {
        if remaining & 1 == 1 {
            result = result.saturating_mul(factor);
        }
        remaining >>= 1;
        if remaining > 0 {
            factor = factor.saturating_mul(factor);
        }
    }
    result.min(u64::from(u16::MAX))
}

pub fn execute_numeric_arithmetic(
    instruction: &NumericArithmeticInstruction,
) -> Result<u64, SemanticError> {
    execute_numeric_pair(instruction.operator, instruction.ob, instruction.operand)
}

fn execute_numeric_pair(
    operator: NumericOperator,
    left: u16,
    right: u16,
) -> Result<u64, SemanticError> {
    match operator {
        NumericOperator::Plus => Ok(u64::from(left.saturating_add(right))),
        NumericOperator::Subtract => Ok(u64::from(left.saturating_sub(right))),
        NumericOperator::Multiply => Ok(u64::from(left) * u64::from(right)),
        NumericOperator::Divide => {
            if right == 0 {
                return Err(SemanticError::DivisionByZero);
            }
            Ok(u64::from(left / right))
        }
        NumericOperator::Xor => Ok(u64::from(left ^ right)),
        NumericOperator::Exponential => Ok(saturating_power(left, right)),
        NumericOperator::Remains => {
            if right == 0 {
                return Err(SemanticError::DivisionByZero);
            }
            Ok(u64::from(left % right))
        }
    }
}

pub fn execute_numeric_vector_arithmetic(
    instruction: &NumericVectorArithmeticInstruction,
) -> Result<VectorElements, SemanticError> {
    if let NumericVectorOperand::Vector(values) = &instruction.operand {
        if values.len() != instruction.elements.len() {
            return Err(SemanticError::VectorWidthMismatch {
                left: instruction.elements.len(),
                right: values.len(),
            });
        }
    }
    let values = instruction
        .elements
        .iter()
        .enumerate()
        .map(|(index, left)| {
            let right = match &instruction.operand {
                NumericVectorOperand::Scalar(value) => *value,
                NumericVectorOperand::Vector(values) => values[index],
            };
            execute_numeric_pair(instruction.operator, *left, right)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if instruction.operator == NumericOperator::Multiply {
        Ok(VectorElements::Numbers32(
            values.into_iter().map(|value| value as u32).collect(),
        ))
    } else {
        Ok(VectorElements::Numbers(
            values.into_iter().map(|value| value as u16).collect(),
        ))
    }
}

pub fn decode_numeric_invert(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<NumericInvertInstruction, SemanticError> {
    expect(words, 0, HEAD)?;
    expect(words, 1, NUMBER_QUOTE)?;
    expect(words, 3, ACCUSATIVE_CASE)?;
    expect(words, 4, NUMBER_QUOTE)?;
    expect(words, 6, DATIVE_CASE)?;
    expect(words, 7, INVERT)?;
    expect(words, 8, DEONTIC_MOOD)?;
    for (index, actual) in words.iter().enumerate().skip(9) {
        if *actual != 0 {
            return Err(SemanticError::NonzeroTail {
                index,
                actual: *actual,
            });
        }
    }
    let bound = words[5];
    if bound != 0 {
        return Err(SemanticError::UnsupportedBound { actual: bound });
    }
    Ok(NumericInvertInstruction { ob: words[2] })
}

pub fn execute_numeric_invert(instruction: &NumericInvertInstruction) -> i64 {
    -i64::from(instruction.ob)
}

pub fn execute_numeric_plus_codelet(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<u16, SemanticError> {
    let instruction = decode_numeric_plus(words)?;
    Ok(execute_numeric_plus(&instruction))
}

pub fn execute_numeric_arithmetic_codelet(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<u64, SemanticError> {
    let instruction = decode_numeric_arithmetic(words)?;
    execute_numeric_arithmetic(&instruction)
}

pub fn execute_numeric_invert_codelet(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<i64, SemanticError> {
    let instruction = decode_numeric_invert(words)?;
    Ok(execute_numeric_invert(&instruction))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NumericCodeletValue {
    Unsigned(u64),
    Signed(i64),
    Vector(VectorElements),
}

pub(crate) fn execute_numeric_codelet(
    words: &[u16; WORDS_PER_CODELET],
) -> Option<Result<NumericCodeletValue, SemanticError>> {
    if looks_like_numeric_vector_arithmetic(words) {
        return Some(
            decode_numeric_vector_arithmetic(words)
                .and_then(|instruction| execute_numeric_vector_arithmetic(&instruction))
                .map(NumericCodeletValue::Vector),
        );
    }
    if words[7] == INVERT || words[6] == DATIVE_CASE {
        return Some(execute_numeric_invert_codelet(words).map(NumericCodeletValue::Signed));
    }
    if words[1] == NUMBER_QUOTE
        && words[3] == ACCUSATIVE_CASE
        && words[4] == NUMBER_QUOTE
        && words[8] == DEONTIC_MOOD
    {
        return Some(execute_numeric_arithmetic_codelet(words).map(NumericCodeletValue::Unsigned));
    }
    None
}

fn looks_like_numeric_vector_arithmetic(words: &[u16; WORDS_PER_CODELET]) -> bool {
    let Some(header) = decode_quote_header(words[1]) else {
        return false;
    };
    if header.sort != UINT_SORT_DENOTE || header.scalar_bytes != 2 || header.vector_thickness == 0 {
        return false;
    }
    let count = if header.explicit_vector_length {
        usize::from(words[2])
    } else {
        header.vector_words.unwrap_or(0)
    };
    if !(2..=8).contains(&count) {
        return false;
    }
    let payload_end = (if header.explicit_vector_length { 3 } else { 2 }) + count;
    if words.get(payload_end) != Some(&ACCUSATIVE_CASE) {
        return false;
    }
    let right_offset = payload_end + 1;
    let case_offset = if words.get(right_offset) == Some(&NUMBER_QUOTE) {
        right_offset + 2
    } else {
        let Some(right_header) = decode_quote_header(words[right_offset]) else {
            return false;
        };
        if right_header.sort != UINT_SORT_DENOTE
            || right_header.scalar_bytes != 2
            || right_header.vector_thickness == 0
        {
            return false;
        }
        let right_count = if right_header.explicit_vector_length {
            usize::from(words[right_offset + 1])
        } else {
            right_header.vector_words.unwrap_or(0)
        };
        right_offset
            + (if right_header.explicit_vector_length {
                2
            } else {
                1
            })
            + right_count
    };
    let operator_offset = case_offset + 1;
    let mood_offset = operator_offset + 1;
    words.get(payload_end) == Some(&ACCUSATIVE_CASE)
        && words
            .get(case_offset)
            .and_then(|word| NumericOperandCase::from_word(*word))
            .is_some()
        && words
            .get(operator_offset)
            .and_then(|word| NumericOperator::from_word(*word))
            .is_some()
        && words.get(mood_offset) == Some(&DEONTIC_MOOD)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_PLUS: [u16; WORDS_PER_CODELET] = GOLDEN_NUMERIC_PLUS_CODELET;

    #[test]
    fn decodes_and_executes_the_shared_fixture() {
        let instruction = decode_numeric_plus(&ONE_PLUS).expect("golden codelet is valid");
        assert_eq!(instruction.ob, 1);
        assert_eq!(instruction.to, 1);
        assert_eq!(execute_numeric_plus_codelet(&ONE_PLUS), Ok(2));
    }

    #[test]
    fn keeps_saturation_and_rejects_noisy_tail() {
        let mut saturated = ONE_PLUS;
        saturated[2] = u16::MAX;
        saturated[5] = 1;
        assert_eq!(execute_numeric_plus_codelet(&saturated), Ok(u16::MAX));

        let mut noisy = ONE_PLUS;
        noisy[9] = 1;
        let error = decode_numeric_plus(&noisy).expect_err("tail must be zero");
        assert_eq!(error.code(), "nonzero-tail");
    }

    fn arithmetic_codelet(operator: NumericOperator, ob: u16, to: u16) -> [u16; WORDS_PER_CODELET] {
        [
            HEAD,
            NUMBER_QUOTE,
            ob,
            ACCUSATIVE_CASE,
            NUMBER_QUOTE,
            to,
            DESTINATION_CASE,
            operator.word(),
            DEONTIC_MOOD,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ]
    }

    #[test]
    fn executes_the_other_proven_numeric_operators() {
        assert_eq!(
            execute_numeric_arithmetic_codelet(&arithmetic_codelet(
                NumericOperator::Subtract,
                2,
                9
            )),
            Ok(0)
        );
        assert_eq!(
            execute_numeric_arithmetic_codelet(&arithmetic_codelet(
                NumericOperator::Multiply,
                u16::MAX,
                u16::MAX
            )),
            Ok(4_294_836_225)
        );
        assert_eq!(
            execute_numeric_arithmetic_codelet(&arithmetic_codelet(NumericOperator::Divide, 5, 2)),
            Ok(2)
        );
        assert_eq!(
            execute_numeric_arithmetic_codelet(&arithmetic_codelet(NumericOperator::Xor, 7, 3)),
            Ok(4)
        );
    }

    #[test]
    fn executes_exponential_and_remainder_like_the_reference_backend() {
        assert_eq!(
            execute_numeric_arithmetic_codelet(&arithmetic_codelet(
                NumericOperator::Exponential,
                2,
                10
            )),
            Ok(1024)
        );
        assert_eq!(
            execute_numeric_arithmetic_codelet(&arithmetic_codelet(
                NumericOperator::Exponential,
                2,
                20
            )),
            Ok(u64::from(u16::MAX))
        );
        assert_eq!(
            execute_numeric_arithmetic_codelet(&arithmetic_codelet(NumericOperator::Remains, 9, 4)),
            Ok(1)
        );
    }

    fn invert_codelet(ob: u16, bound: u16) -> [u16; WORDS_PER_CODELET] {
        [
            HEAD,
            NUMBER_QUOTE,
            ob,
            ACCUSATIVE_CASE,
            NUMBER_QUOTE,
            bound,
            DATIVE_CASE,
            INVERT,
            DEONTIC_MOOD,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ]
    }

    #[test]
    fn executes_the_legacy_invert_shape() {
        assert_eq!(
            execute_numeric_invert_codelet(&invert_codelet(5, 0)),
            Ok(-5)
        );
        assert_eq!(
            execute_numeric_invert_codelet(&invert_codelet(5, 9)).expect_err("only a zero bound"),
            SemanticError::UnsupportedBound { actual: 9 }
        );
    }

    #[test]
    fn reports_arithmetic_operator_errors() {
        let mut unknown = arithmetic_codelet(NumericOperator::Plus, 1, 1);
        unknown[7] = 0x1234;
        assert_eq!(
            decode_numeric_arithmetic(&unknown).expect_err("unknown operator"),
            SemanticError::UnsupportedOperator { actual: 0x1234 }
        );

        let divide_by_zero = arithmetic_codelet(NumericOperator::Divide, 8, 0);
        assert_eq!(
            execute_numeric_arithmetic_codelet(&divide_by_zero).expect_err("division by zero"),
            SemanticError::DivisionByZero
        );

        let remainder_by_zero = arithmetic_codelet(NumericOperator::Remains, 9, 0);
        assert_eq!(
            execute_numeric_arithmetic_codelet(&remainder_by_zero).expect_err("division by zero"),
            SemanticError::DivisionByZero
        );
    }
}
