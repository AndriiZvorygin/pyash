
section .text
errSay:  ; register write, or regular write
        mov     ebx,stderr	;first argument: file handle (stdout)
        mov     eax,sys_write   ;system call number (sys_write)
        int     kernel	    ;call kernel
	ret
say:  ; register write, or regular write
        mov     ebx,stdout	;first argument: file handle (stdout)
        mov     eax,sys_write   ;system call number (sys_write)
        int     kernel	    ;call kernel
	ret
hear:  ; register read, or regular read
        mov     ebx,stdin	;first argument: file handle (stdin)
        mov     eax,sys_read   ;system call number (sys_read)
        int     kernel	    ;call kernel
	ret
areaSay:
	; input message, length
	;pop	eax
	;mov     [stack],eax
	mov	edx,[esp+byteBase*2] ; length
	mov	ecx,[esp+byteBase]	; message
	call say
	pop eax ; ret address
	pop ebx ; clear args
	pop ebx ;
	push eax ; put back ret address
	ret
stopAreaSay: ; say area ended by 0
    ; count till 0
    ; call areaSay
errAreaSay:
	; input message, length
	;pop	eax
	;mov     [stack],eax
	mov	edx,[esp+byteBase*2] ; length
	mov	ecx,[esp+byteBase]	; message
	call errSay
	pop eax ; ret address
	pop ebx ; clear args
	pop ebx ;
	push eax ; put back ret address
	ret
; get a byte from stdin
byteHear:
    mov    edx,charByteBase	    ; input length (one byte)
    mov    ecx,[esp+byteBase]	; address to pass to
    call hear
    ret

; put a byte to stdout
byteSay: ; input char
    mov    edx,charByteBase           ; length of output (in bytes)
    mov    ecx,[esp+byteBase]    ; pointer to the value being passed
    call say
    pop eax ; ret address
    pop ebx ; clear msg
    push eax ; restore ret address
    ret
dwordSay:
    mov    edx,4           ; length of output (in bytes)
    mov    ecx,[esp+byteBase]    ; pointer to the value being passed
    call say
    pop eax ; ret address
    pop ebx ; clear msg
    push eax ; restore ret address
    ret

copyMove: ; Cmove or copy 
    ; input args  length destination source
    pop eax ; return address
    mov edx,esi ; preserve esi ? why? jonesforth related
    mov ebx,edi
    pop ecx  ; length
    pop edi  ; destination
    pop esi  ; source
    cmp ecx,0 ; if length 0, just return
    jz copyMoveEnd
    ; else 
    rep movsb  ; copy source to destination
    jmp copyMoveEnd
copyMoveEnd:
    mov esi,edx
    mov edi,ebx
    push eax ; push return address
    ret
    
; get line
;   get byte into buffer till space or end of line token
;   return buffer on top of stack
section .bss
    ress byteArea,1 ; place to store byte
section .text
lineHear:  ; accepts one arg, of where to 
    ;initalize variables
    xor ecx,ecx
    mov [byteNumber],ecx
    mov [byteArea],ecx
    jmp lineHearMid
lineHearMid:
    ; get byte into buffer
    push byteArea
    call byteHear
    test eax,eax
    jle lineHearEnd
    ; compare to end of line token
    pop edx
    ; move matter value of edx into ah
    xor eax,eax
    mov al,[edx] ; TODO make compatible with cpu.asm
    movr ecx,lineEnd
    cmp eax,ecx	; eax lineEnd subtract
    jz lineHearEnd	; jump if zero;  push line onto stack and return as end of line
    ; else add to buffer
    ;mov ebx,lineArea	    ; set ebx to buffer
    mov edx,[byteNumber]
    mov ebx,[esp+byteBase] ; location to return line
	; TODO cpu.asm compatibility
	;   mul byteBase awareNumber into edx
    add ebx,edx   ; increment ebx to current byte of entry
    mov [ebx],al	    ; put the byte into the lineArea
    ; increment byteNumber
    ;mov eax,[byteNumber]
    addr edx,1;
    mov [byteNumber],edx
    ; mov edx,[byteNumber]
    ;pushr [byteNumber]
    ;call numCheck
    ; recurse
    jmp lineHearMid
numCheck:
    ; add 30 to make ascii
    ; call print byte
    mov eax,[esp+byteBase]
    addr eax,30
    push eax
    call dwordSay
    pop eax ; return
    pop ebx ; clear arg
    push eax ; 
    ret
    
lineHearEnd: ; read line exit
    ; set return line
    ;mov eax,[esp+byteBase] ; location to return line
    ;push lineArea	; source
    ;push eax		; destination
    ;pushr [byteNumber]	; length
    ;call copyMove
    pop  eax ; return address
    pushr [byteNumber]	; return length
    mov  ecx,[byteNumber] ; debugging
    push eax ; ret value
    ; set byteNumber to 0
    ret ; return

readLine:
    jmp lineHear

    ; put line
    ;   print till space or end of line token
lineSay: ; maybe lineless at the moment..
    ; args: stringAddress
    ; 

