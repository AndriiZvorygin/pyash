#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = "interslavic-cyrillic-to-english.txt";
const qrishkom = "en";
const kwichkom = "ru";
const sla7fhkom = "isv";
function cli7kryan(tlat) {
  if (tlat == undefined || tlat.length == 0) return tlat;
  const ryantlat = 
    tlat.toLowerCase().replace(/e$/,"") .replace(/e[ ]/g, " ")
    .replace(/[Ьь]/g, "ј").replace(/[Єєєє]/g, "је").replace(/[Її]/g, "ји")
    .replace(/[Йй]/g, "иј").replace(/[Юю]/g, "ју").replace(/[Яяя]/g, "ја")
    .replace(/[љ]/g, "лј").replace(/[њњ]/g, "нј").replace(/[Aa]/g, "а")
    .replace(/[Bb]/g, "б").replace(/[Vv]/g, "в").replace(/,/g, "")
    .replace(/[Dd]/g, "д").replace(/[Ee]/g, "е").replace(/[Jj]/g, "ж")
    .replace(/[Zz]/g, "з").replace(/[Ii]/g, "и").replace(/[Kk]/g, "к")
    .replace(/[Ll]/g, "л").replace(/[Ww]/g, "вј").replace(/Mm/g, "м")
    .replace(/[Nn]/g, "н").replace(/[Oo]/g, "о").replace(/Pp/g, "п")
    .replace(/[Rr]/g, "р").replace(/shch/g, "щ").replace(/ch/g, "ч")
    .replace(/[]/g, "п").replace("&#39;","")
    .replace(/ts/g, "ц").replace(/q/g, "кв").replace(/x/g, "кс")
    .replace(/gh/g,"х").replace(/sh/g,"ш").replace(/t/g,"т").replace(/u/g,"у")
    .replace(/f/g, "ф").replace(/h/g,"х").replace(/c/g,"ц").replace(/y/g, "ј")
    .replace(/[Ss]/g, "с")
  //console.log(`${tlat} ${ryantlat}`);
  return ryantlat;
}

fs.readFile("dictionary_" + kwichkom + ".json", "utf8", function(err, kwictlatpu) {
  let kwickwonlwat = JSON.parse(kwictlatpu);
  let sla7flwat = [];
  let qrissokwicmakwonli = {};
  let kwicsoqrismakwonli = {};
  for (let i = 0; i < kwickwonlwat.length; i++) {
  	let kwictlat = kwickwonlwat[i][kwichkom] && kwickwonlwat[i][kwichkom].replace(/\n/g,"");
	//sla7flwat.push(kwictlat);
  	qrissokwicmakwonli[kwickwonlwat[i][qrishkom].replace(/-/g,"_")] = cli7kryan(kwictlat);
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
        });
      });
      // generate dictionary
      let tyattlatlwat = [];
      sla7flwat = sla7fkwonlwat.map(hlas => {
        return hlas[0];
      });
      sla7fkwonlwat = sla7fkwonlwat.map(hlas => {
        const nyifhlas = hlas.slice(1).join(" ").split(/[,;]/g);
	nyifhlas.forEach(qristlat => {
          qristlat = qristlat.trim();
          let tyattlat = qrissokwicmakwonli[qristlat] == undefined? "":
            qrissokwicmakwonli[qristlat];
          const kwictlat = hlas[0] == undefined? "": cli7kryan(hlas[0]);
          // if (/свјет/.test(kwictlat)) { console.log(kwictlat);}
	  // if (kwictlat.localeCompare("свјетскы") == 0) {
	  //         console.log(`qristlat ${qristlat} tyattlat ${tyattlat} kwictlat ${kwictlat}`);
          //         console.log(`tyattlat.length == 0 ${tyattlat.length == 0}\n` +
          //           `tyattlat.length > kwictlat.length ${tyattlat.length > kwictlat.length}\n` + 
          //           `! sla7flwat.includes(tyattlat) ${! sla7flwat.includes(tyattlat)}\n` +
          //           ` kwictlat.length > 0 ${kwictlat.length > 0}\n` +
          //      `/[0-9]/.test(tyattlat)  ${/[0-9]/.test(tyattlat)}\n` +
          //      `! tyattlatlwat.includes(kwictlat) ${! tyattlatlwat.includes(kwictlat)}\n` + 
          //      `! /[0-9]/.test(kwictlat) ${! /[0-9]/.test(kwictlat)}\n`);
	  // }
          if ((tyattlat.length == 0 || tyattlat.length > kwictlat.length 
		  || (! sla7flwat.includes(tyattlat) && kwictlat.length > 0)
               || /[0-9]/.test(tyattlat)) 
                && ! tyattlatlwat.includes(kwictlat) && ! /[0-9]/.test(kwictlat)) {
	  //if (kwictlat.localeCompare("свєтскы") == 0) {
	  //        console.log(`qristlat ${qristlat} tyattlat ${tyattlat} kwictlat ${kwictlat}`);
          //}
              tyattlat = kwictlat;
	      qrissokwicmakwonli[qristlat] = tyattlat;
          }
          tyattlatlwat.push(tyattlat);
        });
        return {"isv": cli7kryan(hlas[0]), "en":nyifhlas[0]};
      });

      let syacpyackwonlwat = pyackwonlwat.map((psut) => {
	      const qristlat = psut.en.replace(/_$/, "");
	      psut.isv = qrissokwicmakwonli[qristlat];
//	      console.log(`${qristlat} ${psut.isv}`);
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


