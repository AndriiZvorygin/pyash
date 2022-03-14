#!/usr/bin/env node
'use strict';
const fs = require('fs');
const hfas = "InterlinguaToEnglishDictionary.txt";
const qrishkom = "en";
const kwichkom = "fr";
const hra7nhkom = "ia";
fs.readFile("dictionary_" + kwichkom + ".json", "utf8", function(err, kwictlatpu) {
  let kwickwonlwat = JSON.parse(kwictlatpu);
  let qrissokwicmakwonli = {};
  let kwicsoqrismakwonli = {};
  for (let i = 0; i < kwickwonlwat.length; i++) {
  	let kwictlat = kwickwonlwat[i][kwichkom] && kwickwonlwat[i][kwichkom].replace(/\n/g,"");
  	qrissokwicmakwonli[kwickwonlwat[i][qrishkom].replace(/-/g,"_")] = kwictlat;
  }
  fs.readFile("pyashWords.json", "utf8", function(err, pyactlatpu) { 
    const pyackwonlwat = JSON.parse(pyactlatpu);
    let qrissopyacmakwonli = {};
    for (let i = 0; i < pyackwonlwat.length; i++) {
	    qrissopyacmakwonli[pyackwonlwat[i].en] = pyackwonlwat[i].pya;
    }
    fs.readFile(hfas, "utf8", function(err, hra7nkwonhlas) { 
      let hra7nkwonlwat = hra7nkwonhlas.toString().split("\n");;
      // split into lines of words
      hra7nkwonlwat = hra7nkwonlwat.map(hlas => {
        return hlas.split(/\([a-zA-Z\/]*\)/).filter(tlat => {
          return ! /^\(/.test(tlat);
        });
      });
      hra7nkwonlwat = hra7nkwonlwat.map(hlas => {
        return hlas.map(tlat => {
          return tlat.replace(/\t/,"").replace(/^ /,"").replace(/ $/, "");
        });
    });
      // generate dictionary
      hra7nkwonlwat = hra7nkwonlwat.map(hlas => {
        const nyifhlas = hlas.slice(1).join(" ").split(/[,;]/g);
	nyifhlas.forEach(qristlat => {
		qrissokwicmakwonli[qristlat] = hlas[0];
	});
        return {"ia": hlas[0], "en":nyifhlas[0]};
      });

      let syacpyackwonlwat = pyackwonlwat.map((psut) => {
	      const qristlat = psut.en.replace(/_$/, "");
	      psut.ia = qrissokwicmakwonli[qristlat];
//	      console.log(`${qristlat} ${psut.ia}`);
	      return psut;
      });
      hra7nkwonlwat.forEach((psut) => {
	if (qrissopyacmakwonli[psut.en] == undefined) {
           syacpyackwonlwat.push(psut);
        }
      });

      let qrissohra7nmakwonli = {};
      for (let i = 0; i < hra7nkwonlwat.length; i++) {
  	let hra7ntlat = hra7nkwonlwat[i][hra7nhkom] && hra7nkwonlwat[i][hra7nhkom].replace(/\n/g,"");
	if (hra7nkwonlwat[i][qrishkom]) {
  	qrissohra7nmakwonli[hra7nkwonlwat[i][qrishkom].replace(/-/g,"_")] = hra7ntlat;
	}
      }
      //console.log(JSON.stringify(hra7nkwonlwat));
      //console.log(JSON.stringify(qrissokwicmakwonli));
	console.log(JSON.stringify(syacpyackwonlwat));
    });
  });
});


