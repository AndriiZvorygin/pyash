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
import grossChip, { signatures as grossChipSignatures } from "./gross_chip.mjs";
import wiseChip, { signatures as wiseChipSignatures } from "./wise_chip.mjs";
import abridge, { signatures as abridgeSignatures } from "./abridge.mjs";
import seriesMap, { signatures as seriesMapSignatures } from "./series_map.mjs";
import vectorMap, { signatures as vectorMapSignatures } from "./vector_map.mjs";
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
import { resemble, signatures as resembleSignatures } from "./regulation/resemble.mjs";
import vector, { signatures as vectorSignatures } from "./vector/index.mjs";
import say, { signatures as saySignatures } from "./say.mjs";
import piperSay, { signatures as piperSaySignatures } from "./piper_say.mjs";
import espeakSay, { signatures as espeakSaySignatures } from "./espeak_say.mjs";
import hear, { signatures as hearSignatures } from "./hear.mjs";
import command, { signatures as commandSignatures } from "./command.mjs";
import interpret, { signatures as interpretSignatures } from "./interpret.mjs";
import discharge, { signatures as dischargeSignatures } from "./discharge.mjs";
import begin, { signatures as beginSignatures } from "./begin.mjs";
import restart, { signatures as restartSignatures } from "./restart.mjs";
import stop, { signatures as stopSignatures } from "./stop.mjs";
import health, { signatures as healthSignatures } from "./health.mjs";
import go, { signatures as goSignatures } from "./go.mjs";
import copy, { signatures as copySignatures } from "./copy.mjs";
import directory, { signatures as directorySignatures } from "./directory.mjs";
import exists, { signatures as existsSignatures } from "./exists.mjs";
import ecology, { signatures as ecologySignatures } from "./ecology.mjs";
import andVerb, { signatures as andSignatures } from "./and.mjs";
import glance, { signatures as glanceSignatures } from "./glance.mjs";
import here, { signatures as hereSignatures } from "./here.mjs";
import list, { signatures as listSignatures } from "./list.mjs";
import license, { signatures as licenseSignatures } from "./license.mjs";
import download, { signatures as downloadSignatures } from "./download.mjs";
import notVerb, { signatures as notSignatures } from "./not.mjs";
import orVerb, { signatures as orSignatures } from "./or.mjs";
import rename, { signatures as renameSignatures } from "./rename.mjs";
import search, { signatures as searchSignatures } from "./search.mjs";
import sleep, { signatures as sleepSignatures } from "./sleep.mjs";
import touch, { signatures as touchSignatures } from "./touch.mjs";
import del, { signatures as deleteSignatures } from "./delete.mjs";
import session, { signatures as sessionSignatures } from "./session.mjs";
import refinery, { signatures as refinerySignatures } from "./refinery.mjs";
import reporter, { signatures as reporterSignatures } from "./reporter.mjs";
import errorSieve, { signatures as errorSieveSignatures } from "./error_sieve.mjs";
import successSieve, { signatures as successSieveSignatures } from "./success_sieve.mjs";
import verifyLoop, { signatures as verifyLoopSignatures } from "./verify_loop.mjs";
import rememberPersistent, { signatures as rememberSignatures } from "./remember.mjs";
import lineTail, { signatures as lineTailSignatures } from "./line_tail.mjs";
import cast, { signatures as castSignatures } from "./cast.mjs";
import evoke, { signatures as evokeSignatures } from "./evoke.mjs";
import guarantee, { signatures as guaranteeSignatures } from "./guarantee.mjs";
import depart, { signatures as loopControlSignatures } from "./loop_control.mjs";
import exportFact, { signatures as exportSignatures } from "./export.mjs";
import repair, { signatures as repairSignatures } from "./repair.mjs";
import establish, { signatures as establishSignatures } from "./establish.mjs";
import improve, { signatures as improveSignatures } from "./improve.mjs";
import router, { signatures as routerSignatures } from "./router.mjs";
import verify, { signatures as verifySignatures } from "./verify.mjs";

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
  grossChip,
  wiseChip,
  abridge,
  seriesMap,
  vectorMap,
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
  resemble,
  vector,
  say,
  piperSay,
  espeakSay,
  hear,
  command,
  interpret,
  discharge,
  begin,
  restart,
  stop,
  health,
  go,
  copy,
  sleep,
  session,
  touch,
  del,
  refinery,
  reporter,
  errorSieve,
  successSieve,
  verifyLoop,
  rememberPersistent,
  lineTail,
  cast,
  evoke,
  guarantee,
  depart,
  exportFact,
  repair,
  establish,
  improve,
  router,
  verify
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
  ...grossChipSignatures,
  ...wiseChipSignatures,
  ...abridgeSignatures,
  ...seriesMapSignatures,
  ...vectorMapSignatures,
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
  ...resembleSignatures,
  ...vectorSignatures,
  ...saySignatures,
  ...piperSaySignatures,
  ...espeakSaySignatures,
  ...hearSignatures,
  ...commandSignatures,
  ...interpretSignatures,
  ...dischargeSignatures,
  ...beginSignatures,
  ...restartSignatures,
  ...stopSignatures,
  ...healthSignatures,
  ...goSignatures,
  ...copySignatures,
  ...directorySignatures,
  ...existsSignatures,
  ...ecologySignatures,
  ...andSignatures,
  ...glanceSignatures,
  ...hereSignatures,
  ...listSignatures,
  ...licenseSignatures,
  ...downloadSignatures,
  ...notSignatures,
  ...orSignatures,
  ...renameSignatures,
  ...searchSignatures,
  ...sleepSignatures,
  ...sessionSignatures,
  ...touchSignatures,
  ...deleteSignatures,
  ...refinerySignatures,
  ...reporterSignatures,
  ...errorSieveSignatures,
  ...successSieveSignatures,
  ...verifyLoopSignatures,
  ...rememberSignatures,
  ...lineTailSignatures,
  ...castSignatures,
  ...evokeSignatures,
  ...guaranteeSignatures,
  ...loopControlSignatures,
  ...exportSignatures,
  ...repairSignatures,
  ...establishSignatures,
  ...improveSignatures,
  ...routerSignatures,
  ...verifySignatures,
];
