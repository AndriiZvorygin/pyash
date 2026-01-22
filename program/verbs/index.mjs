import { plus, signatures as plusSignatures } from "./mathematics/plus.mjs";
import { subtract, signatures as subtractSignatures } from "./mathematics/subtract.mjs";
import { invert, signatures as invertSignatures } from "./mathematics/invert.mjs";
import { exponential, signatures as exponentialSignatures } from "./mathematics/exponential.mjs";
import { multiply, signatures as multiplySignatures } from "./mathematics/multiply.mjs";
import { divide, signatures as divideSignatures } from "./mathematics/divide.mjs";
import { produce, signatures as produceSignatures } from "./mathematics/produce.mjs";
import { neuron, signatures as neuronSignatures } from "./mathematics/neuron.mjs";
import { twiceCrescent, signatures as twiceCrescentSignatures } from "./mathematics/twice_crescent.mjs";
import { remains, signatures as remainsSignatures } from "./mathematics/remains.mjs";
import chip, { signatures as chipSignatures } from "./mathematics/chip.mjs";
import text, { signatures as textSignatures } from "./text.mjs";
import filename, { signatures as filenameSignatures } from "./filename.mjs";
import compile, { signatures as compileSignatures } from "./exchange/compile.mjs";
import importJson, { signatures as importSignatures } from "./exchange/import.mjs";
import translation, { signatures as translationSignatures } from "./exchange/translation.mjs";
import understand, { signatures as understandSignatures } from "./exchange/understand.mjs";
import read, { signatures as readSignatures } from "./exchange/read.mjs";
import write, { signatures as writeSignatures } from "./exchange/write.mjs";
import mind, { signatures as mindSignatures } from "./mind/mind.mjs";
import { giant, signatures as giantSignatures } from "./regulation/giant.mjs";
import { tiny, signatures as tinySignatures } from "./regulation/tiny.mjs";
import { equally, signatures as equallySignatures } from "./regulation/equally.mjs";
import vector, { signatures as vectorSignatures } from "./vector/index.mjs";
import say, { signatures as saySignatures } from "./say.mjs";
import piperSay, { signatures as piperSaySignatures } from "./piper_say.mjs";
import espeakSay, { signatures as espeakSaySignatures } from "./espeak_say.mjs";
import hear, { signatures as hearSignatures } from "./hear.mjs";
import command, { signatures as commandSignatures } from "./command.mjs";
import discharge, { signatures as dischargeSignatures } from "./discharge.mjs";
import begin, { signatures as beginSignatures } from "./begin.mjs";
import restart, { signatures as restartSignatures } from "./restart.mjs";
import go, { signatures as goSignatures } from "./go.mjs";
import copy, { signatures as copySignatures } from "./copy.mjs";
import directory, { signatures as directorySignatures } from "./directory.mjs";
import search, { signatures as searchSignatures } from "./search.mjs";
import touch, { signatures as touchSignatures } from "./touch.mjs";
import del, { signatures as deleteSignatures } from "./delete.mjs";

export {
  plus,
  subtract,
  invert,
  exponential,
  multiply,
  divide,
  produce,
  neuron,
  twiceCrescent,
  remains,
  chip,
  text,
  filename,
  compile,
  importJson,
  translation,
  understand,
  read,
  write,
  mind,
  giant,
  tiny,
  equally,
  vector,
  say,
  piperSay,
  espeakSay,
  hear,
  command,
  discharge,
  begin,
  restart,
  go,
  copy,
  touch,
  del
};

export const builtInSignatures = [
  ...plusSignatures,
  ...multiplySignatures,
  ...divideSignatures,
  ...subtractSignatures,
  ...invertSignatures,
  ...exponentialSignatures,
  ...produceSignatures,
  ...neuronSignatures,
  ...twiceCrescentSignatures,
  ...remainsSignatures,
  ...chipSignatures,
  ...textSignatures,
  ...filenameSignatures,
  ...compileSignatures,
  ...importSignatures,
  ...translationSignatures,
  ...understandSignatures,
  ...readSignatures,
  ...writeSignatures,
  ...mindSignatures,
  ...giantSignatures,
  ...tinySignatures,
  ...equallySignatures,
  ...vectorSignatures,
  ...saySignatures,
  ...piperSaySignatures,
  ...espeakSaySignatures,
  ...hearSignatures,
  ...commandSignatures,
  ...dischargeSignatures,
  ...beginSignatures,
  ...restartSignatures,
  ...goSignatures,
  ...copySignatures,
  ...directorySignatures,
  ...searchSignatures,
  ...touchSignatures,
  ...deleteSignatures,
];
