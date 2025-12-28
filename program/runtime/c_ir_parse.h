#ifndef PYA_C_IR_PARSE_H
#define PYA_C_IR_PARSE_H

#include "c_ir.h"

#include <stddef.h>

int pya_parse_sentence(const char *input, pya_sentence *out, char *err, size_t err_cap);
void pya_free_sentence(pya_sentence *sentence);

#endif
