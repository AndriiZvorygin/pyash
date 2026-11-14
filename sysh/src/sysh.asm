; Sysh a forth  or haskell like programming language
; version 0.3 alpha dynamic memory releae
;         0.2 alpha.stack release
;	  0.1 alpha.interpreter release
; author Andrii Lowki Elspru Zvorygin
;   
; designed for portability
; safe and secure by default
; only uses primitive assembly functions or opcodes
;    mov, push, pop, cmp, jz, jnz, jl, jg, jmp, call, ret, add, sub, rep, mul
; uses registers: 
;   eax, ebx, ecx, edx, esp, ebp, flags, edi, esi
; architecture specific things defined in cpu.asm
; string specific things (constants and macros) defined in string.asm
;   TODO integrate al dl type things into string.asm
%include "cpu.asm" ; processor information
%include "string.asm" ; string information
%include "constant.asm"
%include "variable.asm" ; variables for use by functions
%include "lin_system.asm" ; linux system info and variables
%include "lin_io.asm" ; I\O io input output, read and write
%include "macro_stack.asm" 
%include "parser.asm"
%include "datastruc.asm"
%include "words.asm"
%include "search.asm"
; whats the plan?
; start 
;   interpreter
;	readLine
;	iterate
;	    readWord
;	    findAddress
;		sequentially through words
;		    previousWordLink,flags,nameLen,name,codeAddress,infoAddress
;		or hop through sorted definitions
;		    definitionsEntry flag,nameLen,name,version0Address,versionNAddress
;		    versionEntry codeAddress,infoAddress
;	    runVersion
;	    or compile

section .rodata
	noneN		equ 0
	awareN		equ 1
	desireN		equ 2
	freeN		equ 3
	pointN		equ 4
	sayN		equ 5
	getN		equ 6
	moveN		equ 7
	midN		equ 8
	moreN		equ 9
	lessN		equ 0xA
	numberN		equ 0xB
	areaN		equ 0xC ; list meta
	lightN		equ 0xD
	matterN		equ 0xE  
	qualityN	equ 0xF
	
	maxFunctions	equ 16
	definitionsLength   equ maxFunctions;*entryLength+listHeaderLength+byteBase
	argumentsLength	    equ 8;*entryLength+listHeaderLength+byteBase
	rootLength	    equ 3;*entryLength+listHeaderLength+byteBase ; definitions, arguments
	variablesLength	    equ 0x100
section .bss
    ress char,1
    resr  definitions,byteBase ; definitions list address
    resr  arguments,byteBase	; arguments list
    ;resr  root,rootLength		; index list
    resr root,byteBase
    resr variables,byteBase
    resr  syshStack,byteBase*0x10
section .rodata
msg     db      "Hello, world!",1010b ;our dear string ; left handed binary
len     equ     $ - msg                 ;length of our dear string
;syshStack   equ	    esp+byteBase*0x10 ; allows 10 variables on normal stack
section .text
    global _start
_start:
	;push	msg
	;pushr len
	;call lightSay
	;push msg
	;call pointHear
	;call pointSay
; start 
;   interpreter
	;pushr initialDataSegmentSize
	;call holdMore
	;pop eax
	; initialize returnStack
	mov ebp,syshStack
	;addr ebp,byteBase*0x10 ; allows 10 variables on normal stack
	; root list
	;push entryLength
	push rootLength
	call list_init
	pop eax
	movr [root],eax
	;
	; list for definitions
	;push entryLength
	push definitionsLength
	call list_init
	pop eax
	movr [definitions],eax
	; heapList for variables
	;push entryLength
	push variablesLength
	call heapListInit
	pop eax
	movr [variables],eax
	; list for args
	call word_init
	call interpreter
        jmp good_exit

section .rodata
    maxLineLen	equ  0xFF
section .bss
    ress    line,maxLineLen
    resr lineLength,1
section .text
interpreter:
    push line
;	readLine
    call readLine
    ; check lineLen > 0
    pop eax
    mov [lineLength],eax
    pop ebx
    cmp eax,0
   ; 	ifso exit
    jz good_exit
    ;push ebx
    ;push eax
    ;call lightSay
;	iterate
    movr eax,[root]
    pushr eax;root
    pushr lineLength
    pushr line
    call  iterate
    ;push line
    ;push maxLineLen
    ;call clearLine
	;push	msg
	;pushr len
	;call lightSay
    ; start new prompt
    mov byte [line],lineEnd ; make new line
    push line
    call byteSay
    jmp interpreterMidNone
interpreterMidNone: ;interpreterLoop
    ; end
    jmp interpreter
    ; in case not jumping
    ret

section .bss
    point	resb	32
;section .data:
;    dats charNumber,0
section .data

    dats argumentsTest,"definitions"
    argumentsTestLength equ $ - argumentsTest
section	.text
iterate:
    ; input
    ; line, lineLen, rootList
    ;push definitions ; for codeGet getCodeAddress
    movr eax,[esp+byteBase*3]; root
    push eax
    push argumentsTest
    push argumentsTestLength
    call codeGet
    pop  edx ; definitions
    ;pop eax
    ;push definitions
    movr eax,[esp+byteBase] ; line-address
    ;movr ecx,[eax]
    ;movr ebx,line
    movr ebx,[esp+byteBase*2] ; lineNumber-address
    push edx ; definitions
    pushr eax ; line
    pushr [ebx] ; lineNumber
    ;pushr [lineLength]
    
    ; find out noun or verb
    ; if noun push onto stack
    ; else verb run code
    ;push point
    call readWord
    ;pop eax; length	; clear args
    ;pop ebx; wordStart
    ;call lightSay  ; debug
    ; check wordLen > 0
    ;cmp eax,0
;	    findAddress
    ;call findAddress
    ;call tests
    call codeGet
    pop eax
    pushr [esp+byteBase*3] ; root
    call eax
    ;call tests
    ;movr eax,[eax]
;		sequentially through words
;		    previousWordLink,flags,nameLen,name,codeAddress,infoAddress
;		or hop through sorted definitions
;		    definitionsEntry flag,nameLen,name,version0Address,versionNAddress
;		    versionEntry codeAddress,infoAddress
;	    runVersion
;	    or compile
    ret

;tests:
;    movr eax,[latest]
;    ;movr eax,latest
;    ;movr eax,[data_testing] ; works
;    movr eax,[eax]
;    call eax ; address
;    ret
; 0	q	none
; 1	i	aware
; 2	u	desire
; 3	a	free
; 4	g	point	
; 5	s	say
; 6	c	hear
; 7	f	move
; 8	t	mid
; 9	j	less
; A	z	more
; B	n	number
; C	p	area
; D	l	light
; E	r	matter
; F	m	quality

; dec 8
; variables
;  variable-list seperate (from definition) list
; can have list of lists
;   definition (large)
;   variable (medium)
;   argument (smallest)
;  i.e.   char a 
   ; explanation char takes next word 
	; adds entry to argument-list
 ; naming
 ; i.e    str char1 endStr char a name 
    ; name makes definition str being word and charAddress being codeLink
;or 
    ; char a
    ; pushes value of a onto stack-list

; englishify ; done
; list of lists ; done
; accept argument
;   input-data-list  
; 

; search generify
;   stringEntryMatch  input list listSection stringLength stringLink 
		    ; output  entryLink
;   sectionEntryMatch  ; input list listSection matchSection
		    ;	output entryLink
;  entrySectionGet  ; input entryLink listSection
		    ; output sectionContents
    ; section length assumed to be byteBase

; fileSystem
; spaceLists
;  optimize to make sure spaceList that ends where another starts, merges
;
; assignedPointsList	;
; removedSpace ; chronological list of removed space
;		 if clearSpace is low, oldest removed space is cleared
; clearSpaceList ; previously unwritten space,  
		; or space that has been cleared by filling with 0'z
		; from here new space is found
; randomSpaceList
; checkSpace ; writes random string to space, 
;	    ; reads and verifies same,
;	    ; not same or error then add-to randomSpaceList

; 0 clearSpace clear 1 assignedSpace aware 2 removedSpace desire 3 randomSpace free

; customizable search, versionIndex type 3 freeN 
; can have defaults hoffmans (if frequency statistics available)
	;	    , binary (if sorted), 
        ;	    , exponential (if sorted and top unknown)
	;	    linear (usually works),  and so on.
; or person can request a particular kind of search

; latest be deprecated with introduction of entryLength

; linkedArrayLists, if list runs out of pre-allocated bytes, 
    ;	creates new list, by default of same length as current
			; or exponentially bigger 
			; perhaps multiplied by a golden fibonacci sequence 1 3
    ; and sets  headerNextListPlace with address

; listOption version control

; linkedList ; header  prevEntryLink nextEntryLink EntryLength? 

; listOfString listOfNumbers listOfChars  listOfType
    ; stores unique entries only (default compression)
	; uniquiness filtering can be background service
    ; links meta-7 used for types that don't fit in register
    ;	meta-4 tells value stored in addressSection 
		; so there is size reduction benefit to the compression
	; high level compression, linkStrings composed of other strings
	; strings of length greater than addressRegister,
	;   large strings can be made into linkStrings as background process
    ; string like file
    ; listOfChars relates visualSymbol with binaryNumber with other ex phoneme or meaning
    ; can keep listOfCallers as metaOption (for data analysis, i.e. frequency statistics)
    ; redundancy by keeping backup of lists and entries

; version-list Entry
    ; numberOfVersions version version version etsetera
    ;	version is versionEntryLink
    ; can have version organized by properties
    ; ex  1 aware simple 2 desire rigorous thorough 3 free quick 
    ;	  4 point stable 5 say debuging 6 hear statistics 7 move generator 
		; using the 7th entry generates a new function to perform same purpose
		;     purpose tested with help of meta information 
		;		i.e. on input/output 
		;  algorithm being evolutionary or otherwise


; permission hierarchy or holography
    ; posix permission lists
    ; with "files" pointing to strings

; storing on hardDrive
  ; header
    ; listOfLists (4 entries)
	; dataLists clearSpace, usedSpace, removedSpace, randomSpace
	    ; merged summaries, 
		; space optimizers reduce number of entries
	    ; randomSpace contains errorSpace sharedRandomSpace removedRandomSpace
	; definitions or dictionaries
	    ; translate to sysh 
	    ; translate from sysh
		; sysh to computer (assemby/machine-code)
	    ; sysh to sysh (for different kinds, imperative vs SOV vs asm)
	; navigation ( permissions (posix, dos, other))
	    ; linear	       1-d (hard-drive representation)
	    ; directory	       2-d (directory representation)
	    ; geometric	       3-d (computer topology, forest garden)
	    ;	 data
	    ;       heaps	    mounds
	    ;	    strings	    rocks based on size of string
	    ;	    number	    metals 
	    ;	    randSpace	    crystals
	    ;	    .deb .exe	    seed
	    ;	    removedSpace    black-earth
	    ;	    clearSpace	    granite shelf
	    ;	 process
	    ;	    generating	    seedball
	    ;	    initializing    seedling
	    ;	    application	    herb/grass
	    ;	    service	    bush (optimization, generation) subconscious
	    ;		berries		files/variables working on
	    ;	    server	    tree (console, ftp, http, ssh)  
	    ;		fruit		connections
	    ;	    time		4-d backups
	    ;	    variables	    grass/leaves
	    ;	      on	    green/yellow/blue/violet leaves (depending on state)
	    ;	      shuttingDown  red    leaves
	    ;	      off/idle	    fallen-brown-leaves
	    ;		removedSpace black-earth/compost
	    ;		    worm programs can randomize oldest removed space
	    ;			for higher shunso
	    ;
	    ;	    proccesses and subprocesses grow on heap where call initiated       
	    ; smallest heaps (initial heaps) at center,
	    ;    moving outwards in spiral
	    ;	    
	; 3 variables (strings, numbers)
	    ; argument List
	    ; char
	    ; number
	    ; string
  ; contents
    ; 0 permissionHeap(s)
    ; 1 definitionHeap(s)
    ; 2 variableHeap(s)
    ; 3 metaHeap(s)

; listOfList	 4 Entry
; dataList	 4 Entry
; definitionList 4 Entry
; permissionList 4 Entry
; variableList   4 Entry

; listOfHeap at begining of heap, with size enough to fill heap
;	    size can be based on probability functions
;		based on size of average number/string 
;	    if data doesn't fit in heap
;	      then create new heap of next golden fibonacci size times original
;		adjust the Length of the currentHeapList to be the fitting amount
;		pass the data to newHeapList 

; driver generator 
    ; uses random opcodes, 
    ; until a pattern is found, 
    ; correlation made to existing words,
    ; meanings assigned

;input output support

; instead of stack
; can have argument list
; whereStack whatRegister pop
; whatRegister whereStack push

; interpreter
;   readLine
;   push each wordStartAddress onto argument stack
;	countTillNonBlank is point of start
;	countTillBlank is point of end

;set_up_data_segment:
;    xor ebx,ebx	;// Call brk(0)
;    mov eax,sys_brk ; call  sys_brk
;    int kernel
;    ;mov [varHere],eax	; // Initialise HERE to point at beginning of data segment.
;    mov [root],eax	; // Initialise HERE to point at beginning of data segment.
;    add eax,initialDataSegmentSize    ;// Reserve nn bytes of memory for initial data segment.
;    mov ebx,eax	;// Call brk(HERE+INITIAL_DATA_SEGMENT_SIZE)
;    mov eax,sys_brk
;    int kernel
;    ret


; todo
; linkedArrayList or addVariable  or multiWordLineInterpret
;   or makeBootable (update int kernel to appropriate)
;   or writeToFile
; addVariable

; write to file
; input list
