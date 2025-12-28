#include "c_ir_parse.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *pya_strdup(const char *s) {
  if (!s) return NULL;
  size_t len = strlen(s);
  char *out = (char *)malloc(len + 1);
  if (!out) return NULL;
  memcpy(out, s, len);
  out[len] = '\0';
  return out;
}

typedef struct {
  char **items;
  size_t count;
  char *storage;
  size_t storage_len;
} pya_tokens;

static void pya_set_err(char *err, size_t cap, const char *message) {
  if (!err || cap == 0) return;
  snprintf(err, cap, "%s", message ? message : "parse error");
}

static int pya_tokenize(const char *input, pya_tokens *out, char *err, size_t err_cap) {
  if (!out || !input) return 0;
  size_t len = strlen(input);
  char *storage = (char *)malloc(len + 1);
  char **items = (char **)malloc(sizeof(char *) * (len + 1));
  if (!storage || !items) {
    free(storage);
    free(items);
    pya_set_err(err, err_cap, "parse error");
    return 0;
  }
  size_t count = 0;
  size_t pos = 0;
  size_t write = 0;
  while (pos < len) {
    while (pos < len && isspace((unsigned char)input[pos])) pos++;
    if (pos >= len) break;
    items[count++] = &storage[write];
    if (input[pos] == '"') {
      pos++;
      while (pos < len && input[pos] != '"') {
        if (input[pos] == '\\' && pos + 1 < len) {
          pos++;
        }
        storage[write++] = input[pos++];
      }
      if (pos < len && input[pos] == '"') pos++;
    } else {
      while (pos < len && !isspace((unsigned char)input[pos])) {
        storage[write++] = input[pos++];
      }
    }
    storage[write++] = '\0';
  }
  out->items = items;
  out->count = count;
  out->storage = storage;
  out->storage_len = write;
  return 1;
}

static void pya_tokens_free(pya_tokens *tokens) {
  if (!tokens) return;
  free(tokens->items);
  free(tokens->storage);
  tokens->items = NULL;
  tokens->storage = NULL;
  tokens->count = 0;
}

static int pya_is_mood(const char *token, pya_mood *out) {
  if (!token) return 0;
  if (strcmp(token, "ya") == 0) { *out = PYA_MOOD_YA; return 1; }
  if (strcmp(token, "do") == 0) { *out = PYA_MOOD_DO; return 1; }
  if (strcmp(token, "def") == 0) { *out = PYA_MOOD_DEF; return 1; }
  if (strcmp(token, "prah") == 0) { *out = PYA_MOOD_PRAH; return 1; }
  if (strcmp(token, "then") == 0) { *out = PYA_MOOD_THEN; return 1; }
  return 0;
}

static int pya_is_type_word(const char *token) {
  if (!token) return 0;
  return strcmp(token, "num") == 0
    || strcmp(token, "text") == 0
    || strcmp(token, "bool") == 0
    || strcmp(token, "name") == 0
    || strcmp(token, "hollow") == 0
    || strcmp(token, "ve") == 0
    || strcmp(token, "vec") == 0
    || strcmp(token, "map") == 0
    || strcmp(token, "json") == 0
    || strcmp(token, "csv") == 0
    || strcmp(token, "filename") == 0
    || strcmp(token, "pyash") == 0
    || strcmp(token, "english") == 0
    || strcmp(token, "javascript") == 0;
}

static void pya_value_clear(pya_value *value) {
  if (!value) return;
  memset(value, 0, sizeof(*value));
  value->kind = PYA_VALUE_UNSPEC;
}

static int pya_is_case_word(const char *token) {
  if (!token) return 0;
  return strcmp(token, "su") == 0
    || strcmp(token, "ob") == 0
    || strcmp(token, "to") == 0
    || strcmp(token, "from") == 0
    || strcmp(token, "by") == 0
    || strcmp(token, "fromindex") == 0
    || strcmp(token, "toindex") == 0
    || strcmp(token, "atindex") == 0
    || strcmp(token, "be") == 0
    || strcmp(token, "then") == 0;
}

static int pya_vector_elem_kind(const char *type, pya_value_kind *out_kind) {
  if (!type || !out_kind) return 0;
  if (strcmp(type, "num") == 0) { *out_kind = PYA_VALUE_NUM; return 1; }
  if (strcmp(type, "text") == 0) { *out_kind = PYA_VALUE_TEXT; return 1; }
  if (strcmp(type, "bool") == 0) { *out_kind = PYA_VALUE_BOOL; return 1; }
  if (strcmp(type, "name") == 0) { *out_kind = PYA_VALUE_NAME; return 1; }
  if (strcmp(type, "hollow") == 0) { *out_kind = PYA_VALUE_HOLLOW; return 1; }
  return 0;
}

static int pya_parse_value(char **tokens, size_t count, size_t *idx, pya_value *out, char *err, size_t err_cap) {
  if (!tokens || !idx || !out || *idx >= count) return 0;
  const char *token = tokens[*idx];
  if (!token) return 0;

  if (strcmp(token, "num") == 0) {
    if (*idx + 1 >= count) { pya_set_err(err, err_cap, "parse error"); return 0; }
    const char *lit = tokens[*idx + 1];
    char *end = NULL;
    double value = strtod(lit, &end);
    if (!end || *end != '\0') { pya_set_err(err, err_cap, "parse error"); return 0; }
    out->kind = PYA_VALUE_NUM;
    out->as.num = value;
    *idx += 2;
    return 1;
  }
  if (strcmp(token, "text") == 0) {
    if (*idx + 1 >= count) { pya_set_err(err, err_cap, "parse error"); return 0; }
    const char *lit = tokens[*idx + 1];
    out->kind = PYA_VALUE_TEXT;
    out->as.text = pya_strdup(lit ? lit : "");
    *idx += 2;
    return 1;
  }
  if (strcmp(token, "bool") == 0) {
    if (*idx + 1 >= count) { pya_set_err(err, err_cap, "parse error"); return 0; }
    const char *lit = tokens[*idx + 1];
    out->kind = PYA_VALUE_BOOL;
    out->as.boolean = (strcmp(lit, "truth") == 0) ? 1 : 0;
    *idx += 2;
    return 1;
  }
  if (strcmp(token, "hollow") == 0) {
    out->kind = PYA_VALUE_HOLLOW;
    *idx += 1;
    return 1;
  }
  if (strcmp(token, "unspecified") == 0) {
    out->kind = PYA_VALUE_UNSPEC;
    *idx += 1;
    return 1;
  }

  if (strcmp(token, "ve") == 0 || strcmp(token, "vec") == 0) {
    *idx += 1;
    const char *elem_type = "num";
    if (*idx < count && pya_is_type_word(tokens[*idx])) {
      elem_type = tokens[*idx];
      *idx += 1;
    }
    if (strcmp(elem_type, "hollow") == 0) {
      out->kind = PYA_VALUE_VECTOR;
      out->as.vector.elem_type = pya_strdup(elem_type);
      out->as.vector.values = NULL;
      out->as.vector.length = 0;
      return 1;
    }
    pya_value_kind elem_kind;
    if (!pya_vector_elem_kind(elem_type, &elem_kind)) {
      pya_set_err(err, err_cap, "parse error");
      return 0;
    }
    size_t cap = 0;
    size_t length = 0;
    pya_value *values = NULL;
    while (*idx < count) {
      const char *next = tokens[*idx];
      if (pya_is_case_word(next) || pya_is_mood(next, &(pya_mood){0})) break;
      if (length >= cap) {
        size_t next_cap = cap == 0 ? 4 : cap * 2;
        pya_value *next_vals = (pya_value *)realloc(values, sizeof(pya_value) * next_cap);
        if (!next_vals) { free(values); pya_set_err(err, err_cap, "parse error"); return 0; }
        values = next_vals;
        cap = next_cap;
      }
      pya_value_clear(&values[length]);
      if (elem_kind == PYA_VALUE_NUM) {
        char *end = NULL;
        double val = strtod(next, &end);
        if (!end || *end != '\0') { free(values); pya_set_err(err, err_cap, "parse error"); return 0; }
        values[length].kind = PYA_VALUE_NUM;
        values[length].as.num = val;
      } else if (elem_kind == PYA_VALUE_TEXT) {
        values[length].kind = PYA_VALUE_TEXT;
        values[length].as.text = pya_strdup(next ? next : "");
      } else if (elem_kind == PYA_VALUE_BOOL) {
        values[length].kind = PYA_VALUE_BOOL;
        values[length].as.boolean = (strcmp(next, "truth") == 0) ? 1 : 0;
      } else if (elem_kind == PYA_VALUE_NAME) {
        values[length].kind = PYA_VALUE_NAME;
        values[length].as.name.type = NULL;
        values[length].as.name.literal = pya_strdup(next ? next : "");
      }
      length += 1;
      *idx += 1;
    }
    out->kind = PYA_VALUE_VECTOR;
    out->as.vector.elem_type = pya_strdup(elem_type);
    out->as.vector.values = values;
    out->as.vector.length = length;
    return 1;
  }

  pya_genitive gen = {0};
  size_t start = *idx;
  int has_base = 0;
  if (strcmp(token, "this") == 0) {
    gen.base_kind = PYA_BASE_THIS;
    has_base = 1;
    *idx += 1;
  } else if (strcmp(token, "name") == 0) {
    if (*idx + 1 >= count) { pya_set_err(err, err_cap, "parse error"); return 0; }
    const char *next = tokens[*idx + 1];
    const char *type = NULL;
    const char *lit = NULL;
    if (pya_is_type_word(next) && *idx + 2 < count) {
      type = next;
      lit = tokens[*idx + 2];
      *idx += 3;
    } else {
      lit = next;
      *idx += 2;
    }
    gen.base_kind = PYA_BASE_NAME;
    gen.base_name.type = type ? pya_strdup(type) : NULL;
    gen.base_name.literal = lit ? pya_strdup(lit) : NULL;
    has_base = 1;
  }

  if (has_base) {
    size_t steps_cap = 0;
    size_t steps_len = 0;
    const char **steps = NULL;
    while (*idx + 1 < count && strcmp(tokens[*idx], "ti") == 0) {
      const char *step = tokens[*idx + 1];
      if (steps_len >= steps_cap) {
        size_t next_cap = steps_cap == 0 ? 4 : steps_cap * 2;
        const char **next = (const char **)realloc((void *)steps, sizeof(char *) * next_cap);
        if (!next) { pya_set_err(err, err_cap, "parse error"); return 0; }
        steps = next;
        steps_cap = next_cap;
      }
      steps[steps_len++] = pya_strdup(step ? step : "");
      *idx += 2;
    }
    if (steps_len > 0) {
      gen.steps = steps;
      gen.steps_len = steps_len;
      out->kind = PYA_VALUE_PATH;
      out->as.path = gen;
      return 1;
    }
    if (gen.base_kind == PYA_BASE_THIS) {
      out->kind = PYA_VALUE_THIS;
      out->as.name.type = NULL;
      out->as.name.literal = NULL;
    } else {
      out->kind = PYA_VALUE_NAME;
      out->as.name = gen.base_name;
    }
    free(steps);
    return 1;
  }

  pya_set_err(err, err_cap, "parse error");
  *idx = start;
  return 0;
}

static int pya_parse_sentence_tokens(char **tokens, size_t start, size_t end, pya_sentence *out, char *err, size_t err_cap) {
  memset(out, 0, sizeof(*out));
  out->mood = PYA_MOOD_YA;
  pya_value_clear(&out->su);
  pya_value_clear(&out->ob);
  pya_value_clear(&out->to);
  pya_value_clear(&out->from);
  pya_value_clear(&out->by);
  pya_value_clear(&out->fromindex);
  pya_value_clear(&out->toindex);
  pya_value_clear(&out->atindex);

  size_t idx = start;
  while (idx < end) {
    const char *token = tokens[idx];
    if (!token) { idx++; continue; }
    if (strcmp(token, "exists") == 0) {
      out->exists = 1;
      idx++;
      continue;
    }
    if (strcmp(token, "be") == 0) {
      if (idx + 1 >= end) { pya_set_err(err, err_cap, "parse error"); return 0; }
      if (idx + 2 < end && ((strcmp(tokens[idx + 1], "json") == 0 || strcmp(tokens[idx + 1], "csv") == 0) && strcmp(tokens[idx + 2], "map") == 0)) {
        char joined[64];
        snprintf(joined, sizeof(joined), "%s map", tokens[idx + 1]);
        out->be = pya_strdup(joined);
        idx += 3;
      } else {
        out->be = pya_strdup(tokens[idx + 1]);
        idx += 2;
      }
      continue;
    }
    if (strcmp(token, "then") == 0) {
      if (idx + 1 >= end) { pya_set_err(err, err_cap, "parse error"); return 0; }
      pya_sentence *child = (pya_sentence *)calloc(1, sizeof(pya_sentence));
      if (!child) { pya_set_err(err, err_cap, "parse error"); return 0; }
      if (!pya_parse_sentence_tokens(tokens, idx + 1, end, child, err, err_cap)) {
        free(child);
        return 0;
      }
      child->mood = out->mood;
      out->then_sentence = child;
      out->has_mask |= PYA_HAS_THEN;
      return 1;
    }
    struct {
      const char *keyword;
      uint32_t mask;
      pya_value *value;
    } cases[] = {
      { "su", PYA_HAS_SU, &out->su },
      { "ob", PYA_HAS_OB, &out->ob },
      { "to", PYA_HAS_TO, &out->to },
      { "from", PYA_HAS_FROM, &out->from },
      { "by", PYA_HAS_BY, &out->by },
      { "fromindex", PYA_HAS_FROMINDEX, &out->fromindex },
      { "toindex", PYA_HAS_TOINDEX, &out->toindex },
      { "atindex", PYA_HAS_ATINDEX, &out->atindex }
    };
    int matched = 0;
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
      if (strcmp(token, cases[i].keyword) == 0) {
        idx++;
        if (!pya_parse_value(tokens, end, &idx, cases[i].value, err, err_cap)) return 0;
        out->has_mask |= cases[i].mask;
        matched = 1;
        break;
      }
    }
    if (matched) continue;

    pya_set_err(err, err_cap, "parse error");
    return 0;
  }
  return 1;
}

int pya_parse_sentence(const char *input, pya_sentence *out, char *err, size_t err_cap) {
  if (!input || !out) return 0;
  pya_tokens tokens = {0};
  if (!pya_tokenize(input, &tokens, err, err_cap)) return 0;
  if (tokens.count == 0) {
    pya_tokens_free(&tokens);
    pya_set_err(err, err_cap, "parse error");
    return 0;
  }
  pya_mood mood = PYA_MOOD_YA;
  size_t end = tokens.count;
  if (pya_is_mood(tokens.items[tokens.count - 1], &mood)) {
    end = tokens.count - 1;
  } else {
    pya_tokens_free(&tokens);
    pya_set_err(err, err_cap, "parse error");
    return 0;
  }
  if (!pya_parse_sentence_tokens(tokens.items, 0, end, out, err, err_cap)) {
    pya_tokens_free(&tokens);
    return 0;
  }
  out->mood = mood;
  pya_tokens_free(&tokens);
  return 1;
}

void pya_free_sentence(pya_sentence *sentence) {
  if (!sentence) return;
  if (sentence->be) free((void *)sentence->be);
  pya_value *values[] = {
    &sentence->su,
    &sentence->ob,
    &sentence->to,
    &sentence->from,
    &sentence->by,
    &sentence->fromindex,
    &sentence->toindex,
    &sentence->atindex
  };
  for (size_t i = 0; i < sizeof(values) / sizeof(values[0]); i++) {
    pya_value *value = values[i];
    if (!value) continue;
    if (value->kind == PYA_VALUE_TEXT && value->as.text) {
      free((void *)value->as.text);
    } else if (value->kind == PYA_VALUE_NAME) {
      free((void *)value->as.name.type);
      free((void *)value->as.name.literal);
    } else if (value->kind == PYA_VALUE_PATH) {
      free((void *)value->as.path.base_name.type);
      free((void *)value->as.path.base_name.literal);
      for (size_t j = 0; j < value->as.path.steps_len; j++) {
        free((void *)value->as.path.steps[j]);
      }
      free((void *)value->as.path.steps);
    } else if (value->kind == PYA_VALUE_VECTOR) {
      if (value->as.vector.elem_type) free((void *)value->as.vector.elem_type);
      for (size_t j = 0; j < value->as.vector.length; j++) {
        pya_value *elem = &value->as.vector.values[j];
        if (elem->kind == PYA_VALUE_TEXT && elem->as.text) {
          free((void *)elem->as.text);
        } else if (elem->kind == PYA_VALUE_NAME) {
          free((void *)elem->as.name.type);
          free((void *)elem->as.name.literal);
        }
      }
      free(value->as.vector.values);
    }
  }
  if (sentence->then_sentence) {
    pya_free_sentence(sentence->then_sentence);
    free(sentence->then_sentence);
  }
}
