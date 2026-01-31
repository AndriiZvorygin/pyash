import { remember } from "../remember/index.mjs";
import { throwErrorSentence } from "../error.mjs";
import { download_http, download_ytdlp, download_missing } from "./download/handlers.mjs";
import { signatures } from "./download/signatures.mjs";

export default async function download(sentence, { remember: rememberFn = remember } = {}) {
  const scheme = sentence?.fromstate?.name;
  if (!scheme) {
    throwErrorSentence({
      name: "download defective",
      message: "download defective: missing fromstate",
      from: { name: "download" },
      raw: { sentence }
    });
  }
  const intent = sentence?.as?.wo;
  if (scheme === "http" || scheme === "https") {
    if (intent === "web" || intent === "file") {
      return download_http(sentence, { scheme, intent, remember: rememberFn });
    }
    if (intent === "video" || intent === "audio") {
      return download_ytdlp(sentence, { scheme, intent, remember: rememberFn });
    }
    return download_missing(sentence, { scheme, intent });
  }
  return download_missing(sentence, { scheme, intent });
}


export { signatures };
