section .text
;defcode testing,"testing",7,3
word_init:
    call testing2_init
    call testing_init
    call defGet_init
    call mq_init
    call definitionsEntry_init
    call argumentsEntry_init
    call chara_init
    call emit_init
    call vartest_init
    ret

section .data
    datr nameV,"variable"
    nameVLen   equ $ - nameV
    datr valueV,"vartest"
    valueVLen  equ $ - nameV
section .text
vartest_init:
    movr eax,[variables]
    pushr 0 ; flags meta
    pushr nameVLen
    pushr nameV
    pushr valueVLen
    pushr valueV
    pushr eax ; list address
    call entryPut
    ;call endHeapValuePut
    pop eax
    ret

%macro next 0  ; finalizing actions of definitions
    pop edx ; ret address
    pop ebx ; root arg clear
    push edx
    ret 
%endmacro
codeEntry testing,"testing",7,3,[definitions]
    push msg
    call byteSay
    next
;defcode testing2,"testing2",8,2
codeEntry testing2,"testing2",8,2,[definitions]
    push line
    call byteSay
    next
section .data
    dats    rmcs,"please define: label,name,nameLength,metas" ; what to ask
    rmcsz   equ $ - rmcs   ; length
codeEntry defGet,"rmc",3,4,[definitions]
    push rmcsz
    push rmcs
    call areaSay
    next
;
;    mov, push, pop, cmp, jz, jnz, jmp, call, ret, add, sub, rep , :, [,
;     rf,    s,   c,   p, tf, htf,   f,    h, fmh,  zn,  jn, rcs , m, r,
;     rf,    s,   c,   u, af, qaf,   f,    q, fmq,  zn,  jn, rcs , m, r,
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
codeEntry mq,"mq",2,0,[definitions] ; exit
    call good_exit; 
    next
codeEntry chara,"chara",5,0,[definitions] ; exit
    movr eax,"a"
    spush  eax,1;  ; ASCII value
    next
codeEntry syshAdd,"add",3,0,[definitions]
    ;spop eax
    ;spop ebx
    add eax,ebx
    ;spush eax
    next
section .data
    datr syshChar,0x00
codeEntry emit,"emit",4,0,[definitions]
    spop 1,eax
    movr [syshChar],eax
    movr ebx,syshChar
    push ebx
    call byteSay
    next
    
; codeEntry zi,"zi",2,0,definitions ; "-aware" followed by numbers
;    ; get nextword 
;    ; is char
;    ; push onto stack
;codeEntry ji,"ji",2,0,definitions ; "hear"
;    push codeEntryChar
;    call byteHear
;    ret
;section .bss
;    ress codeEntryChar,1
;    
;section .text
;    
;codeEntry ni,"ni",2,0,definitions ; "number-aware" followed by numbers
;    ; get next word
;    ; is char
;    ; is number
;    ; push onto stack
; 

; lists:w
; root
; definitions  (above)
; arguments

; root
linkEntry definitionsEntry,"definitions",11,areaN,[root],[definitions]
    ; set codeLink to list address
linkEntry argumentsEntry,"arguments",9,areaN,[root],[arguments]


codeEntry sput,"os",2,0x0,[definitions] ; ;0x25 argument say
    ; pushes depending on register number 
    ;	and eventually register size (from and to bit's default 32-bit registers, eax, ebx, ecx)
    ; args registerNumber whereStack
    ;  number  register	name
    ;	0	ebp	source ; of data or arguments
    ;	1	ebx
    ;	2	ecx
    ;	3	edx
    ;   4	esi
    ;   5	edi
    ;   	eflags
    ;		esp ; not currently usable ; for initial 
    ;		ebp ; simplicity
    spop 1,eax
    spop 2,ebx
; for loop
    cmpr eax,0
    jz s0
    cmpr eax,1
    jz s1
    cmpr eax,2
    jz s2
    cmpr eax,3
    jz s3
    cmpr eax,4
    jz s4
    cmpr eax,5
    jz s5
    cmpr eax,6
    jz s6
    next
s0: spush ebp,ebx
    next
s1: spush eax,ebx
    next
s2: spush ebx,ebx
    next
s3: spush ecx,ebx
    next
s4: spush edx,ebx
    next
s5: spush esi,ebx
    next
s6: spush edi,ebx
    next
;s7: spush eflag
codeEntry sget,"oj",1,0x0,[definitions] ; 0x26  oj ; argument hear
    ; pops depending on register number 
    ;	and eventually register size (from and to bit's default 32-bit registers, eax, ebx, ecx)
    ; args whereStack registerNumber 
    ;  number  register	name
    ;	0	ebp	source ; of data or arguments
    ;	1	ebx
    ;	2	ecx
    ;	3	edx
    ;   4	esi
    ;   5	edi
    ;   	eflags
    ;		esp ; not currently usable ; for initial 
    ;		ebp ; simplicity
    spop 1,ebx
    spop 2,eax
    cmpr eax,0
    jz j0
    cmpr eax,1
    jz j1
    cmpr eax,2
    jz j2
    cmpr eax,3
    jz j3
    cmpr eax,4
    jz j4
    cmpr eax,5
    jz j5
    cmpr eax,6
    jz j6
    next
j0: spop ebx,ebp
    next
j1: spop ebx,eax
    next
j2: spop ebx,ebx
    next
j3: spop ebx,ecx
    next
j4: spop ebx,edx
    next
j5: spop ebx,esi
    next
j6: spop ebx,edi
    next
    
