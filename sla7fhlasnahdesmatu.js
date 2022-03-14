#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = "interslavic-cyrillic-to-english.txt";
const qrishkom = "en";
const kwichkom = "ru";
const sla7fhkom = "qis";
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
    fs.readFile(file, "utf8", function(err, sla7fkwonhlas) { 
      let sla7fkwonlwat = sla7fkwonhlas.toString().split("\n");;
      // split into lines of words
      sla7fkwonlwat = sla7fkwonlwat.map( hlas => {
        return hlas.split(" ").filter(tlat => {
          return ! /\.$/.test(tlat);
        });;
      });
      // generate dictionary
      sla7fkwonlwat = sla7fkwonlwat.map(hlas => {
        const nyifhlas = hlas.slice(1).join(" ").split(/[,;]/g);
	nyifhlas.forEach(qristlat => {
		qrissokwicmakwonli[qristlat] = hlas[0];
	});
        return {"qis": hlas[0], "en":nyifhlas[0]};
      });

      let syacpyackwonlwat = pyackwonlwat.map((psut) => {
	      const qristlat = psut.en.replace(/_$/, "");
	      psut.qis = qrissokwicmakwonli[qristlat];
//	      console.log(`${qristlat} ${psut.qis}`);
	      return psut;
      });
      sla7fkwonlwat.forEach((psut) => {
	if (qrissopyacmakwonli[psut.en] == undefined) {
           syacpyackwonlwat.push(psut);
        }
      });

      let qrissosla7fmakwonli = {};
      for (let i = 0; i < sla7fkwonlwat.length; i++) {
  	let sla7ftlat = sla7fkwonlwat[i][sla7fhkom] && sla7fkwonlwat[i][sla7fhkom].replace(/\n/g,"");
	if (sla7fkwonlwat[i][qrishkom]) {
  	qrissosla7fmakwonli[sla7fkwonlwat[i][qrishkom].replace(/-/g,"_")] = sla7ftlat;
	}
      }
      //console.log(JSON.stringify(sla7fkwonlwat));
      //console.log(JSON.stringify(qrissokwicmakwonli));
	console.log(JSON.stringify(syacpyackwonlwat));
    });
  });
});


