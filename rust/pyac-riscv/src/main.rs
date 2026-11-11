//! The RISC-V image for the Pyash VLIW codelet format.
//!
//! The image is bare metal: there is no operating system under it. The entry
//! point runs the compiled Pyash program and stops, leaving the result in the
//! first argument register.

#![no_std]
#![no_main]

use core::panic::PanicInfo;

/// The panic handler a bare-metal image needs.
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

// The compiled Pyash program, emitted by the build step.
core::arch::global_asm!(include_str!(concat!(env!("OUT_DIR"), "/body.S")));

/// The image entry point.
///
/// The compiled program returns its result in `a0`, so the entry point only
/// has to run it and stop.
#[unsafe(naked)]
#[unsafe(no_mangle)]
pub extern "C" fn _start() -> ! {
    core::arch::naked_asm!("jal ra, pyac_body", "ebreak",)
}
