#!/usr/bin/env node
'use strict';
const fs = require('fs');
const kwim = false;
const clattsen = require('child_process');
const hfas = "InterlinguaToEnglishDictionary.txt";
const qrishkom = "en";
const kwichkom = "es";
const hra7nhkom = "ia";
const bvanhkom = "ia";

function bvan(kwictlat) {
	  if (! kwictlat || kwictlat.length == 0) return "";
	 let syamtlat = kwictlat.replace(/"/,"");
	 let myin = `espeak-ng -x --ipa -q  -v${bvanhkom} "${syamtlat}";`
	 let tlat = clattsen.execSync(myin).toString()
  	 return(tlat);
	return kwictlat;
	//return kwictlat? kwictlat.replace("ф","f"): kwictlat;
}

function hra7nryan(tlat) {
  const ryantlat =  tlat.replace(/le /, "lo ").replace(/é/g, "e")
    .replace(/[Çç]/g, "se").replace(/[Éé]/g, "es").replace(/[Àà]/g, "ah")
    .replace(/[Èè]/g, "eh").replace(/[Ùù]/g, "uh").replace(/[Ââ]/g, "as")
    .replace(/[ê]/g, "es").replace(/[î]/g, "is").replace(/[û]/g, "eu")
    .replace(/[ô]/g, "os").replace(/[ó]/g, "o");
  return ryantlat;
}

fs.readFile("dictionary_" + kwichkom + ".json", "utf8", function(err, kwictlatpu) {
  let kwickwonlwat = JSON.parse(kwictlatpu);
  let qrissokwicmakwonli = {};
  let kwicsoqrismakwonli = {};
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
      let tyattlatlwat = [];
      hra7nkwonlwat = hra7nkwonlwat.map(hlas => {
        const nyifhlas = hlas.slice(1);
	nyifhlas.forEach(qristlat => {
          qristlat = qristlat.trim();
          const kwictlat = hlas[0];
          let tyattlat = qrissokwicmakwonli[qristlat] == undefined? "":
            qrissokwicmakwonli[qristlat];
          //if (kwictlat.localeCompare("saper") == 0) {
          //  console.log(`${JSON.stringify(nyifhlas)} '${qristlat}' ${tyattlat} ${kwictlat}`);
          //  console.log(`${tyattlat.length > kwictlat.length}`);
          //}
          if ((tyattlat.length == 0 || tyattlat.length > kwictlat.length) 
                && ! tyattlatlwat.includes(kwictlat)) {
              tyattlat = kwictlat;
	      qrissokwicmakwonli[qristlat] = tyattlat;
          }
          tyattlatlwat.push(tyattlat);
	});
        return {"ia": hra7nryan(hlas[0]), "en":nyifhlas[0]};
      });
  for (let i = 0; i < kwickwonlwat.length; i++) {
  	let kwictlat = kwickwonlwat[i][kwichkom] && kwickwonlwat[i][kwichkom].replace(/\n/g,"");
        let qristlat = kwickwonlwat[i][qrishkom].replace(/-/g,"_");
        if (qrissokwicmakwonli[qristlat] == undefined) {
  	  qrissokwicmakwonli[qristlat] = hra7nryan(kwictlat);
        }
  }

//      let syacpyackwonlwat = pyackwonlwat.map((psut) => {
//	      const qristlat = psut.en.replace(/_$/, "");
//	      psut.ia = qrissokwicmakwonli[qristlat];
////	      console.log(`${qristlat} ${psut.ia}`);
//	      return psut;
//      });
      let syacpyackwonlwat = pyackwonlwat.map((psut) => {
	      const qristlat = psut.en.replace(/_*$/, "");
	      const kwictlat = qrissokwicmakwonli[qristlat];
	      psut[hra7nhkom] = kwictlat;
	      psut[`${hra7nhkom}_fyek`] = bvan(kwictlat);
	      if (kwim == true) console.log("kwim" + JSON.stringify(psut));
	     // console.log(`${qristlat} ${psut.fi}`);
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


