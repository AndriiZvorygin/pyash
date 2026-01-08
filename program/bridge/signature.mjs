export { makeSignatureWords, joinSignatureWords } from "./signature/normalize.mjs";
export {
  registerSignature,
  registerSignatureAlias,
  registerSignatureHandler,
  clearSignatureHandlers,
  lookupSignature,
  lookupSignatureHandler,
  clearSignatureDefinitions
} from "./signature/registry.mjs";
export { deriveSignatureFromDefinition, deriveSignatureFromCall } from "./signature/derive.mjs";
