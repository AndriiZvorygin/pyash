#include "c_ir.h"

#include <ctype.h>
#include <string.h>

static void pya_emit_value(FILE *out, const pya_value *value);
static void pya_emit_sentence_inline(FILE *out, const pya_sentence *sentence);

static void pya_emit_text(FILE *out, const char *text) {
  fputs("text \"", out);
  if (text) {
    for (const char *p = text; *p; p++) {
      if (*p == '"' || *p == '\\') fputc('\\', out);
      fputc(*p, out);
    }
  }
  fputc('"', out);
}

static void pya_emit_name_ref(FILE *out, const pya_name_ref *name) {
  fputs("name", out);
  if (name && name->type && *name->type) {
    fputc(' ', out);
    fputs(name->type, out);
  }
  if (name && name->literal && *name->literal) {
    fputc(' ', out);
    fputs(name->literal, out);
  }
}

static void pya_emit_genitive(FILE *out, const pya_genitive *path) {
  if (!path) return;
  if (path->base_kind == PYA_BASE_THIS) {
    fputs("this", out);
  } else {
    pya_emit_name_ref(out, &path->base_name);
  }
  for (size_t i = 0; i < path->steps_len; i++) {
    fputs(" ti ", out);
    fputs(path->steps[i], out);
  }
}

static void pya_emit_vector(FILE *out, const pya_vector *vector) {
  fputs("ve", out);
  if (vector && vector->elem_type && *vector->elem_type) {
    fputc(' ', out);
    fputs(vector->elem_type, out);
  }
  if (!vector || !vector->values || vector->length == 0) return;
  for (size_t i = 0; i < vector->length; i++) {
    fputc(' ', out);
    pya_emit_value(out, &vector->values[i]);
  }
}

static void pya_emit_value(FILE *out, const pya_value *value) {
  if (!value) return;
  switch (value->kind) {
    case PYA_VALUE_NUM:
      fprintf(out, "num %g", value->as.num);
      break;
    case PYA_VALUE_TEXT:
      pya_emit_text(out, value->as.text);
      break;
    case PYA_VALUE_BOOL:
      fprintf(out, "bool %s", value->as.boolean ? "truth" : "lie");
      break;
    case PYA_VALUE_HOLLOW:
      fputs("hollow", out);
      break;
    case PYA_VALUE_UNSPEC:
      fputs("unspecified", out);
      break;
    case PYA_VALUE_NAME:
      pya_emit_name_ref(out, &value->as.name);
      break;
    case PYA_VALUE_THIS:
      fputs("this", out);
      break;
    case PYA_VALUE_PATH:
      pya_emit_genitive(out, &value->as.path);
      break;
    case PYA_VALUE_VECTOR:
      pya_emit_vector(out, &value->as.vector);
      break;
    case PYA_VALUE_MAP:
      fputs("map", out);
      break;
    case PYA_VALUE_SENTENCE:
      pya_emit_sentence_inline(out, value->as.sentence);
      break;
    default:
      fputs("hollow", out);
      break;
  }
}

static void pya_emit_sentence_inline(FILE *out, const pya_sentence *sentence) {
  if (!sentence) return;
  pya_emit_sentence(out, sentence);
}

void pya_emit_sentence(FILE *out, const pya_sentence *sentence) {
  if (!out || !sentence) return;

  if (sentence->exists && sentence->mood == PYA_MOOD_YA) {
    fputs("exists ", out);
  }

  struct {
    const char *keyword;
    uint32_t mask;
    const pya_value *value;
  } fields[] = {
    { "atindex", PYA_HAS_ATINDEX, &sentence->atindex },
    { "by", PYA_HAS_BY, &sentence->by },
    { "from", PYA_HAS_FROM, &sentence->from },
    { "fromindex", PYA_HAS_FROMINDEX, &sentence->fromindex },
    { "ob", PYA_HAS_OB, &sentence->ob },
    { "su", PYA_HAS_SU, &sentence->su },
    { "to", PYA_HAS_TO, &sentence->to },
    { "toindex", PYA_HAS_TOINDEX, &sentence->toindex }
  };

  int first = 1;
  for (size_t i = 0; i < sizeof(fields) / sizeof(fields[0]); i++) {
    if ((sentence->has_mask & fields[i].mask) == 0) continue;
    if (!first) fputc(' ', out);
    first = 0;
    fputs(fields[i].keyword, out);
    fputc(' ', out);
    pya_emit_value(out, fields[i].value);
  }

  if (sentence->be && *sentence->be) {
    if (!first) fputc(' ', out);
    first = 0;
    fputs("be ", out);
    fputs(sentence->be, out);
  }

  if (sentence->has_mask & PYA_HAS_THEN) {
    if (!first) fputc(' ', out);
    first = 0;
    fputs("then ", out);
    pya_emit_sentence_inline(out, sentence->then_sentence);
  }

  if (!first) fputc(' ', out);
  switch (sentence->mood) {
    case PYA_MOOD_YA:
      fputs("ya", out);
      break;
    case PYA_MOOD_DO:
      fputs("do", out);
      break;
    case PYA_MOOD_DEF:
      fputs("def", out);
      break;
    case PYA_MOOD_PRAH:
      fputs("prah", out);
      break;
    case PYA_MOOD_THEN:
      fputs("then", out);
      break;
    default:
      fputs("ya", out);
      break;
  }
  fputc('\n', out);
}
