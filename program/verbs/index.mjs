import { add, signatures as addSignatures } from "./mathematics/add.mjs";
import { subtract } from "./mathematics/subtract.mjs";
import { invert } from "./mathematics/invert.mjs";
import { exponential } from "./mathematics/exponential.mjs";
import { multiply, signatures as multiplySignatures } from "./mathematics/multiply.mjs";
import { divide, signatures as divideSignatures } from "./mathematics/divide.mjs";
import { produce } from "./mathematics/produce.mjs";
import { neuron } from "./mathematics/neuron.mjs";
import { twiceCrescent } from "./mathematics/twice_crescent.mjs";
import chip from "./mathematics/chip.mjs";
import compile from "./exchange/compile.mjs";
import read from "./exchange/read.mjs";
import mind from "./mind/mind.mjs";
import { giant } from "./regulation/giant.mjs";
import { tiny } from "./regulation/tiny.mjs";
import { equally } from "./regulation/equally.mjs";

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
];
