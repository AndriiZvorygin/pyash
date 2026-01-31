import { compile_from_filename_to_filename } from "./compile/compile_from_filename.mjs";
import { transpileProgram } from "./compile/transpile_program.mjs";
import { transpileSentence } from "./compile/transpile_sentence.mjs";

export default compile_from_filename_to_filename;
export { transpileSentence, transpileProgram };

export const signatures = [
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "filename", "fromstate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "javascript", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "ob", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "fromstate", "name", "tostate", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "fromstate", "name", "become", "name", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "ob", "name", "num", "fromstate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "tostate", "name", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromtext", "text", "tostate", "name", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "from", "text", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "filename", "fromstate", "name", "num", "tostate", "name", "to", "text"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "become", "name", "num", "fromstate", "name", "num", "ob", "name", "text", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "ob", "name", "num", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "name", "num"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "from", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  },
  {
    signatureWords: ["be", "compile", "fromtext", "text", "fromstate", "name", "num", "tostate", "name", "num", "to", "filename"],
    handler: compile_from_filename_to_filename
  }
];
