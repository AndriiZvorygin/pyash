function slugifyPart(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "meeting";
}

export function canonicalMeetingRouteSlug(input) {
  const slug = slugifyPart(input);
  const duplicate = slug.match(/^(committee|council|board)-\1(?:-|$)/u);
  if (!duplicate) return slug;
  const remainder = slug.slice(duplicate[0].length).replace(/^-+|-+$/gu, "");
  return remainder ? `${duplicate[1]}-${remainder}` : duplicate[1];
}
