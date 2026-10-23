use crate::WORDS_PER_CODELET;

const HEAD: u16 = 0x0149;
const NUMBER_QUOTE: u16 = 0x881d;
const INSTRUMENTAL_CASE: u16 = 0x287e;
const ACCUSATIVE_CASE: u16 = 0x245e;
const DEONTIC_MOOD: u16 = 0x295e;

const PLUS: u16 = 0x8a64;
const SUBTRACT: u16 = 0xabd2;
const MULTIPLY: u16 = 0xec90;
const DIVIDE: u16 = 0x8893;
const XOR: u16 = 0xa810;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumericOperator {
    Plus,
    Subtract,
    Multiply,
    Divide,
    Xor,
}

impl NumericOperator {
    fn from_word(word: u16) -> Option<Self> {
        match word {
            PLUS => Some(Self::Plus),
            SUBTRACT => Some(Self::Subtract),
            MULTIPLY => Some(Self::Multiply),
            DIVIDE => Some(Self::Divide),
            XOR => Some(Self::Xor),
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
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumericArithmeticInstruction {
    pub operator: NumericOperator,
    pub ob: u16,
    pub to: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumericPlusInstruction {
    pub ob: u16,
    pub to: u16,
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
    DivisionByZero,
}

impl SemanticError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidShape { .. } => "malformed-codelet",
            Self::NonzeroTail { .. } => "nonzero-tail",
            Self::UnsupportedOperator { .. } => "unsupported-operator",
            Self::DivisionByZero => "division-by-zero",
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
            Self::DivisionByZero => formatter.write_str("numeric division cannot divide by zero"),
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
    Ok(NumericPlusInstruction {
        ob: instruction.ob,
        to: instruction.to,
    })
}

pub fn decode_numeric_arithmetic(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<NumericArithmeticInstruction, SemanticError> {
    expect(words, 0, HEAD)?;
    expect(words, 1, NUMBER_QUOTE)?;
    expect(words, 3, INSTRUMENTAL_CASE)?;
    expect(words, 4, NUMBER_QUOTE)?;
    expect(words, 6, ACCUSATIVE_CASE)?;
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
        to: words[5],
    })
}

pub fn execute_numeric_plus(instruction: &NumericPlusInstruction) -> u16 {
    instruction.ob.saturating_add(instruction.to)
}

pub fn execute_numeric_arithmetic(
    instruction: &NumericArithmeticInstruction,
) -> Result<u64, SemanticError> {
    match instruction.operator {
        NumericOperator::Plus => Ok(u64::from(instruction.ob.saturating_add(instruction.to))),
        NumericOperator::Subtract => Ok(u64::from(instruction.ob.saturating_sub(instruction.to))),
        NumericOperator::Multiply => Ok(u64::from(instruction.ob) * u64::from(instruction.to)),
        NumericOperator::Divide => {
            if instruction.to == 0 {
                return Err(SemanticError::DivisionByZero);
            }
            Ok(u64::from(instruction.ob / instruction.to))
        }
        NumericOperator::Xor => Ok(u64::from(instruction.ob ^ instruction.to)),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_PLUS: [u16; WORDS_PER_CODELET] = [
        0x0149, 0x881d, 0x0001, 0x287e, 0x881d, 0x0001, 0x245e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];

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
            INSTRUMENTAL_CASE,
            NUMBER_QUOTE,
            to,
            ACCUSATIVE_CASE,
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
    fn reports_arithmetic_operator_errors() {
        let mut unknown = arithmetic_codelet(NumericOperator::Plus, 1, 1);
        unknown[7] = 0xe82a;
        assert_eq!(
            decode_numeric_arithmetic(&unknown).expect_err("unknown operator"),
            SemanticError::UnsupportedOperator { actual: 0xe82a }
        );

        let divide_by_zero = arithmetic_codelet(NumericOperator::Divide, 8, 0);
        assert_eq!(
            execute_numeric_arithmetic_codelet(&divide_by_zero).expect_err("division by zero"),
            SemanticError::DivisionByZero
        );
    }
}
