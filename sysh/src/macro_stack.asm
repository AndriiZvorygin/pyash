;   return stack macro
section .text
%macro spush 2 ; r d s ( round - area - put ) ; push sysh stack
	; args whatRegister whereStack
;lea ebp,[ebp+byteBase]
;addr ebp,byteBase
mov [syshStack+byteBase*%2],%1
%endmacro
%macro  spop 2
mov %2,[syshStack+byteBase*%1]
;lea ebp,[ebp-byteBase]
;subr ebp,byteBase
%endmacro
%macro spush 1 ; r d s ( round - area - put ) ; push sysh stack
	; args whatRegister whereStack
;lea ebp,[ebp+byteBase]
addr ebp,byteBase
mov ebp,%1
%endmacro
%macro  spop 1
mov %1,ebp
;lea ebp,[ebp-byteBase]
subr ebp,byteBase
%endmacro
