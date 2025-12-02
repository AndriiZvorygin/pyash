import { add, signatures as addSignatures } from "./mathematics/add.mjs";
import { subtract, signatures as subtractSignatures } from "./mathematics/subtract.mjs";
import { invert, signatures as invertSignatures } from "./mathematics/invert.mjs";
import { exponential, signatures as exponentialSignatures } from "./mathematics/exponential.mjs";
import { multiply, signatures as multiplySignatures } from "./mathematics/multiply.mjs";
import { divide, signatures as divideSignatures } from "./mathematics/divide.mjs";
import { produce, signatures as produceSignatures } from "./mathematics/produce.mjs";
import { neuron, signatures as neuronSignatures } from "./mathematics/neuron.mjs";
import { twiceCrescent, signatures as twiceCrescentSignatures } from "./mathematics/twice_crescent.mjs";
import chip, { signatures as chipSignatures } from "./mathematics/chip.mjs";
import compile, { signatures as compileSignatures } from "./exchange/compile.mjs";
import read, { signatures as readSignatures } from "./exchange/read.mjs";
import mind, { signatures as mindSignatures } from "./mind/mind.mjs";
import { giant, signatures as giantSignatures } from "./regulation/giant.mjs";
import { tiny, signatures as tinySignatures } from "./regulation/tiny.mjs";
import { equally, signatures as equallySignatures } from "./regulation/equally.mjs";

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
  chip,
  compile,
  read,
  mind,
  giant,
  tiny,
  equally
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
  ...chipSignatures,
  ...compileSignatures,
  ...readSignatures,
  ...mindSignatures,
  ...giantSignatures,
  ...tinySignatures,
  ...equallySignatures,
];
