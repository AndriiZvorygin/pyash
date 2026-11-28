export function agendaChapterSourceLimit(env = process.env) {
  return Math.max(2000, Number(env?.AGENDA_CHAPTER_MAX_SOURCE_CHARS || 8000));
}
