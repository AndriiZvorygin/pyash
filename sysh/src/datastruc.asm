; index definition (dynamic stack)
;section .bss
;    functionIndex   resb    0x100
; function definition
%macro function 3 ;label,name,nameLength
section .bss
function_%1
    versionIndex    resb    0x10
%endmacro

; 4-bit alphabet defintion
; 2d array

; version definition
%macro defcode	4  ; label,name,nameLength,flags
section .data
;align byteBase 
data_%1: ; dataEntryStructure or qualityPoint flags,nameLength,name,codeLink
;dats %1,%2
; testing data structures
    datr  prevlink_%1
    ;datr  code_%1  ; codeLink
    datr	%4  ; flags
    datr	%3  ; nameLength
    datr  name_%1  ; name
    datr  code_%1  ; codeLink
dats  name_%1,%2
datr  prevlink_%1,link
;datr  link,data_%1
datr  %1,code_%1
section .text
;    global data_init_%1
;data_init_%1:
;    ; set prevlink_
;    movr eax,[prevlink_%1]
;    movr ebx,[link]
;    movr [eax],ebx
;    ; update link
;    movr eax,link; address of link
;    mov ebx,data_%1; current data address
;    movr [link],ebx   ; update link ;
;    ; update latest
;   ; mov eax,[latest]
    
code_%1:
;addToIndex name_%1,code_%1
%endmacro 
%macro addToIndex 2
%endmacro
%macro defvar 5   ; label,name,nameLength,flags,initial
defcode %1,%2,%3,%4
push var_name
section .data
    align byteBase
    datr var_%1,%5
%endmacro

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;; function instead of macro
;;;;;;;;;;;;
;; input
;   name_link,nameLength,flags,code_link
;   data:   flags(byteBase),nameLength(byteBase),name(byteBase),code_link (byteBase)
;section .rodata
    ;entryByteBase   equ	byteBase*4 ; obsolete
;;; macro might pass it args
%macro codeEntry 5 ; label,name,nameLength,meta,index followed by code
; call %1_init ; to create entry after using macro
section .rodata
     %1_length  equ  %3
section .data ; 
    datr %1_flags,%4
    datr %1_name,%2
section .text
%1_init:
    ;push %5      ; index
    push %1_code
    push %1_name
    pushr %1_length
    push %1_flags
    movr eax,%5
    pushr [eax+listLatestPlace] ; prevLink
    pushr 5 ; number of Entry sections
    push eax ; TODO make entries modular, arg  listAddress numberOfEntries pushed onto stack
    call addEntry
    ret
%1_code:
%endmacro
%macro linkEntry 6 ; label,name,nameLength,meta,index,link
; call %1_init ; to create entry after using macro
section .rodata
     %1_length  equ  %3
section .data ; 
    datr %1_flags,%4
    datr %1_name,%2
section .text
%1_init:
    pushr %6	 ; link address
    push %1_name
    pushr %1_length
    push %1_flags
    movr eax,%5
    pushr [eax+listLatestPlace] ; prevLink
    pushr 5 ; number of sections
    pushr eax
    call addEntry
    ret
%endmacro
section .bss
    ; def-data:	    frequency(byte) 
    ;			if frequency exceed limit, divide all freq by 2
    ;		    flags(byte),
    ;		    nameLength(byte),
    ;		    name(byteBase),
    ;		    code_link (byteBase)
section .rodata
    listZeroListPlace		equ byteBase*0
    listContentPlace		equ byteBase*1 ; headerLength
    listStartPlace		equ byteBase*2
    listEndPlace		equ byteBase*3
    listCurrentPlace		equ byteBase*4
    listLatestPlace		equ byteBase*5
    listEntryLengthPlace	equ byteBase*6
    listParentPlace		equ byteBase*9
    listChildPlace		equ byteBase*0xA
    listDataStart		equ byteBase*7
    listListEnd			equ byteBase*4; is currentPlace
    listHeapLength		equ byteBase*0xB
    ;listSectionLengthPlace	equ byteBase*5
    listHeaderLength		equ byteBase*0xF
section .text
list_init:
    ; input listLength entryLength  ; listLength in number of entries
    ; returns listAddress
    ;mov eax,[esp+byteBase] ; get index address
    ; extendMemory to accomodate list
    movr ebx,[esp+byteBase*1] ; listLength
    movr eax,entryLength ;[esp+byteBase*2] ; entryLength
    mul ebx
    addr eax,listHeaderLength+byteBase
    pushr eax
    call holdMore
    pop ecx ; listAddress
    ; set zeroListAddress
    movr [ecx+listZeroListPlace],ecx
    ; set listStartPlace
    movr [ecx+listStartPlace],0
    ; set listEndPlace
    movr ebx,[esp+byteBase*1] ; listLength
    ;movr eax,[esp+byteBase*2] ; entryLength
    ;mul ebx
    ;addr eax,listHeaderLength+byteBase
    ;movr [ecx+listEndPlace],eax
    movr [ecx+listEndPlace],ebx
    ; set contentStart
    movr [ecx+listContentPlace],listHeaderLength
    ; set Latest
    ;xor  ebx,ebx
    ;subr ebx,listHeaderLength
    ;subx ebx,1
    movr ebx,-1
    movr [ecx+listLatestPlace],ebx ; make latestEntry
    ; set Current
    movr [ecx+listCurrentPlace],0 ; move freeSpaceLocation to indexFreeSpacePlace of index
    ; setEntryLength
    movr ebx,entryLength ;[esp+byteBase*2] ; entryLength
    movr [ecx+listEntryLengthPlace],ebx
    ; setSectionLength default is byteBase
    ; movr ebx,[esp+byteBase*4] ; sectionLength
    ; movr [eax+listSectionLengthPlace],ebx
    ; finish
    pop edx ; ret
    pop ebx ; clear args
    pop ebx
    push ecx ; return listAddress
    push edx
    ret
heapListInit:
    ; input listLength 
     ; listLength in number of entries
    ; returns listAddress
    ; extendMemory to accomodate list
    movr ebx,[esp+byteBase*1] ; listLength
    movr eax,entryLength ;[esp+byteBase*2] ; entryLength
    mul ebx
    addr eax,listHeaderLength+byteBase
    ; make room for storing variables
    movr ebx,4
    mul ebx ; 1:3 ratio of list to data phi 
    pushr eax ; to keep byteLength
    pushr eax
    call holdMore
    pop ecx ; listAddress
    pop eax ; byteLength
    ; set HeapLength (in bytes from start)
    movr [ecx+listHeapLength],eax
    ; set DataStart (in bytes from start)
    movr [ecx+listDataStart],eax
    ; set zeroListAddress
    movr [ecx+listZeroListPlace],ecx
    ; set listStartPlace
    movr [ecx+listStartPlace],0
    ; set listEndPlace
    movr ebx,[esp+byteBase*1] ; listLength
    movr [ecx+listEndPlace],ebx
    ; set contentStart
    movr [ecx+listContentPlace],listHeaderLength
    ; set Latest
    movr ebx,-1
    movr [ecx+listLatestPlace],ebx ; make latestEntry
    ; set Current
    movr [ecx+listCurrentPlace],0 ; move freeSpaceLocation to indexFreeSpacePlace of index
    ; setEntryLength
    movr ebx,entryLength ;[esp+byteBase*2] ; entryLength
    movr [ecx+listEntryLengthPlace],ebx
    ; setSectionLength default is byteBase
    ; finish
    pop edx ; ret
    pop ebx ; clear args
    pop ebx
    push ecx ; return listAddress
    push edx
    ret
getStartAddress:
    ; input listAddress
    ; return startContentAddress
    movr eax,[esp+byteBase*1] ; listAddress
    pushr eax
    pushr 0
    call getEntryAddress
    pop eax
    ;movr ebx,[eax+listContentPlace]
    ;addr ebx,eax
    pop edx ; ret
    pop ebx ; clearArgs
    push eax ; result
    push edx ; ret
    ret
getCurrentAddress:
    ; input listAddress
    mov ecx,[esp+byteBase] ; listAddress
    mov ebx,[ecx+listZeroListPlace]
    mov eax,[ebx+listCurrentPlace]
    push ecx ; listAddr
    push eax ; latestPlace
    call getEntryAddress
    pop eax
    ;mov edx,[esp+byteBase] ; listAddress
    ;push edx
    ;call getStartAddress
    ;pop ebx; startAddress
    ;mov edx,[esp+byteBase] ; listAddress
    ;mov ecx,[edx+listCurrentPlace]
    ;; multiply currentNumber by entryLength
    ;movr eax,[edx+listEntryLengthPlace]
    ;mul ecx ; mul eax,ecx
    ;addr eax,ebx ; add current to start
    ; finished
    pop edx ; ret
    pop ebx; clear args
    push eax ; result
    push edx ; ret
    ret
getLatestAddress:
    ; input listAddress
    mov ecx,[esp+byteBase] ; listAddress
    mov ebx,[ecx+listZeroListPlace]
    mov eax,[ebx+listLatestPlace]
    push ecx ; listAddr
    push eax ; latestPlace
    call getEntryAddress
    pop eax
    
    ;push edx
    ;call getStartAddress
    ;pop ebx; startAddress
    ;mov edx,[esp+byteBase] ; listAddress
    ;mov ecx,[edx+listLatestPlace]
    ;; multiply currentNumber by entryLength
    ;movr eax,[edx+listEntryLengthPlace]
    ;mul ecx ; mul eax,ecx
    ;addr eax,ebx ; add current to start
    ; finished
    pop edx ; ret
    pop ebx; clear args
    push eax ; result
    push edx ; ret
    ret

    
; addEntry
    ; def-data:	    
    ;		    prev_link (byteBase)
    ;		    ;frequency(byte)  for hoffman list
    ;		    ;	if frequency exceed limit, divide all freq by 2
    ;		    flags(byte),
    ;		    nameLength(byte),
    ;		    name(byteBase),
    ;		    code_link (byteBase)
    section .rodata
	prevLinkPlace   	equ 0
	flagsPlace	    	equ byteBase
	nameLengthPlace  	equ byteBase*2
	namePlace	    	equ byteBase*3
	codeLinkPlace   	equ byteBase*4
	codeLengthPlace		equ byteBase*5
	entryLength		equ byteBase*6
	sectionLength		equ byteBase*1
    lessMoveErrMsg	db "asm listPlace move error, too low, setting to lowest",0xa
    lessMoveErrMsgLen	equ $ - lessMoveErrMsg
    moreMoveErrMsg db "asm listPlace move error, too high, setting to highest",0xa
    moreMoveErrMsgLen	equ $ - moreMoveErrMsg
section .text
entryJump:
    ; input entryNumber listAddress 
    ; goal update currentEntry and latestEntry safely
    ; algorithm
    ; getEntryAddress	
    movr ebx,[esp+byteBase*2] ; listAddress
    movr ecx,[esp+byteBase]; entryNumber
    push ebx
    push ecx
    call getValidEntryNumber
    pop eax
    ;	set EntryNumber
    movr [esp+byteBase],eax
    jg entryJumpMid
    ;; setLatest and Current 
    ;;	else error
    ;; getEndEntry
    ;movr edx,[esp+byteBase*2] ; listAddress
    ;movr eax,[edx+listEndPlace] ; endEntry
    ;;	if endEntry lessThan entryNumber
    ;movr ebx,[esp+byteBase] ; entryNumber
    ;cmp eax,ebx
    ;jl moreEntryJump
    ;;	    leave at last entry 
    ;;	    send to childList
    ;;	    xor extend list
    ;;	    xor print error
    ;; else
    ;; getStartEntry
    ;movr eax,[edx+listStartPlace] ; startEntry
    ;;	subtract entryNumber from listStartEntry (for linked array list)
    ;cmp ebx,eax
    ;;	if less than 0,
    ;jl lessEntryJump
    ;;	    find parent list and call jump with it's address
    ;;	    xor print error
    ;; else
entryJumpMid:
    ; update currentEntry and latestEntry safely
    ;  found in zeroList   zeroListPlace
    ;	get zeroListAddress
    ;	update entries
    mov edx,[esp+byteBase*2] ; listAddress
    mov ecx,[edx+listZeroListPlace] ; zeroListAddress
    mov eax,[ecx+listCurrentPlace]
    mov [ecx+listLatestPlace],eax
    mov eax,[esp+byteBase*1] ; entryNumber
    mov [ecx+listCurrentPlace],eax
    ; return
    jmp entryJumpEnd
entryJumpEnd:
    pop edx ; ret
    pop ebx; clear args
    pop ebx
    push edx ; ret
    ret
    ; TODO 25,  before addEntry,  
    ;	check area is clear, 
    ;	if not throw warning,
    ;	    or ask if sure of overwrite
    ;	    if not or quiet or auto-mode set current to clearSpace
    ;	    or overwrite if in replace-mode
    ;	    then addEntry
; safe by default
relativeEntryJump:
    ; input args  increment listAddress
    ; purpose move relative to currentPlace
    ;	getZeroList
    ;	getCurrentNumber
    ;	add increment
    ;	set latest
    ;	set new current

    ;	getZeroList
    movr edx,[esp+byteBase*2] ; listAddress
    movr ecx,[edx+listZeroListPlace] ; zeroListAddress
    ;	getCurrentNumber
    movr ebx,[ecx+listCurrentPlace] ; 
    ;	add increment
    mov eax,[esp+byteBase] ; increment
    addr eax,ebx
    ;	jump to result
    pushr [esp+byteBase*2] ; listAddress
    pushr eax ; 
    call entryJump
    pop edx ; ret
    pop ebx ; clear args
    pop ebx 
    push edx ; ret
    ret
;move:
;    ; input increment listAddress
;    ; sets latest to current
;    ; changes current by increment
;	; if too low, sets to 0
;	    ; and sends error to stderr
;	; if too high, sets to lastEntryPlace (listLength - EntryLength)
;	    ; and sends error to stderr
;    ; input increment listAddress
;    movr eax,[esp+byteBase*2] ; listAddress
;    ; sets latest to current
;    movr ebx,[eax+listCurrentPlace]  ; current
;    movr [eax+listLatestPlace],ebx
;    ; changes current by increment
;    movr ecx,[esp+byteBase] ; increment
;    addr ebx,ecx
;	; if too low, below 0
;    cmp ebx,0
;    jl lessMove
;	; sets to 0
;	    ; and sends error to stderr
;	; if too high, above listLength - EntryLength
;    movr edx,[eax+listEndPlace]
;    ;movr ecx,[eax+listEntryLengthPlace]; get entryLength
;    ;subr edx,ecx
;    cmp ebx,edx
;    jg moreMove
;	    ;sets to lastEntryPlace (listLength - EntryLength)
;	    ; and sends error to stderr
;    movr [eax+listCurrentPlace],ebx
;    ; finished
;    jmp moveEnd
;moveEnd:
;    pop edx ; ret
;    pop ebx; clear args
;    pop ebx
;    push edx ; ret
;    ret

;section .rodata
;section .text
;lessEntryJump:
;    ;	    find parent list and call jump with it's address
;    ;	    xor print error
;	; if too low, 
;	; sets to 0
;	    ; and sends error to stderr
;	; sets to 0
;    movr eax,[esp+byteBase*2] ; listAddress
;    movr ebx,[eax+listCurrentPlace]
;    movr [eax+listLatestPlace],ebx
;    movr [eax+listCurrentPlace],0
;	    ; and sends error to stderr
;    push lessMoveErrMsgLen
;    push lessMoveErrMsg
;    call errAreaSay
;    jmp entryJumpEnd
;section .rodata
;section .text
;moreEntryJump:
;    ;	    leave at last entry 
;    ;	    send to childList
;    ;	    xor extend list
;    ;	    xor print error
;    movr eax,[esp+byteBase*2] ; listAddress
;    movr edx,[eax+listEndPlace]
;    ;subr edx,entryLength
;    movr ebx,[eax+listCurrentPlace]
;    movr [eax+listLatestPlace],ebx
;    movr [eax+listCurrentPlace],edx
;    push moreMoveErrMsgLen
;    push moreMoveErrMsg
;    call errAreaSay
;    jmp entryJumpEnd
	

; Stack Types
    ;	stack entry
    ;	data:
    ;	    type    byte (number, string, address, memory)
    ;	    variety byte (0-string, length-string, ...)
    ;	    delim   byte (bytes per unit (letter))
    ;	    length  byte (in units, -1 is infinite (undefined))
    ;	    data_link    

; accept list DONE
; make relative links  DONE
; add move function  DONE
; allow for variables
	; ?

; generify addEntry
;    input listAddress, entryLength, entries
    ; get's currentAddress
    ; till entryLength
    ;	pops and appends
addEntry:
; generify addEntry
;    input listAddress, numberOfSections, entries
    ; get's currentAddress
    ; till numberOfSections is 0
    ;	pops and appends

	mov  eax,[esp+byteBase] ; index Address
	push eax
	call getCurrentAddress
	pop ebx ; currentAddress
	;movr edx,[esp+byteBase]; ret
        ; counter for section location on stack
	movr edx,esp
	addr edx,byteBase*3 ;skip first two args
	movr ecx,[esp+byteBase*2] ; entryLength
	jmp addEntryMid

addEntryMid:
	; check length > 0
	cmp ecx,0
	; if equal to 0 then end
	jz addEntryEnd
	; else 
	;    pop and append to current
	; length derived byteBase
	movr eax,[edx]
	movr [ebx],eax
	;    increment current by sectionLength (default byteBase)
	addr ebx,sectionLength
	;    decrement length by 1
	subr ecx,1
	addr edx,byteBase ; increment where get from stack
	;    recurse
	jmp addEntryMid

addEntryEnd:
	; do move by length
	; numberOfSections*byteBase
	;movr eax,[esp+byteBase*2] ; numberOfSection
	;movr edx,byteBase
	;mul edx ; multiplies by eax
	movr ebx,[esp+byteBase] ; listAddress
	pushr  ebx ; listAddress
	pushr 1 ; bytes to move by
	call relativeEntryJump
	; store retAddress
	; for numberOfSections pop args
	; finished
	movr eax,[esp+byteBase*2] ; numberOfSection
	addr eax,2		  ; include the numberOfSectionsArg and listAddress
	movr ebx,[esp]
	movr ecx,[esp+byteBase]
	push eax
	call clearArgs
	ret
clearArgs:
    ; input  length
    ; store ret  and ret of caller safely
    ; pop till length is 0
    pop edx ; ret
    pop ecx ; length
    pop ebx ; retOfCaller
    jmp clearArgsMid
clearArgsMid:
    cmp ecx,0 ; if 0 exit
    jz clearArgsNone
    ; else 
    ;   pop arg
    pop eax
    ;	decrement Length
    subr ecx,1
    ;   recurse
    jmp clearArgsMid
clearArgsNone:
    push ebx ; caller ret
    push edx ; ret
    ret
    
; search generify
;   stringEntryMatch  input list listSection stringLength stringLink 
		    ; output  entryLink
;   sectionEntryMatch  ; input list listSection matchSection
		    ;	output entryLink
;  entrySectionGet  ; input entryLink listSection
		    ; output sectionContents

entrySectionGet:
;  entrySectionGet  ; input listLink entryNumber listSectionNumber
		    ; output sectionContents
    movr ecx,[esp+byteBase*1] ; listLink
    movr eax,[esp+byteBase*3] ; listSection
    ;movr edx,[ecx+listSectionLengthPlace]  ; multiply listSection by sectionLength
    movr edx,sectionLength  ; multiply listSection by sectionLength
    mul  edx
    addr ebx,eax ; add sectionsAddress to Entry
    movr ebx,[ebx] ; get contents of section
    movr ebx,[esp+byteBase*2] ; entryNumber
    pop edx; ret
    pop ebx ; clear args
    pop ebx
    pop ebx
    push ebx ; return result
    push edx ; ret
    ret 
;   sectionEntryMatch  ; input list sectionNumber matchSection
		    ;	output entryLink
sectionEntryMatch:
    ; find entryLength
    ; find sectionLength
    ; linear search till match found

    ; find entryLength
    movr ebx,[esp+byteBase] ; listLink
    movr edx,[ebx+listEntryLengthPlace] ; entryLength
    ; linear search till match found
    ; linearSearch  input entryLink, section
    ;	check if current is match
    ;	then return entryNumber
    ;	else if not increment
    ;   if increment less than length-entryLength 
    ;	then recurse
    ;   else return negative
    
; make listLength numberOfEntries
; make list_init createMemoryForList and return address

; entryStartNumber entryEndNumber support, for LinkedArrayList

getEntryAddress:
    ; input entryNumber listAddress
    ; output entryAddress
    ;; algorithm
    ;;	get startAddress
    ;;	get entryLength
    ;;	multiply entryLength  entryNumber
    ;;	add to startAddress
    ;;	return
    ;;	get startAddress
    ;mov edx,[esp+byteBase*2]; listAddress
    ;push edx
    ;call getStartAddress
    ;pop ecx ; listStartAddress
    ;;	get entryLength
    ;mov eax,[edx+listEntryLengthPlace]
    ;;	multiply entryLength  entryNumber
    ;mov ebx,[esp+byteBase*1]; entryNumber
    ;mul ebx 
    ;;	add to startAddress
    ;add ecx,eax
    ;;	return
    ;pop edx;ret
    ;pop ebx; clear args
    ;pop ebx;
    ;push ecx; result entry address
    ;push edx 
    ;ret
    ; input entryNumber listAddress 
    ; goal update currentEntry and latestEntry safely
    ; algorithm
    ; getEndEntry
    ;movr edx,[esp+byteBase*2] ; listAddress
    ;movr eax,[edx+listEndPlace] ; endEntry
    ;;	if endEntry lessThan entryNumber
    ;movr ebx,[esp+byteBase] ; entryNumber
    ;cmp eax,ebx
    ;jl moreGetEntryAddress
    ;;	    leave at last entry 
    ;;	    send to childList
    ;;	    xor extend list
    ;;	    xor print error
    ;; else
    ;; getStartEntry
    ;movr eax,[edx+listStartPlace] ; startEntry
    ;;	subtract entryNumber from listStartEntry (for linked array list)
    ;cmp ebx,eax
    ;;	if less than 0,
    ;jl lessGetEntryAddress
    ;	    find parent list and call jump with it's address
    ;	    xor print error
    ; else
    ;	get address
    ; using getValidEntryNumber
    mov ebx,[esp+byteBase*2] ; listAddress
    mov ecx,[esp+byteBase] ; entryNumber
    push ebx
    push ecx
    call getValidEntryNumber
    pop eax
    mov [esp+byteBase],eax
    jmp getEntryAddressMid
getEntryAddressMid:
    mov ecx,[esp+byteBase*2] ; listAddress
    mov eax,[esp+byteBase*1] ; entryNumber
    movr ebx,[ecx+listStartPlace] ; startEntry
    sub eax,ebx ; subtract listStart from entryNumber so proper relative value
    mov ebx,[ecx+listEntryLengthPlace]
    mul ebx ; mul entryNumber times relativeValue
    mov ebx,[ecx+listContentPlace]
    add ebx,ecx ; set to listStartAddress
    add eax,ebx ; set to entryAddress
    jmp getEntryAddressEnd
getEntryAddressEnd:
    ; return
    pop edx ; ret
    pop ebx; clear args
    pop ebx
    push eax ; result
    push edx ; ret
    ret
;lessGetEntryAddress:
;    ; set Entry to zeroth
;    movr [esp+byteBase*1],0
;    ; or find parentEntry
;    jmp getEntryAddressEnd
;moreGetEntryAddress:
;    ; setEntry to highest
;    mov edx,[esp+byteBase*2] ; listAddress
;    mov ebx,[edx+listEndPlace]
;    mov [esp+byteBase*1],ebx ; set entry
;    ; or find child entry
;    jmp getEntryAddressEnd

getValidEntryNumber:
    ; algorithm
    ; getEndEntry
    movr edx,[esp+byteBase*2] ; listAddress
    movr eax,[edx+listEndPlace] ; endEntry
    ;	if endEntry lessThan entryNumber
    movr ebx,[esp+byteBase] ; entryNumber
    cmp eax,ebx
    jl moreGetValidEntryNumber
    ;	    leave at last entry 
    ;	    send to childList
    ;	    xor extend list
    ;	    xor print error
    ; else
    ; getStartEntry
    movr eax,[edx+listStartPlace] ; startEntry
    ;	subtract entryNumber from listStartEntry (for linked array list)
    cmp ebx,eax
    ;	if less than 0,
    jl lessGetValidEntryNumber
    ;	    find parent list and call jump with it's address
    ;	    xor print error
    ; else
    ;	get address
    jmp getValidEntryNumberMid
getValidEntryNumberMid:
    ;mov ecx,[esp+byteBase*2] ; listAddress
    ;mov eax,[esp+byteBase*1] ; entryNumber
    ;movr ebx,[ecx+listStartPlace] ; startEntry
    ;sub eax,ebx ; subtract listStart from entryNumber so proper relative value
    ;mov ebx,[ecx+listEntryLengthPlace]
    ;mul ebx ; mul entryNumber times relativeValue
    ;mov ebx,[ecx+listContentPlace]
    ;add ebx,ecx ; set to listStartAddress
    ;add eax,ebx ; set to entryAddress
    mov eax,[esp+byteBase*1] ; entryNumber
    jmp getEntryAddressEnd
getValidEntryNumberEnd:
    ; return
    pop edx ; ret
    pop ebx; clear args
    pop ebx
    push eax ; result
    push edx ; ret
    ret
lessGetValidEntryNumber:
    ; set Entry to start
    movr ebx,[esp+byteBase*2]; listAddress
    movr ecx,[ebx+listStartPlace];
    movr [esp+byteBase*1],ecx
    ; or find parentEntry
    ; and call it
    push lessMoveErrMsgLen
    push lessMoveErrMsg
    call errAreaSay
    jmp getValidEntryNumberMid
moreGetValidEntryNumber:
    ; setEntry to highest
    mov edx,[esp+byteBase*2] ; listAddress
    mov ebx,[edx+listEndPlace]
    mov [esp+byteBase*1],ebx ; set entry
    ; or find child entry
    ; and call it
    ; print error
    push moreMoveErrMsgLen
    push moreMoveErrMsg
    call errAreaSay
    jmp getValidEntryNumberMid

; makeVariable
entryPut: ; awarePut
; addsEntry to variableList
; input listAddress valueAddress valueLength name nameLength meta 
; 
; algorithm
;   stores contents at back of heap
    movr eax,[esp+byteBase*1] ; listAddress
    movr ebx,[esp+byteBase*2] ; value
    movr ecx,[esp+byteBase*3] ; valueLength
    pushr ecx ; valueLength
    pushr ebx ; valueAddress
    pushr eax ; list addr
    call endHeapValuePut
    pop edx ; valueDataAddr
    movr eax,[esp+byteBase*1] ; listAddress
    movr ebx,[esp+byteBase*4] ; name
    movr ecx,[esp+byteBase*5] ; nameLength
    pushr edx ; keep valueAddr
    pushr ecx ; nameLength
    pushr ebx ; nameAddress
    pushr eax ; list addr
    call endHeapValuePut
    pop edx ; nameDataAddr
    pop ecx ; valueDataAddr
;   counts back from endOfHeap 
;   and stores list at front of heap
    ;pushr ebx ; listAddress
    movr ebx,[esp+byteBase]; list address
    push ecx ; codeAddr
    pushr edx ; nameAddr
    movr eax,[esp+byteBase*5] ; nameLength
    pushr eax
    movr eax,[esp+byteBase*6] ; meta flags
    pushr eax ; meta flags
    movr eax,[ebx+listLatestPlace]
    pushr eax ; prevLink
    pushr 5   ; 5 entries
    pushr ebx ; listAddress
    call addEntry
;	updates listListEnd
    pop edx ; ret
    pop ebx ; clear args
    pop ebx
    pop ebx 
    pop ebx 
    pop ebx
    pop ebx
    push edx
    ret
valuePut:
    ; in value valueLen
    ; returns address
    ; extend memory by valueLen
    movr ecx,[esp+byteBase*2] ; valueLen
    push ecx ; valueLen
    call holdMore
    pop eax; resultAddress
    ; copyMem
    movr ebx,[esp+byteBase*1] ; valueAddr
    push ebx ; source valueAddr
    push eax ; destination dataAddr
    push ecx ; valueLen
    call copyMove
    ; return
    pop edx ;ret
    pop ebx ; clear args
    pop ebx
    push eax ;result
    push edx ; ret
    ret
endHeapValuePut:
    ; in listAddress value valueLen 
    ; returns address
    ; extend memory by valueLen
    movr ebx,[esp+byteBase] ; listAddr
    movr ecx,[esp+byteBase*3] ; valueLen
    push ecx ; valueLen
    push ebx ; listAddr
    call endHeapValuePutDataAddr
    pop eax; resultAddress
    ; copyMem
    movr ecx,[esp+byteBase*3] ; valueLen
    movr ebx,[esp+byteBase*2] ; valueAddr
    push ebx ; source valueAddr
    push eax ; destination dataAddr
    push ecx ; valueLen
    call copyMove
    ; return
    pop edx ;ret
    pop ebx ; clear args
    pop ebx
    pop ebx
    push eax ;result
    push edx ; ret
    ret
endHeapValuePutDataAddr:
    ; input listAddr valueLen
    ; returns dataAddr
    movr ecx,[esp+byteBase*1] ; listAddress
    movr eax,[ecx+listDataStart] ; byte where data starts
    movr ebx,[esp+byteBase*2] ; valueLength in bytes
    subr eax,ebx ; new dataStart
	; check is greater than listEnd enough to fit listEntry
;	updates startOfData
    movr [ecx+listDataStart],eax
    ; copy value to storage area
    addr eax,ecx
    ; result in eax
    pop edx ; ret
    pop ebx ;  clear args
    pop ebx
    push eax ; result
    push edx ;
    ret
endHeapPut: 
    ; input listAddress valueAddress valueLength
    ; returns dataAddress
    ;jmp endHeapPutDataAddr
    ; result in eax
    movr eax,line
    movr edx,[esp+byteBase*2] ; value address
    pushr edx ; source value address
    ; set to full link
    pushr eax  ; destination
    pushr ebx ;length
    call copyMove 
    ;jmp endHeapPutDataAddr
    pop edx ; ret
    pop ebx ; clear args
    pop ebx
    pop ebx
    push eax ; dataAddress
    push edx ; ret
    ret
endHeapPutDataAddr:
    movr ecx,[esp+byteBase*1] ; listAddress
    movr eax,[ecx+listDataStart] ; byte where data starts
    movr ebx,[esp+byteBase*3] ; valueLength in bytes
    subr eax,ebx ; new dataStart
	; check is greater than listEnd enough to fit listEntry
;	updates startOfData
    movr [ecx+listDataStart],eax
    ; copy value to storage area
    addr eax,ecx
    ; result in eax
    ret

; heapList
