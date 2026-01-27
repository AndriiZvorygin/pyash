#!/usr/bin/env  node
'use strict';

const fs = require('fs');
const input = process.argv[2];
const grammarWords = new Set();
try {
  const grammar = fs.readFileSync("program/pyashWords.h", "utf8");
  grammar.split("\n").forEach((line) => {
    const match = line.match(/_GRAMMAR\s+0x[0-9A-Fa-f]+\s+\/\/\s+(\S+)/);
    if (match) grammarWords.add(match[1]);
  });
} catch (err) {
  // ignore missing grammar list
}
fs.readFile("kwon_ia.json", "utf8", function(err, ia) {
  if (err) return Error(err);
  let hra7nkwon = JSON.parse(ia);
fs.readFile("kwon_fi.json", "utf8", function(err, fi) {
  if (err) return Error(err);
  let fl6nkwon = JSON.parse(fi);
fs.readFile("kwon_isv.json", "utf8", function(err, isv) {
  if (err) return Error(err);
  let sla7fkwon = JSON.parse(isv);
fs.readFile("kwon_he.json", "utf8", function(err, he) {
  if (err) return Error(err);
  let xrupkwon = JSON.parse(he);
fs.readFile("kwon_tr.json", "utf8", function(err, tr) {
  if (err) return Error(err);
  let tru2kkwon = JSON.parse(tr);
fs.readFile("kwon_hi.json", "utf8", function(err, hi) {
  if (err) return Error(err);
  let nr6tkwon = JSON.parse(hi);
fs.readFile("kwon_zh.json", "utf8", function(err, zh) {
  if (err) return Error(err);
  let cyi7nkwon = JSON.parse(zh);
fs.readFile("kwon_en.json", "utf8", function(err, en_f) {
  if (err) return Error(err);
  let qrisfyekkwon = JSON.parse(en_f);
fs.readFile("pyashWords.json", "utf8", function(err, pya) {
  if (err) return Error(err);
  let pyackwon = JSON.parse(pya);
fs.readFile("pyackwon.json", "utf8", function(err, pyaExtra) {
  if (err) return Error(err);
  let pyackwonExtra = JSON.parse(pyaExtra);
fs.readFile("dictionary_en.json", "utf8", function(err, contents) {
  if (err) return Error(err);
  let dictionary = JSON.parse(contents);
  //console.log(dictionary);
  const bli2spsas = dictionary.en.blacklist['X' + input];
  if (bli2spsas == undefined || bli2spsas.length == 0) {
   const kwonlwat = [pyackwonExtra, pyackwon, qrisfyekkwon, cyi7nkwon, nr6tkwon, hra7nkwon, sla7fkwon, tru2kkwon, xrupkwon, fl6nkwon];
   kwonlwat.forEach((kwon) => {
	let hkom = kwon[0].isv? "isv": 
		   kwon[0].ia? "ia" : 
		   kwon[0].hi? "hi" : 
		   kwon[0].he? "he" : 
		   kwon[0].es? "es" : 
		   kwon[0].tr? "tr" : 
		   kwon[0].zh? "zh" : 
		   kwon[0].fi? "fi" : 
		   kwon[0].en? "en" : "";
	for (let i = 0; i< kwon.length; i++) {
		if (!kwon[i].pya || !kwon[i][hkom] || !kwon[i].en) {
			continue;
		}
		if (kwon[i].pya.indexOf(input) == 0 || kwon[i][hkom].indexOf(input) == 0 || kwon[i].en.indexOf(input) == 0) {
			let hwus = `${kwon[i].pya} ${hkom} ${kwon[i][hkom]}`;
			if (grammarWords.has(kwon[i].pya)) hwus += " grammar";
			if (kwon[i][`${hkom}_fyek`]) hwus += " /" + kwon[i][`${hkom}_fyek`].trim() + "/";
			console.log(hwus);
		}
	}
   });
   fs.readFile("program/pyashWords.h", "utf8", function(err, contents) { 
     if (err) return Error(err);
     let example = new RegExp(input, 'i');
     let lines = contents.split('\n');
     let produce = lines.filter((line) => {
       return example.test(line);
     });
     console.log((produce.join('\n')));
   });
   }else {
    console.log(JSON.stringify(bli2spsas));
  }
});
});
});
});
});
});
});
});
});
});
});
