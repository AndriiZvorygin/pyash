use crate::WORDS_PER_CODELET;

const HEAD: u16 = 0x0149;
const NUMBER_QUOTE: u16 = 0x881d;
const INSTRUMENTAL_CASE: u16 = 0x287e;
const ACCUSATIVE_CASE: u16 = 0x245e;
const PLUS: u16 = 0x8a64;
const DEONTIC_MOOD: u16 = 0x295e;

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
}

impl SemanticError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidShape { .. } => "malformed-codelet",
            Self::NonzeroTail { .. } => "nonzero-tail",
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
    expect(words, 0, HEAD)?;
    expect(words, 1, NUMBER_QUOTE)?;
    expect(words, 3, INSTRUMENTAL_CASE)?;
    expect(words, 4, NUMBER_QUOTE)?;
    expect(words, 6, ACCUSATIVE_CASE)?;
    expect(words, 7, PLUS)?;
    expect(words, 8, DEONTIC_MOOD)?;
    for (index, actual) in words.iter().enumerate().skip(9) {
        if *actual != 0 {
            return Err(SemanticError::NonzeroTail {
                index,
                actual: *actual,
            });
        }
    }
    Ok(NumericPlusInstruction {
        ob: words[2],
        to: words[5],
    })
}

pub fn execute_numeric_plus(instruction: &NumericPlusInstruction) -> u16 {
    instruction.ob.saturating_add(instruction.to)
}

pub fn execute_numeric_plus_codelet(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<u16, SemanticError> {
    let instruction = decode_numeric_plus(words)?;
    Ok(execute_numeric_plus(&instruction))
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
}
