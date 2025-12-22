import { add, signatures as addSignatures } from "./mathematics/add.mjs";
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
import compile, { signatures as compileSignatures } from "./exchange/compile.mjs";
import importJson, { signatures as importSignatures } from "./exchange/import.mjs";
import translation, { signatures as translationSignatures } from "./exchange/translation.mjs";
import understand, { signatures as understandSignatures } from "./exchange/understand.mjs";
import read, { signatures as readSignatures } from "./exchange/read.mjs";
import mind, { signatures as mindSignatures } from "./mind/mind.mjs";
import { giant, signatures as giantSignatures } from "./regulation/giant.mjs";
import { tiny, signatures as tinySignatures } from "./regulation/tiny.mjs";
import { equally, signatures as equallySignatures } from "./regulation/equally.mjs";
import vector, { signatures as vectorSignatures } from "./vector/index.mjs";
import say, { signatures as saySignatures } from "./say.mjs";

export {
  add,
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
  compile,
  importJson,
  translation,
  understand,
  read,
  mind,
  giant,
  tiny,
  equally,
  vector,
  say
};

export const builtInSignatures = [
  ...addSignatures,
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
  ...compileSignatures,
  ...importSignatures,
  ...translationSignatures,
  ...understandSignatures,
  ...readSignatures,
  ...mindSignatures,
  ...giantSignatures,
  ...tinySignatures,
  ...equallySignatures,
  ...vectorSignatures,
  ...saySignatures,
];
