export const KNOWLEDGE_CORE_HELPER = `#include <stdarg.h>
#define PYA_KNOWLEDGE_MAX 256
#define PYA_KNOWLEDGE_VIEW_CAP (PYA_TEXT_CAP * 16)
typedef struct {
  char key[PYA_TEXT_CAP];
  char payload_json[PYA_TEXT_CAP];
  char evidential[32];
  double confidence;
  char anchor_id[PYA_TEXT_CAP];
  char sentence[PYA_TEXT_CAP];
} pya_knowledge_record;
static pya_knowledge_record pya_knowledge_records[PYA_KNOWLEDGE_MAX];
static size_t pya_knowledge_record_count = 0;
static void pya_knowledge_fail(const char *field) {
  fprintf(stderr, "knowledge core defective: %s exceeds supported capacity\\n", field ? field : "value");
  exit(1);
}
static void pya_knowledge_copy(char *destination, size_t capacity, const char *source, const char *field) {
  if (!destination || capacity == 0) pya_knowledge_fail(field);
  int written = snprintf(destination, capacity, "%s", source ? source : "");
  if (written < 0 || (size_t)written >= capacity) pya_knowledge_fail(field);
}
static void pya_knowledge_add(const char *key, const char *payload_json, const char *evidential, double confidence, const char *anchor_id, const char *sentence) {
  if (pya_knowledge_record_count >= PYA_KNOWLEDGE_MAX) pya_knowledge_fail("record count");
  pya_knowledge_record *record = &pya_knowledge_records[pya_knowledge_record_count++];
  pya_knowledge_copy(record->key, sizeof(record->key), key, "claim key");
  pya_knowledge_copy(record->payload_json, sizeof(record->payload_json), payload_json ? payload_json : "{\\"hollow\\":true}", "payload");
  pya_knowledge_copy(record->evidential, sizeof(record->evidential), evidential, "evidential");
  record->confidence = confidence;
  pya_knowledge_copy(record->anchor_id, sizeof(record->anchor_id), anchor_id, "source anchor");
  pya_knowledge_copy(record->sentence, sizeof(record->sentence), sentence, "evidence sentence");
}
static void pya_knowledge_clear(void) {
  pya_knowledge_record_count = 0;
}
static void pya_knowledge_append(char *out, size_t cap, size_t *used, const char *format, ...) {
  if (!out || !used || *used >= cap) pya_knowledge_fail("resolver output");
  va_list args;
  va_start(args, format);
  int written = vsnprintf(out + *used, cap - *used, format, args);
  va_end(args);
  if (written < 0) pya_knowledge_fail("resolver output");
  if ((size_t)written >= cap - *used) {
    pya_knowledge_fail("resolver output");
  } else {
    *used += (size_t)written;
  }
}
static void pya_knowledge_append_json(char *out, size_t cap, size_t *used, const char *value) {
  pya_knowledge_append(out, cap, used, "\\\"");
  for (const unsigned char *cursor = (const unsigned char *)(value ? value : ""); *cursor; cursor++) {
    if (*cursor == '\\"') pya_knowledge_append(out, cap, used, "\\\\\\\"");
    else if (*cursor == '\\\\') pya_knowledge_append(out, cap, used, "\\\\\\\\");
    else if (*cursor == '\\b') pya_knowledge_append(out, cap, used, "\\\\b");
    else if (*cursor == '\\f') pya_knowledge_append(out, cap, used, "\\\\f");
    else if (*cursor == '\\n') pya_knowledge_append(out, cap, used, "\\\\n");
    else if (*cursor == '\\r') pya_knowledge_append(out, cap, used, "\\\\r");
    else if (*cursor == '\\t') pya_knowledge_append(out, cap, used, "\\\\t");
    else if (*cursor < 0x20) pya_knowledge_append(out, cap, used, "\\\\u%04x", (unsigned int)*cursor);
    else pya_knowledge_append(out, cap, used, "%c", *cursor);
  }
  pya_knowledge_append(out, cap, used, "\\\"");
}
static void pya_knowledge_anchor_parts(const pya_knowledge_record *record, char *source, size_t source_cap, char *anchor, size_t anchor_cap) {
  if (source && source_cap) source[0] = '\\0';
  if (anchor && anchor_cap) anchor[0] = '\\0';
  if (!record || !record->anchor_id[0] || !source || !anchor || !source_cap || !anchor_cap) pya_knowledge_fail("source anchor");
  const char *separator = strchr(record->anchor_id, '#');
  if (!separator || separator == record->anchor_id || !separator[1]) pya_knowledge_fail("source anchor");
  size_t source_length = (size_t)(separator - record->anchor_id);
  if (source_length >= source_cap) pya_knowledge_fail("source anchor");
  memcpy(source, record->anchor_id, source_length);
  source[source_length] = '\\0';
  pya_knowledge_copy(anchor, anchor_cap, separator + 1, "source anchor");
}
static int pya_knowledge_provenance_compare(const pya_knowledge_record *left, const pya_knowledge_record *right) {
  int anchor = strcmp(left->anchor_id, right->anchor_id);
  if (anchor != 0) return anchor;
  if (left->confidence != right->confidence) return left->confidence > right->confidence ? -1 : 1;
  return strcmp(left->sentence, right->sentence);
}
static int pya_knowledge_duplicate_compare(const pya_knowledge_record *left, const pya_knowledge_record *right) {
  double left_confidence = left->confidence < 0 ? -1 : left->confidence;
  double right_confidence = right->confidence < 0 ? -1 : right->confidence;
  if (left_confidence != right_confidence) return left_confidence > right_confidence ? -1 : 1;
  return pya_knowledge_provenance_compare(left, right);
}
static void pya_knowledge_append_record(char *out, size_t cap, size_t *used, const pya_knowledge_record *record) {
  char source[PYA_TEXT_CAP];
  char anchor[PYA_TEXT_CAP];
  pya_knowledge_anchor_parts(record, source, sizeof(source), anchor, sizeof(anchor));
  pya_knowledge_append(out, cap, used, "{\\\"key\\\":");
  pya_knowledge_append_json(out, cap, used, record->key);
  pya_knowledge_append(out, cap, used, ",\\\"payload\\\":%s,\\\"evidential\\\":", record->payload_json[0] ? record->payload_json : "{\\\"hollow\\\":true}");
  pya_knowledge_append_json(out, cap, used, record->evidential);
  pya_knowledge_append(out, cap, used, ",\\\"confidence\\\":");
  if (record->confidence < 0) pya_knowledge_append(out, cap, used, "null");
  else pya_knowledge_append(out, cap, used, "%g", record->confidence);
  pya_knowledge_append(out, cap, used, ",\\\"source\\\":");
  if (source[0]) pya_knowledge_append_json(out, cap, used, source);
  else pya_knowledge_append(out, cap, used, "null");
  pya_knowledge_append(out, cap, used, ",\\\"anchor\\\":");
  if (anchor[0]) pya_knowledge_append_json(out, cap, used, anchor);
  else pya_knowledge_append(out, cap, used, "null");
  pya_knowledge_append(out, cap, used, ",\\\"anchorId\\\":");
  if (record->anchor_id[0]) pya_knowledge_append_json(out, cap, used, record->anchor_id);
  else pya_knowledge_append(out, cap, used, "null");
  pya_knowledge_append(out, cap, used, ",\\\"sentence\\\":");
  pya_knowledge_append_json(out, cap, used, record->sentence);
  pya_knowledge_append(out, cap, used, "}");
}
static size_t pya_knowledge_select(const char *key, size_t selected[]) {
  size_t selected_count = 0;
  for (size_t index = 0; index < pya_knowledge_record_count; index++) {
    pya_knowledge_record *record = &pya_knowledge_records[index];
    if (strcmp(record->key, key ? key : "") != 0) continue;
    size_t duplicate = selected_count;
    for (size_t selected_index = 0; selected_index < selected_count; selected_index++) {
      if (strcmp(pya_knowledge_records[selected[selected_index]].payload_json, record->payload_json) == 0) {
        duplicate = selected_index;
        break;
      }
    }
    if (duplicate == selected_count) selected[selected_count++] = index;
    else if (pya_knowledge_duplicate_compare(record, &pya_knowledge_records[selected[duplicate]]) < 0) selected[duplicate] = index;
  }
  for (size_t left = 0; left < selected_count; left++) {
    for (size_t right = left + 1; right < selected_count; right++) {
      if (strcmp(pya_knowledge_records[selected[right]].payload_json, pya_knowledge_records[selected[left]].payload_json) < 0) {
        size_t swap = selected[left];
        selected[left] = selected[right];
        selected[right] = swap;
      }
    }
  }
  return selected_count;
}
static size_t pya_knowledge_match(const char *key, size_t matching[]) {
  size_t matching_count = 0;
  for (size_t index = 0; index < pya_knowledge_record_count; index++) {
    if (strcmp(pya_knowledge_records[index].key, key ? key : "") == 0) matching[matching_count++] = index;
  }
  for (size_t left = 0; left < matching_count; left++) {
    for (size_t right = left + 1; right < matching_count; right++) {
      if (pya_knowledge_provenance_compare(&pya_knowledge_records[matching[right]], &pya_knowledge_records[matching[left]]) < 0) {
        size_t swap = matching[left];
        matching[left] = matching[right];
        matching[right] = swap;
      }
    }
  }
  return matching_count;
}
static const char *pya_knowledge_render_current(const char *key) {
  static char output[PYA_KNOWLEDGE_VIEW_CAP];
  size_t selected[PYA_KNOWLEDGE_MAX];
  size_t selected_count = pya_knowledge_select(key, selected);
  size_t used = 0;
  output[0] = '\\0';
  pya_knowledge_append(output, sizeof(output), &used, "{\\\"view\\\":\\\"current\\\",\\\"key\\\":");
  pya_knowledge_append_json(output, sizeof(output), &used, key ? key : "");
  pya_knowledge_append(output, sizeof(output), &used, ",\\\"status\\\":\\\"");
  pya_knowledge_append(output, sizeof(output), &used, selected_count == 0 ? "unrelated" : (selected_count > 1 ? "contested" : "current"));
  pya_knowledge_append(output, sizeof(output), &used, "\\\",\\\"record\\\":");
  if (selected_count == 1) pya_knowledge_append_record(output, sizeof(output), &used, &pya_knowledge_records[selected[0]]);
  else pya_knowledge_append(output, sizeof(output), &used, "null");
  pya_knowledge_append(output, sizeof(output), &used, ",\\\"records\\\":[");
  for (size_t index = 0; index < selected_count; index++) {
    if (index > 0) pya_knowledge_append(output, sizeof(output), &used, ",");
    pya_knowledge_append_record(output, sizeof(output), &used, &pya_knowledge_records[selected[index]]);
  }
  pya_knowledge_append(output, sizeof(output), &used, "]}");
  return output;
}
static const char *pya_knowledge_render_contested(const char *key) {
  static char output[PYA_KNOWLEDGE_VIEW_CAP];
  size_t selected[PYA_KNOWLEDGE_MAX];
  size_t selected_count = pya_knowledge_select(key, selected);
  size_t used = 0;
  output[0] = '\\0';
  pya_knowledge_append(output, sizeof(output), &used, "{\\\"view\\\":\\\"contested\\\",\\\"key\\\":");
  pya_knowledge_append_json(output, sizeof(output), &used, key ? key : "");
  pya_knowledge_append(output, sizeof(output), &used, ",\\\"status\\\":\\\"contested\\\",\\\"records\\\":[");
  for (size_t index = 0; index < selected_count; index++) {
    if (index > 0) pya_knowledge_append(output, sizeof(output), &used, ",");
    pya_knowledge_append_record(output, sizeof(output), &used, &pya_knowledge_records[selected[index]]);
  }
  pya_knowledge_append(output, sizeof(output), &used, "],\\\"conflict\\\":%s}", selected_count > 1 ? "true" : "false");
  return output;
}
static const char *pya_knowledge_render_provenance(const char *key) {
  static char output[PYA_KNOWLEDGE_VIEW_CAP];
  size_t matching[PYA_KNOWLEDGE_MAX];
  size_t matching_count = pya_knowledge_match(key, matching);
  size_t used = 0;
  output[0] = '\\0';
  pya_knowledge_append(output, sizeof(output), &used, "{\\\"view\\\":\\\"provenance\\\",\\\"key\\\":");
  pya_knowledge_append_json(output, sizeof(output), &used, key ? key : "");
  pya_knowledge_append(output, sizeof(output), &used, ",\\\"status\\\":\\\"provenance\\\",\\\"records\\\":[");
  for (size_t index = 0; index < matching_count; index++) {
    if (index > 0) pya_knowledge_append(output, sizeof(output), &used, ",");
    pya_knowledge_append_record(output, sizeof(output), &used, &pya_knowledge_records[matching[index]]);
  }
  pya_knowledge_append(output, sizeof(output), &used, "]}");
  return output;
}
`;
