; Minimal Sysh-style runtime interpreter for the PyAC VLIW file contract.
; V1 executes named ASCII text declarations and `write` sentences only.
bits 32

%define PYAC_HEADER_BYTES 32
%define PYAC_RECORD_BYTES 32
%define MAX_GROUP_WORDS 32768

section .data
usage_message: db "pyac-run: usage: pyac-run <program.pyac>", 10
usage_message_len equ $ - usage_message
io_message: db "pyac-run: cannot open or map PyAC input", 10
io_message_len equ $ - io_message
format_message: db "pyac-run: invalid or truncated PyAC VLIW pack", 10
format_message_len equ $ - format_message
unsupported_message: db "pyac-run: unsupported sentence; V1 supports named ASCII text declarations and write", 10
unsupported_message_len equ $ - unsupported_message
capacity_message: db "pyac-run: sentence exceeds the V1 interpreter's 32768-word limit", 10
capacity_message_len equ $ - capacity_message

section .bss
file_descriptor: resd 1
file_size: resd 1
mapped_address: resd 1
record_count: resd 1
vector_pointer: resd 1
vectors_remaining: resd 1
vector_header: resd 1
vector_completion: resd 1
slot_cursor: resd 1
group_word_count: resd 1
declared_text: resd 1
write_count: resd 1
text_length: resd 1
io_pointer: resd 1
io_remaining: resd 1
group_words: resw MAX_GROUP_WORDS
group_boundaries: resb MAX_GROUP_WORDS
program_text: resb MAX_GROUP_WORDS

section .text
global _start

_start:
    ; Require exactly one positional input path.
    mov eax, [esp]
    cmp eax, 2
    jne usage_error

    ; Open the PyAC pack and obtain its complete byte length.
    mov ebx, [esp + 8]
    xor ecx, ecx
    xor edx, edx
    mov eax, 5
    int 0x80
    test eax, eax
    js io_error
    mov [file_descriptor], eax

    mov ebx, eax
    xor ecx, ecx
    mov edx, 2
    mov eax, 19
    int 0x80
    test eax, eax
    js io_error
    cmp eax, 0x7fffffff
    ja format_error
    mov [file_size], eax
    cmp eax, PYAC_HEADER_BYTES
    jb format_error

    ; Map the complete file read-only/private. mmap2 takes its offset in pages.
    xor ebx, ebx
    mov ecx, [file_size]
    mov edx, 1
    mov esi, 2
    mov edi, [file_descriptor]
    xor ebp, ebp
    mov eax, 192
    int 0x80
    cmp eax, 0xfffff001
    jae io_error
    mov [mapped_address], eax

    ; Validate magic, format, word layout, and exact record length.
    mov esi, eax
    cmp dword [esi], 0x43415950       ; little-endian "PYAC"
    jne format_error
    cmp dword [esi + 4], 0x57494c56   ; little-endian "VLIW"
    jne format_error
    cmp word [esi + 8], 1             ; format version
    jne format_error
    cmp word [esi + 10], 16           ; uint16 word width
    jne format_error
    cmp word [esi + 12], 16           ; words per codelet
    jne format_error
    cmp word [esi + 14], PYAC_HEADER_BYTES
    jne format_error
    cmp dword [esi + 20], PYAC_RECORD_BYTES
    jne format_error
    cmp dword [esi + 28], 0           ; reserved header word
    jne format_error

    mov eax, [esi + 16]
    test eax, eax
    jz format_error
    cmp eax, 0x03fffffe              ; keep 32-bit size arithmetic in range
    ja format_error
    mov [record_count], eax
    shl eax, 5
    add eax, PYAC_HEADER_BYTES
    cmp eax, [esi + 24]
    jne format_error
    cmp eax, [file_size]
    jne format_error

    ; The file is mapped, so the descriptor is no longer needed.
    mov ebx, [file_descriptor]
    mov eax, 6
    int 0x80

    lea eax, [esi + PYAC_HEADER_BYTES]
    mov [vector_pointer], eax
    mov eax, [record_count]
    mov [vectors_remaining], eax
    mov dword [group_word_count], 0
    mov dword [declared_text], 0
    mov dword [write_count], 0

read_vector:
    cmp dword [vectors_remaining], 0
    je program_complete

    mov esi, [vector_pointer]
    movzx eax, word [esi]
    mov [vector_header], eax
    and eax, 1
    mov [vector_completion], eax
    mov dword [slot_cursor], 1

read_slot:
    mov esi, [vector_pointer]
    mov ecx, [slot_cursor]
    movzx eax, word [esi + ecx * 2]
    test eax, eax
    jz check_padding

    mov edx, [group_word_count]
    cmp edx, MAX_GROUP_WORDS
    jae capacity_error
    mov [group_words + edx * 2], ax

    ; A slot is a phrase boundary exactly when its bit matches completion bit 0.
    mov eax, [vector_header]
    mov ecx, [slot_cursor]
    shr eax, cl
    and eax, 1
    cmp eax, [vector_completion]
    sete al
    mov [group_boundaries + edx], al
    inc edx
    mov [group_word_count], edx
    jmp next_slot

check_padding:
    ; Zero terminates this vector's payload; all remaining payload words must be zero.
    inc dword [slot_cursor]
    cmp dword [slot_cursor], 16
    jae vector_complete
    mov esi, [vector_pointer]
    mov ecx, [slot_cursor]
    cmp word [esi + ecx * 2], 0
    jne format_error
    jmp check_padding

next_slot:
    inc dword [slot_cursor]
    cmp dword [slot_cursor], 16
    jb read_slot

vector_complete:
    add dword [vector_pointer], PYAC_RECORD_BYTES
    dec dword [vectors_remaining]
    cmp dword [vector_completion], 0
    je read_vector

    ; Completion bit closes one sentence group; dispatch its canonical pattern.
    call interpret_group
    mov dword [group_word_count], 0
    jmp read_vector

program_complete:
    cmp dword [group_word_count], 0
    jne format_error
    cmp dword [declared_text], 1
    jne unsupported_error
    cmp dword [write_count], 0
    je unsupported_error

    ; Exit successfully after all VLIW sentences have been interpreted.
    xor ebx, ebx
    mov eax, 1
    int 0x80

; Decode one complete sentence group and run its supported operation.
interpret_group:
    cmp dword [group_word_count], 5
    jb unsupported_error

    ; Shared prefix: name_ text <case> ...
    cmp word [group_words], 0x225e    ; name_ quote/type
    jne unsupported_error
    cmp word [group_words + 2], 0x8a28 ; canonical HNUC for "text"
    jne unsupported_error

    ; Declaration: su name text ob text "..." ya.
    cmp word [group_words + 4], 0x24de ; nominative case
    jne try_write
    cmp byte [group_boundaries + 2], 1
    jne format_error
    cmp word [group_words + 6], 0x0e1d ; paragraph-letter text quote
    jne unsupported_error
    movzx eax, word [group_words + 8]
    test eax, eax
    jz unsupported_error
    cmp eax, MAX_GROUP_WORDS - 8
    ja capacity_error
    mov [text_length], eax
    lea ebx, [eax + 8]               ; 5-word prefix + chars + case/verb/mood
    cmp ebx, [group_word_count]
    jne unsupported_error

    ; The quote's declared length locates the accusative case boundary.
    mov eax, [text_length]
    add eax, 5
    mov edx, eax
    shl edx, 1
    cmp word [group_words + edx], 0x245e ; accusative case
    jne unsupported_error
    cmp byte [group_boundaries + eax], 1
    jne format_error
    inc eax
    mov edx, eax
    shl edx, 1
    cmp word [group_words + edx], 0x8a28 ; text verb
    jne unsupported_error
    inc eax
    mov edx, eax
    shl edx, 1
    cmp word [group_words + edx], 0x217e ; realis mood
    jne unsupported_error
    cmp byte [group_boundaries + eax], 1
    jne format_error

    ; V1 stores ASCII bytes; reject non-ASCII rather than corrupting UTF-8.
    mov esi, 5
    xor edi, edi
copy_text:
    cmp edi, [text_length]
    jae text_copied
    mov eax, esi
    shl eax, 1
    movzx edx, word [group_words + eax]
    test edx, edx
    jz unsupported_error
    cmp edx, 0x7f
    ja unsupported_error
    mov [program_text + edi], dl
    inc esi
    inc edi
    jmp copy_text

text_copied:
    cmp dword [declared_text], 0
    jne unsupported_error
    mov dword [declared_text], 1
    ret

try_write:
    ; Write: ob name text be write do.
    cmp dword [group_word_count], 5
    jne unsupported_error
    cmp word [group_words + 4], 0x245e ; accusative case
    jne unsupported_error
    cmp byte [group_boundaries + 2], 1
    jne format_error
    cmp word [group_words + 6], 0xa80b ; canonical HNUC for "write"
    jne unsupported_error
    cmp word [group_words + 8], 0x295e ; deontic mood
    jne unsupported_error
    cmp byte [group_boundaries + 4], 1
    jne format_error
    cmp dword [declared_text], 1
    jne unsupported_error

    ; The selected handler writes the declared bytes, then Pyash's write newline.
    mov ecx, program_text
    mov edx, [text_length]
    call write_all
    mov ecx, newline
    mov edx, 1
    call write_all
    inc dword [write_count]
    ret

write_all:
    mov [io_pointer], ecx
    mov [io_remaining], edx
write_loop:
    cmp dword [io_remaining], 0
    je write_done
    mov ebx, 1
    mov ecx, [io_pointer]
    mov edx, [io_remaining]
    mov eax, 4
    int 0x80
    test eax, eax
    jle io_error
    add [io_pointer], eax
    sub [io_remaining], eax
    jmp write_loop
write_done:
    ret

usage_error:
    mov ecx, usage_message
    mov edx, usage_message_len
    jmp print_error
io_error:
    mov ecx, io_message
    mov edx, io_message_len
    jmp print_error
format_error:
    mov ecx, format_message
    mov edx, format_message_len
    jmp print_error
unsupported_error:
    mov ecx, unsupported_message
    mov edx, unsupported_message_len
    jmp print_error
capacity_error:
    mov ecx, capacity_message
    mov edx, capacity_message_len
print_error:
    mov ebx, 2
    mov eax, 4
    int 0x80
    mov ebx, 1
    mov eax, 1
    int 0x80

section .rodata
newline: db 10
