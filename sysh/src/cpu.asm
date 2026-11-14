; TODO make macros or alias for registers r1 r2 r3 r4 (stack register) sr1 sr2
section .rodata
    bitBase	equ 32		; 32 bit operating systems 
    byteBase	equ bitBase/8	; have 4 bytes
%macro resr 2 ; reserve register
    %1 resd %2
%endmacro
%macro datr 2 ; data register size
    %1 dd %2
%endmacro
%macro datr 1 ; data register size
	dd  %1
%endmacro
%macro movr 2 ; move full register worth
    mov dword %1,%2
%endmacro
%macro cmpr 2 ; compare full register worth
    cmp dword %1,%2
%endmacro
%macro pushr 1 ; push full register worth
    push dword %1
%endmacro
%macro popr 1 ; pop full register worth
    pop dword %1
%endmacro
%macro addr  2 ; add full register worth
    add dword %1,%2
%endmacro
%macro subr  2 ; add full register worth
    sub dword %1,%2
%endmacro
