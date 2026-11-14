; string stuff
section .rodata
    charByteBase	equ 1
%macro ress 2 ; reserve for string
    %1	resb %2
%endmacro
%macro dats 2 ; data for string
    %1  db %2
%endmacro
%macro dats 1 ; data for string
    db %2
%endmacro
%macro cmps 2 ; char comparison
    cmp byte %1,%2
%endmacro
%macro movs 2 ; char comparison
    mov byte %1,%2
%endmacro

section .text
stringCompare:   ; string comparison
    ; input args
    ;	string comparison-string length
    ; output args
    ;   0 for success , charCount+0x10 for fail
    ;mov ecx,[esp+byteBase*1]; string-length
    xor edx,edx ; set counter to 0
    jmp stringCompareMid
    ; stringCompareMid
    ;	compare strings
    ;	before length counter finishes
    ;	if two not same then put 1 in r1 and 
    ;	if length reached put 0 in r1 and exit 
stringCompareMid:
    ;	compare strings chars at current point
    mov eax,[esp+byteBase*3]; string
    mov ebx,[esp+byteBase*2]; compare-string
    xor ecx,ecx
    mov cl,[eax+edx] ; add counter
    xor eax,eax
    mov al,[ebx+edx]
    cmp eax,ecx
    ;	before length counter finishes
    ;	if two not same then put r4(edx) the charcount + 0x10 in r1 and 
    jnz stringCompareQualityAware
    ;	if length reached put 0 in r1 and exit 
    mov ecx,[esp+byteBase*1]; string-length
    subr ecx,1	; subtract 1 from length, counter from 0 to n-1
    cmp ecx,edx
    ; LightDesireEnd 
    ;pushr 0 ; success result (maybe success should be F0 )
    ;	 clear inargs
    ;	 output r1
    movr eax,0
    jz stringCompareEnd
    ;pop eax
    ; else increment counter
    addr edx,1
    jmp stringCompareMid
stringCompareQualityAware:
    ;	if two not same then put r4(edx) the charcount + 0x10 in r1 and 
    addr edx,0x10
    mov eax,edx
    jmp stringCompareEnd
stringCompareEnd:
    ;pop eax ; result
    pop edx ; ret
    pop ecx ; clear args
    pop ecx ;
    pop ecx ;
    ;	 output r1 or eax
    push eax
    push edx
    ret

    
