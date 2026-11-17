
readWord:
    ; input
    ;	arg1 length of area or line
    ;	arg2 address of lineStart or areaNone
    ; algorithm:
    ;	search till pointEnd or space
    ; output 
    ;	arg1 length of word or point
    ;	arg2 address of wordStart or pointNone
    mov eax,[esp+byteBase] ; length
    mov ebx,[esp+byteBase*2] ; message address
    movr ecx,0	; byteNumber
    jmp readWordMid
readWordMid:
    ; search till pointEnd or space
    xor edx,edx
    mov dl,[ebx] 
    ;movr ecx,pointEnd
    cmpr edx,pointEnd	; eax lineEnd subtract
    ;cmp byte [ebx],pointEnd ; compare current char to wordEnd
    jz readWordEnd ; if yes then exit
    ; else 
    ;	if byteNumber equal length exit
    cmp eax,ecx
    jz	readWordEnd
    ;	else 
    ;	increment charNumber counter
    add ecx,1 
    ;   increment awarePointLight (curentCharAddress)
    add ebx,charByteBase
    ;	recurse
    jmp readWordMid
readWordEnd:
    ; output 
    ;	arg1 length of word or point
    ;	arg2 address of wordStart or pointNone
    pop eax ; ret address
    pop ebx ; line length
    push ecx ; word length
    push eax ; return ret address
    ret
countTill: 
    ; args char stringAddress
    ; counts till finds char starting from stringAddress
    ; default char 0
    movr eax,[esp+byteBase*1]
    movr ebx,[esp+byteBase*2]
    movr ecx,0 ; start counter
    jmp countTillMid
countTillMid:
    ; check if current matches char
    ;	then return counter
    ;	else increment counter and recurse
    movr edx,[ebx]
    cmp al,dl
    jz countTillEnd
    addr ecx,1
    addr ebx,1 ; increment stringAddress
    jmp countTillMid
countTillEnd:
    ; ecx has result
    pop edx; ret addres
    pop ebx; clear args
    pop ebx;
    push ecx ; result
    push edx; ret
    ret
countTillNot:; count till not arg
    ; arg char stringAddress
    movr eax,[esp+byteBase*1]
    movr ebx,[esp+byteBase*2]
    movr ecx,0 ; start counter
    jmp countTillNotMid
countTillNotMid:
    ; check if current not matches char
    ;	then return counter
    ;	else increment counter and recurse
    movr edx,[ebx]
    cmp al,dl ; currentMatchChar?
    jnz countTillEnd ; if not 
    addr ecx,1
    addr ebx,1 ; increment stringAddress
    jmp countTillNotMid
