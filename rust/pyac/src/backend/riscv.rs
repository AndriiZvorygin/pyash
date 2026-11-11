//! The RISC-V destination for the Pyash VLIW codelet format.
//!
//! Compiling a codelet for RISC-V means emitting a short register program:
//! the codelet's quoted operands become immediates, its operator word becomes
//! the instruction that computes the result, and the result leaves in `a0`.
//!
//! The compiled program must agree with the interpreter, so the numeric
//! semantics are the interpreter's semantics, including the saturation to
//! `0xffff` that the JavaScript reference backend applies to addition,
//! subtraction, and exponentiation.
//!
//! The backend emits no branches. That is a deliberate limit, not an
//! oversight: a branchless program needs no label resolution, so the emitted
//! words are the whole program, and the executor below can check them
//! without a control-flow model.

use crate::WORDS_PER_CODELET;
use crate::semantic::{NumericOperator, decode_numeric_arithmetic, decode_numeric_invert};

/// The zero register.
pub const ZERO: u8 = 0;
/// The return address register.
pub const RA: u8 = 1;
/// The first temporary register.
pub const T0: u8 = 5;
/// The second temporary register.
pub const T1: u8 = 6;
/// The third temporary register.
pub const T2: u8 = 7;
/// The fourth temporary register.
pub const T3: u8 = 28;
/// The fifth temporary register.
pub const T4: u8 = 29;
/// The sixth temporary register.
pub const T5: u8 = 30;
/// The seventh temporary register.
pub const T6: u8 = 31;
/// The first argument register, where the result leaves.
pub const A0: u8 = 10;
/// The first saved register available as scratch space.
pub const S2: u8 = 18;
/// The second saved register available as scratch space.
pub const S3: u8 = 19;
/// The third saved register available as scratch space.
pub const S4: u8 = 20;
/// The fourth saved register available as scratch space.
pub const S5: u8 = 21;

/// The largest value the interpreter's numeric semantics produce.
pub const NUMERIC_MAX: u64 = 0xffff;

const OPCODE_OP: u32 = 0x33;
const OPCODE_OP_IMM: u32 = 0x13;
const OPCODE_LUI: u32 = 0x37;
const OPCODE_JALR: u32 = 0x67;
const OPCODE_SYSTEM: u32 = 0x73;

/// One emitted machine instruction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instruction {
    /// The 32-bit encoding.
    pub word: u32,
    /// The assembly the encoding stands for, for listings and reviews.
    pub text: String,
}

/// A compiled RISC-V program.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RiscvProgram {
    pub instructions: Vec<Instruction>,
}

impl RiscvProgram {
    /// The machine words of the program, in order.
    pub fn words(&self) -> Vec<u32> {
        self.instructions
            .iter()
            .map(|instruction| instruction.word)
            .collect()
    }

    /// The program as an assembly listing, for a build step that places it in
    /// an executable image.
    pub fn to_assembly(&self, symbol: &str) -> String {
        let mut listing = String::new();
        listing.push_str(".section .text.pyac_body, \"ax\", @progbits\n");
        listing.push_str(&format!(".global {symbol}\n"));
        listing.push_str(&format!(".type {symbol}, @function\n"));
        listing.push_str(".balign 4\n");
        // The compressed forms are off, so every instruction in the image is
        // the four-byte encoding the compiler produced.
        listing.push_str(".option norvc\n");
        listing.push_str(&format!("{symbol}:\n"));
        for instruction in &self.instructions {
            listing.push_str(&format!("    {}\n", instruction.text));
        }
        listing.push_str(&format!(".size {symbol}, .-{symbol}\n"));
        listing
    }
}

/// The errors the backend reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendError {
    /// The codelet is not a shape this destination compiles.
    Malformed { cause: String },
    /// The operator word has no proven machine code.
    UnsupportedOperator { actual: u16 },
    /// The operator cannot run with this operand.
    DivisionByZero,
    /// The immediate does not fit the load-immediate sequence.
    ImmediateOutOfRange { value: u64 },
    /// The program contains an instruction the executor does not model.
    UnknownInstruction { word: u32 },
    /// The program ran past its last instruction.
    ProgramUnderrun,
}

impl BackendError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Malformed { .. } => "malformed-codelet",
            Self::UnsupportedOperator { .. } => "unsupported-operator",
            Self::DivisionByZero => "division-by-zero",
            Self::ImmediateOutOfRange { .. } => "immediate-out-of-range",
            Self::UnknownInstruction { .. } => "unknown-instruction",
            Self::ProgramUnderrun => "program-underrun",
        }
    }
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed { cause } => write!(formatter, "the codelet is malformed: {cause}"),
            Self::UnsupportedOperator { actual } => {
                write!(
                    formatter,
                    "operator word 0x{actual:04x} has no RISC-V lowering"
                )
            }
            Self::DivisionByZero => formatter.write_str("numeric division cannot divide by zero"),
            Self::ImmediateOutOfRange { value } => {
                write!(
                    formatter,
                    "immediate {value} does not fit the load-immediate sequence"
                )
            }
            Self::UnknownInstruction { word } => {
                write!(formatter, "instruction 0x{word:08x} is not modelled")
            }
            Self::ProgramUnderrun => {
                formatter.write_str("the program ran past its last instruction")
            }
        }
    }
}

impl std::error::Error for BackendError {}

fn malformed(cause: impl Into<String>) -> BackendError {
    BackendError::Malformed {
        cause: cause.into(),
    }
}

fn r_type(funct7: u32, funct3: u32, rs1: u8, rs2: u8, rd: u8, opcode: u32) -> u32 {
    ((funct7 & 0x7f) << 25)
        | ((rs2 as u32 & 0x1f) << 20)
        | ((rs1 as u32 & 0x1f) << 15)
        | ((funct3 & 0x7) << 12)
        | ((rd as u32 & 0x1f) << 7)
        | (opcode & 0x7f)
}

fn i_type(imm: i32, rs1: u8, funct3: u32, rd: u8, opcode: u32) -> u32 {
    (((imm as u32) & 0xfff) << 20)
        | ((rs1 as u32 & 0x1f) << 15)
        | ((funct3 & 0x7) << 12)
        | ((rd as u32 & 0x1f) << 7)
        | (opcode & 0x7f)
}

fn u_type(imm: u32, rd: u8, opcode: u32) -> u32 {
    ((imm & 0xfffff) << 12) | ((rd as u32 & 0x1f) << 7) | (opcode & 0x7f)
}

/// `addi rd, rs1, imm`
pub fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, OPCODE_OP_IMM)
}

/// `sltiu rd, rs1, imm`
pub fn sltiu(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b011, rd, OPCODE_OP_IMM)
}

/// `slli rd, rs1, imm`
pub fn slli(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b001, rd, OPCODE_OP_IMM)
}

/// `srli rd, rs1, imm`
pub fn srli(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b101, rd, OPCODE_OP_IMM)
}

/// `xori rd, rs1, imm`
pub fn xori(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b100, rd, OPCODE_OP_IMM)
}

/// `andi rd, rs1, imm`
pub fn andi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b111, rd, OPCODE_OP_IMM)
}

/// `add rd, rs1, rs2`
pub fn add(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x00, 0b000, rs1, rs2, rd, OPCODE_OP)
}

/// `sub rd, rs1, rs2`
pub fn sub(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x20, 0b000, rs1, rs2, rd, OPCODE_OP)
}

/// `slt rd, rs1, rs2`
pub fn slt(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x00, 0b010, rs1, rs2, rd, OPCODE_OP)
}

/// `sltu rd, rs1, rs2`
pub fn sltu(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x00, 0b011, rs1, rs2, rd, OPCODE_OP)
}

/// `xor rd, rs1, rs2`
pub fn xor(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x00, 0b100, rs1, rs2, rd, OPCODE_OP)
}

/// `srl rd, rs1, rs2`
pub fn srl(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x00, 0b101, rs1, rs2, rd, OPCODE_OP)
}

/// `or rd, rs1, rs2`
pub fn or(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x00, 0b110, rs1, rs2, rd, OPCODE_OP)
}

/// `and rd, rs1, rs2`
pub fn and(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x00, 0b111, rs1, rs2, rd, OPCODE_OP)
}

/// `mul rd, rs1, rs2`
pub fn mul(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x01, 0b000, rs1, rs2, rd, OPCODE_OP)
}

/// `divu rd, rs1, rs2`
pub fn divu(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x01, 0b101, rs1, rs2, rd, OPCODE_OP)
}

/// `remu rd, rs1, rs2`
pub fn remu(rd: u8, rs1: u8, rs2: u8) -> u32 {
    r_type(0x01, 0b111, rs1, rs2, rd, OPCODE_OP)
}

/// `lui rd, imm20`
pub fn lui(rd: u8, imm: u32) -> u32 {
    u_type(imm, rd, OPCODE_LUI)
}

/// `jalr rd, rs1, imm`
pub fn jalr(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, OPCODE_JALR)
}

/// `ebreak`
pub fn ebreak() -> u32 {
    i_type(1, 0, 0b000, 0, OPCODE_SYSTEM)
}

/// The `ret` encoding, `jalr x0, ra, 0`.
pub fn ret() -> u32 {
    jalr(ZERO, RA, 0)
}

/// The register names the listings use.
fn register_name(register: u8) -> &'static str {
    match register {
        0 => "zero",
        1 => "ra",
        2 => "sp",
        5 => "t0",
        6 => "t1",
        7 => "t2",
        8 => "s0",
        9 => "s1",
        10 => "a0",
        11 => "a1",
        12 => "a2",
        13 => "a3",
        14 => "a4",
        15 => "a5",
        16 => "a6",
        17 => "a7",
        18 => "s2",
        19 => "s3",
        20 => "s4",
        21 => "s5",
        22 => "s6",
        23 => "s7",
        24 => "s8",
        25 => "s9",
        26 => "s10",
        27 => "s11",
        28 => "t3",
        29 => "t4",
        30 => "t5",
        31 => "t6",
        _ => "unknown",
    }
}

/// The builder that accumulates a program.
///
/// The register allocation is fixed. `t0` and `t1` hold the operands, `t2`
/// holds the result, `t3` holds the running factor of a power, and `t4` to
/// `t6` are the scratch space the saturation sequences use. `a0` receives the
/// result, and `s2` to `s5` are the scratch space the power sequence uses.
struct Emitter {
    instructions: Vec<Instruction>,
}

impl Emitter {
    fn new() -> Self {
        Self {
            instructions: Vec::new(),
        }
    }

    fn push(&mut self, word: u32, text: String) {
        self.instructions.push(Instruction { word, text });
    }

    fn emit(&mut self, word: u32, text: impl Into<String>) {
        self.push(word, text.into());
    }

    /// `mv rd, rs`
    fn move_register(&mut self, rd: u8, rs: u8) {
        self.emit(
            addi(rd, rs, 0),
            format!("addi {}, {}, 0", register_name(rd), register_name(rs)),
        );
    }

    /// `neg rd, rs`
    fn negate(&mut self, rd: u8, rs: u8) {
        self.emit(
            sub(rd, ZERO, rs),
            format!("sub {}, zero, {}", register_name(rd), register_name(rs)),
        );
    }

    /// `not rd, rs`
    fn bitwise_not(&mut self, rd: u8, rs: u8) {
        self.emit(
            xori(rd, rs, -1),
            format!("xori {}, {}, -1", register_name(rd), register_name(rs)),
        );
    }

    /// `li rd, value`, using the two-instruction sequence when the value does
    /// not fit a signed 12-bit immediate.
    fn load_immediate(&mut self, rd: u8, value: u64) -> Result<(), BackendError> {
        if value > 0x7fff_efff {
            return Err(BackendError::ImmediateOutOfRange { value });
        }
        let low = ((value & 0xfff) as i64) << 52 >> 52;
        let high = ((value as i64).wrapping_sub(low) >> 12) & 0xfffff;
        if high == 0 && low >= -2048 && low <= 2047 {
            self.emit(
                addi(rd, ZERO, low as i32),
                format!("addi {}, zero, {}", register_name(rd), low),
            );
            return Ok(());
        }
        self.emit(
            lui(rd, high as u32),
            format!("lui {}, 0x{:x}", register_name(rd), high),
        );
        if low != 0 {
            self.emit(
                addi(rd, rd, low as i32),
                format!("addi {}, {}, {}", register_name(rd), register_name(rd), low),
            );
        }
        Ok(())
    }

    /// The numeric limit, `0xffff`, which needs the two-instruction sequence.
    fn load_numeric_max(&mut self, rd: u8) {
        self.emit(lui(rd, 0x10), format!("lui {}, 0x10", register_name(rd)));
        self.emit(
            addi(rd, rd, -1),
            format!("addi {}, {}, -1", register_name(rd), register_name(rd)),
        );
    }

    /// The saturating product of two 16-bit values, which is the saturation
    /// the interpreter applies to addition, subtraction, and exponentiation.
    ///
    /// The product of two values below `0xffff` fits in 32 bits, so the high
    /// half of the product says whether the result crossed the limit.
    fn saturating_multiply(&mut self, rd: u8, left: u8, right: u8) {
        self.emit(
            mul(T4, left, right),
            format!(
                "mul {}, {}, {}",
                register_name(T4),
                register_name(left),
                register_name(right)
            ),
        );
        self.emit(
            srli(T5, T4, 16),
            format!("srli {}, {}, 16", register_name(T5), register_name(T4)),
        );
        self.emit(
            sltu(T5, ZERO, T5),
            format!("sltu {}, zero, {}", register_name(T5), register_name(T5)),
        );
        self.negate(T5, T5);
        self.bitwise_not(T6, T5);
        self.emit(
            and(T4, T4, T6),
            format!(
                "and {}, {}, {}",
                register_name(T4),
                register_name(T4),
                register_name(T6)
            ),
        );
        self.load_numeric_max(T6);
        self.emit(
            and(T6, T6, T5),
            format!(
                "and {}, {}, {}",
                register_name(T6),
                register_name(T6),
                register_name(T5)
            ),
        );
        self.emit(
            or(T4, T4, T6),
            format!(
                "or {}, {}, {}",
                register_name(T4),
                register_name(T4),
                register_name(T6)
            ),
        );
        self.move_register(rd, T4);
    }

    /// The saturating sum of two 16-bit values.
    fn saturating_add(&mut self, rd: u8, left: u8, right: u8) {
        self.emit(
            add(rd, left, right),
            format!(
                "add {}, {}, {}",
                register_name(rd),
                register_name(left),
                register_name(right)
            ),
        );
        self.load_numeric_max(T4);
        self.emit(
            sltu(T5, T4, rd),
            format!(
                "sltu {}, {}, {}",
                register_name(T5),
                register_name(T4),
                register_name(rd)
            ),
        );
        self.negate(T5, T5);
        self.bitwise_not(T6, T5);
        self.emit(
            and(rd, rd, T6),
            format!(
                "and {}, {}, {}",
                register_name(rd),
                register_name(rd),
                register_name(T6)
            ),
        );
        self.emit(
            and(T4, T4, T5),
            format!(
                "and {}, {}, {}",
                register_name(T4),
                register_name(T4),
                register_name(T5)
            ),
        );
        self.emit(
            or(rd, rd, T4),
            format!(
                "or {}, {}, {}",
                register_name(rd),
                register_name(rd),
                register_name(T4)
            ),
        );
    }

    /// The saturating difference of two 16-bit values, which stops at zero.
    fn saturating_subtract(&mut self, rd: u8, left: u8, right: u8) {
        self.emit(
            sub(rd, left, right),
            format!(
                "sub {}, {}, {}",
                register_name(rd),
                register_name(left),
                register_name(right)
            ),
        );
        self.emit(
            slt(T4, rd, ZERO),
            format!("slt {}, {}, zero", register_name(T4), register_name(rd)),
        );
        self.negate(T4, T4);
        self.bitwise_not(T5, T4);
        self.emit(
            and(rd, rd, T5),
            format!(
                "and {}, {}, {}",
                register_name(rd),
                register_name(rd),
                register_name(T5)
            ),
        );
    }

    /// The saturating power of two 16-bit values.
    ///
    /// The exponent is at most `0xffff`, so sixteen rounds of binary
    /// exponentiation cover it. Every round is branchless: the exponent bit
    /// selects the factor with a mask, and each product saturates.
    fn saturating_power(&mut self, rd: u8, base: u8, exponent: u8) {
        self.load_immediate(rd, 1)
            .expect("one fits a load-immediate sequence");
        self.move_register(T3, base);
        for _ in 0..16 {
            // The factor enters the product only when the exponent bit is set,
            // and a clear bit multiplies by one instead of by zero.
            self.emit(
                andi(S3, exponent, 1),
                format!("andi {}, {}, 1", register_name(S3), register_name(exponent)),
            );
            self.negate(S3, S3);
            self.emit(
                and(S2, T3, S3),
                format!(
                    "and {}, {}, {}",
                    register_name(S2),
                    register_name(T3),
                    register_name(S3)
                ),
            );
            self.bitwise_not(S4, S3);
            self.emit(
                andi(S5, S4, 1),
                format!("andi {}, {}, 1", register_name(S5), register_name(S4)),
            );
            self.emit(
                or(S2, S2, S5),
                format!(
                    "or {}, {}, {}",
                    register_name(S2),
                    register_name(S2),
                    register_name(S5)
                ),
            );
            self.emit(
                srli(exponent, exponent, 1),
                format!(
                    "srli {}, {}, 1",
                    register_name(exponent),
                    register_name(exponent)
                ),
            );
            self.saturating_multiply(rd, rd, S2);
            self.saturating_multiply(T3, T3, T3);
        }
    }
}

/// Compile a numeric arithmetic codelet into a RISC-V program.
pub fn compile_numeric_arithmetic(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<RiscvProgram, BackendError> {
    let instruction =
        decode_numeric_arithmetic(words).map_err(|error| malformed(error.to_string()))?;
    let mut emitter = Emitter::new();

    emitter.load_immediate(T0, u64::from(instruction.ob))?;
    emitter.load_immediate(T1, u64::from(instruction.to))?;

    match instruction.operator {
        NumericOperator::Plus => emitter.saturating_add(T2, T0, T1),
        NumericOperator::Subtract => emitter.saturating_subtract(T2, T0, T1),
        NumericOperator::Multiply => emitter.emit(
            mul(T2, T0, T1),
            format!(
                "mul {}, {}, {}",
                register_name(T2),
                register_name(T0),
                register_name(T1)
            ),
        ),
        NumericOperator::Divide => {
            if instruction.to == 0 {
                return Err(BackendError::DivisionByZero);
            }
            emitter.emit(
                divu(T2, T0, T1),
                format!(
                    "divu {}, {}, {}",
                    register_name(T2),
                    register_name(T0),
                    register_name(T1)
                ),
            );
        }
        NumericOperator::Xor => emitter.emit(
            xor(T2, T0, T1),
            format!(
                "xor {}, {}, {}",
                register_name(T2),
                register_name(T0),
                register_name(T1)
            ),
        ),
        NumericOperator::Exponential => emitter.saturating_power(T2, T0, T1),
        NumericOperator::Remains => {
            if instruction.to == 0 {
                return Err(BackendError::DivisionByZero);
            }
            emitter.emit(
                remu(T2, T0, T1),
                format!(
                    "remu {}, {}, {}",
                    register_name(T2),
                    register_name(T0),
                    register_name(T1)
                ),
            );
        }
    }

    emitter.move_register(A0, T2);
    emitter.emit(ret(), "ret");
    Ok(RiscvProgram {
        instructions: emitter.instructions,
    })
}

/// Compile an invert codelet into a RISC-V program.
///
/// Pyash inverts a number by negating it, so the result is negative.
pub fn compile_numeric_invert(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<RiscvProgram, BackendError> {
    let instruction = decode_numeric_invert(words).map_err(|error| malformed(error.to_string()))?;
    let mut emitter = Emitter::new();

    emitter.load_immediate(T0, u64::from(instruction.ob))?;
    emitter.negate(T2, T0);
    emitter.move_register(A0, T2);
    emitter.emit(ret(), "ret");
    Ok(RiscvProgram {
        instructions: emitter.instructions,
    })
}

/// Run a compiled program and return the result it leaves in `a0`.
///
/// The executor models the instruction subset the backend emits. A `ret` ends
/// the program, which is how the compiled body hands its result back.
pub fn execute(program: &RiscvProgram) -> Result<u64, BackendError> {
    let mut registers = [0u64; 32];
    let mut pc = 0usize;

    loop {
        let word = program
            .instructions
            .get(pc)
            .ok_or(BackendError::ProgramUnderrun)?
            .word;
        let opcode = word & 0x7f;
        let rd = ((word >> 7) & 0x1f) as usize;
        let funct3 = (word >> 12) & 0x7;
        let rs1 = ((word >> 15) & 0x1f) as usize;
        let rs2 = ((word >> 20) & 0x1f) as usize;
        let funct7 = (word >> 25) & 0x7f;
        let immediate = ((word as i32) >> 20) as i64;

        match opcode {
            OPCODE_LUI => {
                registers[rd] = (word & 0xffff_f000) as u32 as i32 as i64 as u64;
                pc += 1;
            }
            OPCODE_OP_IMM => {
                let value = match funct3 {
                    0b000 => registers[rs1].wrapping_add(immediate as u64),
                    0b001 => registers[rs1] << (immediate as u64 & 0x3f),
                    0b010 => u64::from((registers[rs1] as i64) < immediate),
                    0b011 => u64::from(registers[rs1] < immediate as u64),
                    0b101 => registers[rs1] >> (immediate as u64 & 0x3f),
                    0b100 => registers[rs1] ^ (immediate as u64),
                    0b110 => registers[rs1] | (immediate as u64),
                    0b111 => registers[rs1] & (immediate as u64),
                    _ => return Err(BackendError::UnknownInstruction { word }),
                };
                registers[rd] = value;
                pc += 1;
            }
            OPCODE_OP => {
                let value = match (funct7, funct3) {
                    (0x00, 0b000) => registers[rs1].wrapping_add(registers[rs2]),
                    (0x00, 0b001) => registers[rs1] << (registers[rs2] & 0x3f),
                    (0x00, 0b010) => u64::from((registers[rs1] as i64) < (registers[rs2] as i64)),
                    (0x00, 0b011) => u64::from(registers[rs1] < registers[rs2]),
                    (0x00, 0b100) => registers[rs1] ^ registers[rs2],
                    (0x00, 0b101) => registers[rs1] >> (registers[rs2] & 0x3f),
                    (0x00, 0b110) => registers[rs1] | registers[rs2],
                    (0x00, 0b111) => registers[rs1] & registers[rs2],
                    (0x20, 0b000) => registers[rs1].wrapping_sub(registers[rs2]),
                    (0x01, 0b000) => registers[rs1].wrapping_mul(registers[rs2]),
                    (0x01, 0b101) => {
                        if registers[rs2] == 0 {
                            u64::MAX
                        } else {
                            registers[rs1] / registers[rs2]
                        }
                    }
                    (0x01, 0b111) => {
                        if registers[rs2] == 0 {
                            registers[rs1]
                        } else {
                            registers[rs1] % registers[rs2]
                        }
                    }
                    _ => return Err(BackendError::UnknownInstruction { word }),
                };
                registers[rd] = value;
                pc += 1;
            }
            OPCODE_JALR => {
                if rd == ZERO as usize && immediate == 0 {
                    return Ok(registers[A0 as usize]);
                }
                return Err(BackendError::UnknownInstruction { word });
            }
            OPCODE_SYSTEM => {
                if word == ebreak() {
                    return Ok(registers[A0 as usize]);
                }
                return Err(BackendError::UnknownInstruction { word });
            }
            _ => return Err(BackendError::UnknownInstruction { word }),
        }
    }
}

/// Compile and run a numeric arithmetic codelet, and return its result.
pub fn compile_and_execute_numeric_arithmetic(
    words: &[u16; WORDS_PER_CODELET],
) -> Result<u64, BackendError> {
    let program = compile_numeric_arithmetic(words)?;
    execute(&program)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::{
        NumericArithmeticInstruction, execute_numeric_arithmetic,
        execute_numeric_arithmetic_codelet, execute_numeric_invert_codelet,
    };

    const HEAD: u16 = 0x0149;
    const NUMBER_QUOTE: u16 = 0x881d;
    const INSTRUMENTAL_CASE: u16 = 0x287e;
    const ACCUSATIVE_CASE: u16 = 0x245e;
    const DATIVE_CASE: u16 = 0x207e;
    const DEONTIC_MOOD: u16 = 0x295e;

    fn arithmetic_codelet(operator: u16, ob: u16, to: u16) -> [u16; WORDS_PER_CODELET] {
        [
            HEAD,
            NUMBER_QUOTE,
            ob,
            INSTRUMENTAL_CASE,
            NUMBER_QUOTE,
            to,
            ACCUSATIVE_CASE,
            operator,
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

    fn invert_codelet(ob: u16, bound: u16) -> [u16; WORDS_PER_CODELET] {
        [
            HEAD,
            NUMBER_QUOTE,
            ob,
            ACCUSATIVE_CASE,
            NUMBER_QUOTE,
            bound,
            DATIVE_CASE,
            0xaad2,
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

    /// The encodings the instruction set fixes, computed from the field layout
    /// of each instruction format. They are the independent check on the
    /// compiler's own encoder: the table comes from the specification, not from
    /// the encoder that produces the words.
    const GOLDEN_INSTRUCTIONS: [(&str, u32); 13] = [
        ("addi t0, zero, 1", 0x0010_0293),
        ("addi t1, zero, 1", 0x0010_0313),
        ("add t2, t0, t1", 0x0062_83b3),
        ("lui t4, 0x10", 0x0001_0eb7),
        ("addi t4, t4, -1", 0xfffe_8e93),
        ("sltu t5, t4, t2", 0x007e_bf33),
        ("sub t5, zero, t5", 0x41e0_0f33),
        ("xori t6, t5, -1", 0xffff_4f93),
        ("and t2, t2, t6", 0x01f3_f3b3),
        ("and t4, t4, t5", 0x01ee_feb3),
        ("or t2, t2, t4", 0x01d3_e3b3),
        ("addi a0, t2, 0", 0x0003_8513),
        ("ret", 0x0000_8067),
    ];

    #[test]
    fn encodes_the_golden_program_with_the_instruction_set_field_layout() {
        let codelet = arithmetic_codelet(0x8a64, 1, 1);
        let program = compile_numeric_arithmetic(&codelet).expect("the golden codelet compiles");
        let pairs: Vec<(&str, u32)> = program
            .instructions
            .iter()
            .map(|instruction| (instruction.text.as_str(), instruction.word))
            .collect();

        assert_eq!(pairs, GOLDEN_INSTRUCTIONS.to_vec());
    }

    #[test]
    fn compiles_the_golden_numeric_plus_into_a_register_program() {
        let codelet = arithmetic_codelet(0x8a64, 1, 1);
        let program = compile_numeric_arithmetic(&codelet).expect("the golden codelet compiles");

        let listing = program
            .instructions
            .iter()
            .map(|instruction| instruction.text.as_str())
            .collect::<Vec<_>>()
            .join("; ");
        assert_eq!(
            listing,
            "addi t0, zero, 1; addi t1, zero, 1; add t2, t0, t1; lui t4, 0x10; \
             addi t4, t4, -1; sltu t5, t4, t2; sub t5, zero, t5; xori t6, t5, -1; \
             and t2, t2, t6; and t4, t4, t5; or t2, t2, t4; addi a0, t2, 0; ret"
        );
        assert_eq!(execute(&program), Ok(2));
    }

    #[test]
    fn agrees_with_the_interpreter_for_every_proven_numeric_operator() {
        let cases = [
            (0x8a64, 1, 1),
            (0xabd2, 9, 4),
            (0xec90, 3, 4),
            (0x8893, 8, 2),
            (0xa810, 7, 3),
            (0x8c29, 2, 10),
            (0xe82a, 9, 4),
        ];
        for (operator, ob, to) in cases {
            let codelet = arithmetic_codelet(operator, ob, to);
            let expected =
                execute_numeric_arithmetic_codelet(&codelet).expect("the interpreter runs it");
            let compiled =
                compile_and_execute_numeric_arithmetic(&codelet).expect("the backend runs it");
            assert_eq!(compiled, expected, "operator 0x{operator:04x} disagrees");
        }
    }

    #[test]
    fn saturates_like_the_interpreter_at_the_numeric_limit() {
        let saturated = arithmetic_codelet(0x8a64, u16::MAX, 1);
        assert_eq!(
            compile_and_execute_numeric_arithmetic(&saturated),
            Ok(u64::from(u16::MAX))
        );

        let floored = arithmetic_codelet(0xabd2, 2, 9);
        assert_eq!(compile_and_execute_numeric_arithmetic(&floored), Ok(0));

        let power = arithmetic_codelet(0x8c29, 2, 20);
        assert_eq!(
            compile_and_execute_numeric_arithmetic(&power),
            Ok(u64::from(u16::MAX))
        );

        let exact_power = arithmetic_codelet(0x8c29, 3, 3);
        assert_eq!(compile_and_execute_numeric_arithmetic(&exact_power), Ok(27));
    }

    #[test]
    fn multiplies_without_the_saturation_the_other_operators_use() {
        let codelet = arithmetic_codelet(0xec90, u16::MAX, u16::MAX);
        assert_eq!(
            compile_and_execute_numeric_arithmetic(&codelet),
            Ok(4_294_836_225)
        );
    }

    #[test]
    fn refuses_the_operators_the_interpreter_also_refuses() {
        let divide_by_zero = arithmetic_codelet(0x8893, 8, 0);
        assert_eq!(
            compile_numeric_arithmetic(&divide_by_zero).expect_err("division by zero"),
            BackendError::DivisionByZero
        );

        let remainder_by_zero = arithmetic_codelet(0xe82a, 9, 0);
        assert_eq!(
            compile_numeric_arithmetic(&remainder_by_zero).expect_err("remainder by zero"),
            BackendError::DivisionByZero
        );
    }

    #[test]
    fn compiles_the_legacy_invert_shape() {
        let codelet = invert_codelet(5, 0);
        let program = compile_numeric_invert(&codelet).expect("the invert codelet compiles");
        let result = execute(&program).expect("the program runs");
        assert_eq!(result as i64, -5);
        assert_eq!(execute_numeric_invert_codelet(&codelet), Ok(-5));
    }

    #[test]
    fn keeps_the_semantic_decoding_shared_with_the_interpreter() {
        let codelet = arithmetic_codelet(0x8a64, 7, 3);
        let instruction = decode_numeric_arithmetic(&codelet).expect("the codelet decodes");
        assert_eq!(
            instruction,
            NumericArithmeticInstruction {
                operator: NumericOperator::Plus,
                ob: 7,
                to: 3,
            }
        );
        assert_eq!(execute_numeric_arithmetic(&instruction), Ok(10));
        assert_eq!(
            compile_and_execute_numeric_arithmetic(&codelet).expect("the backend runs it"),
            execute_numeric_arithmetic(&instruction).expect("the interpreter runs it")
        );
    }
}
