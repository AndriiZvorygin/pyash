export const LIST_PRINT_HELPER = [
  "static void print_list_sentence(const char *name, const pya_vec *vec) {",
  "  printf(\"su name %s ob \", name ? name : \"\");",
  "  print_vec_inline(vec);",
  "  printf(\" be list ya\\n\");",
  "}"
].join("\n");
