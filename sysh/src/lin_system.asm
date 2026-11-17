; system calls
section .rodata
    sys_exit	equ  1	; mov eax
    sys_read	equ  3  ; mov eax
    sys_write	equ  4	; mov eax
    sys_brk	equ  45 ; mov eax

    stdout	equ  1	; mov ebx
    stdin	equ  0	; mov ebx
    stderr	equ  2	; mov ebx
    success	equ  0	; mov ebx ; for returns

    kernel	equ  0x80; int kernel
    
    ;byte_base	equ  4;
holdMore: ; memoryExtend
    ; input amountToExtend 
    ; returns address
    xor ebx,ebx	;// Call brk(0)
    mov eax,sys_brk ; call  sys_brk
    int kernel
    mov edx,eax	; // Initialise HERE to point at beginning of data segment.
    movr ecx,[esp+byteBase] ; amountToExtend
    add eax,ecx    ;// Reserve nn bytes of memory for initial data segment.
    mov ebx,eax	;// Call brk(HERE+INITIAL_DATA_SEGMENT_SIZE)
    mov eax,sys_brk
    int kernel
    pop eax ; ret
    pop ebx ; clearArgs
    push edx; resultAddress
    push eax ; ret
    ret
    
    
;section .bss
;    stack	resb	1
    

;and exit

good_exit:
	mov	ebx,success	;first syscall argument: exit code
        mov     eax,sys_exit    ;system call number (sys_exit)
        int     kernel	;call kernel
;	ret ; no need to return, end anyways
