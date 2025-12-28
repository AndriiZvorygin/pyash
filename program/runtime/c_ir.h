#ifndef PYA_C_IR_H
#define PYA_C_IR_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef enum {
  PYA_MOOD_YA = 0,
  PYA_MOOD_DO,
  PYA_MOOD_DEF,
  PYA_MOOD_PRAH,
  PYA_MOOD_THEN
} pya_mood;

typedef enum {
  PYA_VALUE_NUM = 0,
  PYA_VALUE_TEXT,
  PYA_VALUE_BOOL,
  PYA_VALUE_HOLLOW,
  PYA_VALUE_UNSPEC,
  PYA_VALUE_NAME,
  PYA_VALUE_THIS,
  PYA_VALUE_PATH,
  PYA_VALUE_VECTOR,
  PYA_VALUE_MAP,
  PYA_VALUE_SENTENCE
} pya_value_kind;

typedef struct {
  const char *type;
  const char *literal;
} pya_name_ref;

typedef enum {
  PYA_BASE_THIS = 0,
  PYA_BASE_NAME
} pya_genitive_base;

typedef struct {
  pya_genitive_base base_kind;
  pya_name_ref base_name;
  const char **steps;
  size_t steps_len;
} pya_genitive;

typedef struct pya_sentence pya_sentence;

typedef struct {
  const char *elem_type;
  struct pya_value *values;
  size_t length;
} pya_vector;

typedef struct {
  const char **keys;
  struct pya_value *values;
  size_t length;
} pya_map;

typedef struct pya_value {
  pya_value_kind kind;
  union {
    double num;
    const char *text;
    int boolean;
    pya_name_ref name;
    pya_genitive path;
    pya_vector vector;
    pya_map map;
    pya_sentence *sentence;
  } as;
} pya_value;

enum {
  PYA_HAS_SU = 1u << 0,
  PYA_HAS_OB = 1u << 1,
  PYA_HAS_TO = 1u << 2,
  PYA_HAS_FROM = 1u << 3,
  PYA_HAS_BY = 1u << 4,
  PYA_HAS_FROMINDEX = 1u << 5,
  PYA_HAS_TOINDEX = 1u << 6,
  PYA_HAS_ATINDEX = 1u << 7,
  PYA_HAS_THEN = 1u << 8
};

typedef struct pya_sentence {
  const char *be;
  pya_mood mood;
  int exists;
  uint32_t has_mask;
  pya_value su;
  pya_value ob;
  pya_value to;
  pya_value from;
  pya_value by;
  pya_value fromindex;
  pya_value toindex;
  pya_value atindex;
  pya_sentence *then_sentence;
} pya_sentence;

void pya_emit_sentence(FILE *out, const pya_sentence *sentence);

#endif
