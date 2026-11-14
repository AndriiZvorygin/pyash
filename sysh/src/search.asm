section .text
findAddress: 
    jmp codeGet
    ;	data
section .bss
    ;	    indexPointer (points to top of index) (called latest in forth)
    resr currentEntry,1
section .text
codeGet:	; desire address; link desire
    ; input
    ;	wordLen
    ;   word
    ;	 list
    ; output
    ;	code-address
    ; algorithm
    ;	data
    ;	    currentEntry
    ;	    indexPointer (points to top of index) (called latest in forth)
    ;	    entry   previousWordLink,flags,nameLen,name,codeAddress,infoAddress
    ;	copy latest to currentEntry
    ;	check nameLen matches
    ;	check nameMatches
    ;	    then return codeAddress
    ;	    else nextEntry
    ;		    move previousWordLink into currentEntry
    ;	return address
    movr eax,[esp+byteBase*3];  ; list address
    ;movr ecx,[eax+listLatestPlace];	copy latest to currentEntry
    push eax
    call getLatestAddress
    pop ecx
    ;movr ecx,[ecx]; getting link to data_
    movr [currentEntry],ecx
    jmp codeGetMid
codeGetMid:
    ;	check nameLen matches
    mov ecx,[currentEntry] ;+byteBase*1] ; entry skip flags
    ;mov ecx,[ecx]   ; get zeroth entry
    movr ecx,[ecx+nameLengthPlace] ; (nameLength)
    ;mov eax,ecx
    ;jmp codeGetEnd
    mov eax,[esp+byteBase*1] ; stack skip ret, move (first arg) nameLen into ecx
    cmp ecx,eax
    jnz codeGetPrevEntry
    ;	check nameMatches
    mov edx,[currentEntry] ;
    add edx,namePlace ; skip flags and nameLen
    mov edx,[edx]	; get the actual string address
    mov ebx,[esp+byteBase*2]; (in arg 2: string address)
    mov ecx,[esp+byteBase]; (in arg 1: nameLength)
    push edx ; name address
    push ebx ; comparison string
    push ecx ; length
    call stringCompare ; string comparison
    pop eax
    cmp eax,0
    jnz codeGetPrevEntry
    ;	    else nextEntry or codeGetPrevEntry
    ;		    move previousWordLink into currentEntry
    ;	return address
    ;mov eax,[currentEntry]; 
    ;add eax,byteBase*1 ; nameLength address
    ;mov eax,[eax]
    ;movr ebx,charByteBase ; multiply length by char byte length 
	    ; cpu.asm assimilation
    ;mul ebx
    ;xor eax,eax
    mov ebx,[currentEntry]
    add ebx,codeLinkPlace; data 3: code
    ;add eax,ebx	    ; add address to nameLen
    mov eax,[ebx]
    jmp codeGetEnd
codeGetPrevEntry:
    ;	    else nextEntry or codeGetPrevEntry
    ;		    move previousWordLink into currentEntry
    ;mov 
    ; mov eax,code_testing2 ; testing
    ;mov eax,[eax] ; first arg is previous link
    ; get previousLink
    ; subtract entryByteBase for previousLink
    ;sub ecx,entryByteBase
    ;cmp eax,0 ; if link is 0
    ;add ecx,prevLinkPlace  ; get prevLink into ecx
    ;mov ecx,[ecx+prevLinkPlace]
    mov ecx,[currentEntry] ; get the currentEntryLink
    mov ecx,[ecx+prevLinkPlace] ; prevEntry number
    ; multiply by entryLength
    ;mov ebx,[esp+byteBase*3]  ; index address
    ;mov ebx,-1
    ;mov edx,[index]; debugging
    cmp ecx,-1 ; if start of index
    mov eax,defGet_code; ; ask for definition
    ; or assume literal and push onto stack
    mov eax,literal
    ; check if number
    jz  codeGetEnd ; then exit
    mov ebx,[esp+byteBase*3]  ; index address
    push ebx
    call getStartAddress
    pop ebx
    mov eax,[esp+byteBase*3] ; indexAddress
    mov eax,[eax+listEntryLengthPlace]
    mov ecx,[currentEntry] ; get the currentEntryLink
    mov ecx,[ecx+prevLinkPlace] ; prevEntry number
    mul ecx ; mul eax,ecx
    addr eax,ebx ; make full link
    movr [currentEntry],eax ; move linkAddress to currentEntry
    jmp codeGetMid
literal:
    ; if number
    ; if char
    movr ebx,[line]  ; input string address
    spush ebx,1
    ; if string
    next
    
codeGetEnd:
    pop edx ; ret
    pop ebx ; clear args
    pop ebx 
    pop ebx 
    push eax ; result
    push edx ; ret
    ret
    

