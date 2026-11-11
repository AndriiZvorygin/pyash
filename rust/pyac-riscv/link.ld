/* The bare-metal layout for the Pyash RISC-V image.
 *
 * The image has no operating system under it, so it needs a load address, an
 * entry point, and nothing else. The program is branchless and uses no stack,
 * so the script reserves no memory for either. */

ENTRY(_start)

SECTIONS {
  . = 0x80000000;

  .text : {
    /* The compiled program comes first, so a disassembler reads it before the
     * entry point's trailing trap. */
    *(.text.pyac_body)
    *(.text._start)
    *(.text .text.*)
  }

  .rodata : { *(.rodata .rodata.*) }
  .data : { *(.data .data.*) }
  .bss : { *(.bss .bss.*) *(COMMON) }

  /DISCARD/ : {
    *(.comment)
    *(.note.*)
    *(.eh_frame*)
    *(.riscv.attributes)
  }
}
