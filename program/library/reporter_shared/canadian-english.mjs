export const CANADIAN_ENGLISH_SPELLING_PAIRS = [
  ["color", "colour"],
  ["colors", "colours"],
  ["colored", "coloured"],
  ["coloring", "colouring"],
  ["favor", "favour"],
  ["favors", "favours"],
  ["favored", "favoured"],
  ["favoring", "favouring"],
  ["flavor", "flavour"],
  ["flavors", "flavours"],
  ["flavored", "flavoured"],
  ["flavoring", "flavouring"],
  ["honor", "honour"],
  ["honors", "honours"],
  ["honored", "honoured"],
  ["honoring", "honouring"],
  ["behavior", "behaviour"],
  ["behaviors", "behaviours"],
  ["behavioral", "behavioural"],
  ["labor", "labour"],
  ["labors", "labours"],
  ["labeled", "labelled"],
  ["labeling", "labelling"],
  ["neighbor", "neighbour"],
  ["neighbors", "neighbours"],
  ["neighborhood", "neighbourhood"],
  ["neighboring", "neighbouring"],
  ["center", "centre"],
  ["centers", "centres"],
  ["meter", "metre"],
  ["meters", "metres"],
  ["theater", "theatre"],
  ["theaters", "theatres"],
  ["analyze", "analyse"],
  ["analyzed", "analysed"],
  ["analyzes", "analyses"],
  ["analyzing", "analysing"],
  ["organize", "organise"],
  ["organized", "organised"],
  ["organizes", "organises"],
  ["organizing", "organising"],
  ["organization", "organisation"],
  ["organizations", "organisations"],
  ["authorize", "authorise"],
  ["authorized", "authorised"],
  ["authorizes", "authorises"],
  ["authorizing", "authorising"],
  ["summarize", "summarise"],
  ["summarized", "summarised"],
  ["summarizes", "summarises"],
  ["summarizing", "summarising"],
  ["utilize", "utilise"],
  ["utilized", "utilised"],
  ["utilizes", "utilises"],
  ["utilizing", "utilising"],
  ["defense", "defence"],
  ["offense", "offence"],
  ["license", "licence"],
  ["licenses", "licences"],
  ["program", "programme"],
  ["programs", "programmes"],
  ["dialog", "dialogue"],
  ["catalog", "catalogue"],
  ["traveler", "traveller"],
  ["travelers", "travellers"],
  ["traveling", "travelling"],
  ["canceled", "cancelled"],
  ["canceling", "cancelling"],
  ["modeling", "modelling"],
  ["installment", "instalment"],
  ["installments", "instalments"],
  ["enroll", "enrol"],
  ["enrollment", "enrolment"],
  ["fulfill", "fulfil"],
  ["fulfillment", "fulfilment"],
  ["councilor", "councillor"],
  ["councilors", "councillors"],
];

function preserveCase(src, replacement) {
  if (!src) return replacement;
  if (src.toUpperCase() === src) return replacement.toUpperCase();
  if (src[0] === src[0].toUpperCase() && src.slice(1) === src.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function normalizeCanadianEnglish(text = "") {
  let out = String(text || "");
  for (const [us, ca] of CANADIAN_ENGLISH_SPELLING_PAIRS) {
    const re = new RegExp(`\\b${us}\\b`, "giu");
    out = out.replace(re, (m) => preserveCase(m, ca));
  }
  return out;
}

export default normalizeCanadianEnglish;
