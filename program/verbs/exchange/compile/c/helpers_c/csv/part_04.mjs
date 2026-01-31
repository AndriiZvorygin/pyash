export const CSV_RUNTIME_HELPER_PART_04 = [
"  if (!out) return 0;",
"  int ok = pya_csv_write_pyash(out, name);",
"  fclose(out);",
"  return ok;",
"}",
"static int pya_csv_write_pyash_stdout(const char *name) {",
"  return pya_csv_write_pyash(stdout, name);",
"}"
];
