//! The RISC-V destination against the golden codelet.
//!
//! The golden codelet is the shared fixture: the interpreter runs it, the
//! compiler compiles it, and both have to agree on the result.

use pyac::{
    GOLDEN_NUMERIC_PLUS_CODELET, compile_numeric_arithmetic, execute,
    execute_numeric_arithmetic_codelet,
};

#[test]
fn the_golden_codelet_compiles_to_riscv_that_computes_the_interpreter_result() {
    let program = compile_numeric_arithmetic(&GOLDEN_NUMERIC_PLUS_CODELET)
        .expect("the golden codelet compiles");
    let compiled = execute(&program).expect("the compiled program runs");
    let interpreted = execute_numeric_arithmetic_codelet(&GOLDEN_NUMERIC_PLUS_CODELET)
        .expect("the interpreter runs the golden codelet");

    assert_eq!(compiled, interpreted);
    assert_eq!(compiled, 2);
}

#[test]
fn the_compiled_program_hands_its_result_back_in_the_first_argument_register() {
    let program = compile_numeric_arithmetic(&GOLDEN_NUMERIC_PLUS_CODELET)
        .expect("the golden codelet compiles");
    let last = program
        .instructions
        .last()
        .expect("the program is not empty");

    assert_eq!(last.text, "ret");
    assert_eq!(last.word, 0x0000_8067);
}
