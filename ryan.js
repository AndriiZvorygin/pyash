#!/usr/bin/env  node
'use strict';

const fs = require('fs');
const input = process.argv[2];
fs.readFile("dictionary_ia.json", "utf8", function(err, ia) {
  if (err) return Error(err);
  let hra7nkwon = JSON.parse(ia);
fs.readFile("dictionary_isv.json", "utf8", function(err, isv) {
  if (err) return Error(err);
  let sla7fkwon = JSON.parse(isv);
fs.readFile("pyashWords.json", "utf8", function(err, pya) {
  if (err) return Error(err);
  let pyackwon = JSON.parse(pya);
fs.readFile("dictionary_en.json", "utf8", function(err, contents) {
  if (err) return Error(err);
  let dictionary = JSON.parse(contents);
  //console.log(dictionary);
  const bli2spsas = dictionary.en.blacklist['X' + input];
  if (bli2spsas == undefined || bli2spsas.length == 0) {
   const kwonlwat = [pyackwon, sla7fkwon, hra7nkwon];
   kwonlwat.forEach((kwon) => {
	let hkom = kwon[0].isv? "isv": 
		   kwon[0].ia? "ia" :
		   "en";
	for (let i = 0; i< kwon.length; i++) {
		if (!kwon[i].pya || !kwon[i][hkom] || !kwon[i].en) {
			continue;
		}
		if (kwon[i].pya.indexOf(input) == 0 || kwon[i][hkom].indexOf(input) == 0 || kwon[i].en.indexOf(input) == 0) {
			console.log(`${kwon[i].pya} ${hkom} ${kwon[i][hkom]}`);
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

//fs.readFile("program/pyashWords.h", "utf8", function(err, contents) { 
//  if (err) return Error(err);
//  let example = new RegExp(input, 'i');
//  let lines = contents.split('\n');
//  let produce = lines.filter((line) => {
//    return example.test(line);
//  });
//  if (produce.length == 0) {
//    fs.readFile("dictionary_en.json", "utf8", function(err, contents) {
//      if (err) return Error(err);
//      let dictionary = JSON.parse(contents);
//      //console.log(dictionary);
//      console.log(dictionary.en.blacklist['X' + input]);
//    });
//  } else {
//    console.log(produce.join("\n"));
//  }
//
//});
