#!/usr/bin/env node
'use strict';
const fs = require('fs');
const clattsen = require('child_process');
const file = "interslavic-cyrillic-to-english.txt";
const qrishkom = "en";
const kwichkom = "ru";
const sla7fhkom = "isv";

function bvan(kwictlat) {
	  //let myin = `espeak-ng -x --ipa -q  -v${kwichkom} "${kwictlat}";`
  	  //return(clattsen.execSync(myin).toString());
	return kwictlat? kwictlat.replace("ф","f"): kwictlat;
}

function cli7kryan(tlat) {
  if (tlat == undefined || tlat.length == 0) return tlat;
  const ryantlat = 
    tlat.toLowerCase().replace(/e$/,"") .replace(/e[ ]/g, " ")
    .replace(/[Ьь]/g, "ј").replace(/[Єєєє]/g, "јe").replace(/[Її]/g, "ји")
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
    .replace(/[Ss]/g, "s").replace(/ии/g, "i").replace(/ее/,"ејо")
	.replace(/\ дело$/, " падеж");
//    tlat.toLowerCase().replace(/e$/,"") .replace(/e[ ]/g, " ")
//    .replace(/[Ьь]/g, "ј").replace(/[Єєєє]/g, "је").replace(/[Її]/g, "ји")
//    .replace(/[Йй]/g, "иј").replace(/[Юю]/g, "ју").replace(/[Яяя]/g, "ја")
//    .replace(/[љ]/g, "лј").replace(/[њњ]/g, "нј").replace(/[Aa]/g, "а")
//    .replace(/[Bb]/g, "б").replace(/[Vv]/g, "в").replace(/,/g, "")
//    .replace(/[Dd]/g, "д").replace(/[Ee]/g, "е").replace(/[Jj]/g, "ж")
//    .replace(/[Zz]/g, "з").replace(/[Ii]/g, "и").replace(/[Kk]/g, "к")
//    .replace(/[Ll]/g, "л").replace(/[Ww]/g, "вј").replace(/Mm/g, "м")
//    .replace(/[Nn]/g, "н").replace(/[Oo]/g, "о").replace(/Pp/g, "п")
//    .replace(/[Rr]/g, "р").replace(/shch/g, "щ").replace(/ch/g, "ч")
//    .replace(/[]/g, "п").replace("&#39;","")
//    .replace(/ts/g, "ц").replace(/q/g, "кв").replace(/x/g, "кс")
//    .replace(/gh/g,"х").replace(/sh/g,"ш").replace(/t/g,"т").replace(/u/g,"у")
//    .replace(/f/g, "ф").replace(/h/g,"х").replace(/c/g,"ц").replace(/y/g, "ј")
//    .replace(/[Ss]/g, "с").replace(/ии/g, "и").replace(/ее/,"ејо")
//	.replace(/\ дело$/, " падеж");
  return ryantlat;
}

fs.readFile("dictionary_" + kwichkom + ".json", "utf8", function(err, kwictlatpu) {
  let kwickwonlwat = JSON.parse(kwictlatpu);
  let sla7flwat = [];
  let qrissokwicmakwonli = {};
  let kwicsoqrismakwonli = {};
  let kwiclwat = [];
  for (let i = 0; i < kwickwonlwat.length; i++) {
  	let kwictlat = kwickwonlwat[i][kwichkom] && kwickwonlwat[i][kwichkom].replace(/\n/g,"");
	//sla7flwat.push(kwictlat);
//	if (! kwiclwat.includes(kwictlat)) { 
  	qrissokwicmakwonli[kwickwonlwat[i][qrishkom].replace(/-/g,"_")] = cli7kryan(kwictlat);
//	kwiclwat.push(kwictlat);
//	}
	
  }
  fs.readFile("pyashWords.json", "utf8", function(err, pyactlatpu) { 
    const pyackwonlwat = JSON.parse(pyactlatpu);
    let qrissopyacmakwonli = {};
    let qrispyaclwat = [];
    for (let i = 0; i < pyackwonlwat.length; i++) {
	    qrissopyacmakwonli[pyackwonlwat[i].en] = pyackwonlwat[i].pya;
	    qrispyaclwat.push(pyackwonlwat[i].en);
    }
    fs.readFile(file, "utf8", function(err, sla7fkwonhlas) { 
      let qrissosla7fmakwonli = {};
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
        return cli7kryan(hlas[0]);
      });
      let nyifhlaslwat = {};
      sla7fkwonlwat = sla7fkwonlwat.map(hlas => {
        const nyifhlas = hlas.slice(1).join(" ").split(/[,;]/g);
        //nyifhlaslwat[hlas[0]] = hlas[0].length;
	nyifhlas.forEach(qristlat => {
          qristlat = qristlat.trim();
          let tyattlat = qrissosla7fmakwonli[qristlat] == undefined? "":
            qrissosla7fmakwonli[qristlat];
          const kwictlat = hlas[0] == undefined? "": cli7kryan(hlas[0]);
	 //if(qristlat == "all") { console.log(1+qristlat+tyattlat+tyattlat.length+" "+kwictlat+" " + (tyattlatlwat.includes(kwictlat))+ 
	 //        ( ! tyattlatlwat.includes(kwictlat) && ! /[0-9]/.test(kwictlat))); 
	 //        console.log(tyattlatlwat.indexOf(kwictlat) + tyattlatlwat[tyattlatlwat.indexOf(kwictlat)]);
	 //}

          if ((tyattlat.length == 0 || tyattlat.length > kwictlat.length 
                  //|| nyifhlaslwat[qristlat] > kwictlat.length
		  || (! sla7flwat.includes(tyattlat) && kwictlat.length > 0)
               ||  /[0-9]/.test(tyattlat)) 
                && ! tyattlatlwat.includes(kwictlat) && ! /[0-9]/.test(kwictlat)) {
              tyattlat = kwictlat;
	  //if(qristlat == "all") console.log(2+tyattlat+" "+kwictlat+ "nyifhlaslwat[tyattlat]" + nyifhlaslwat[qristlat]);
	  //if(tyattlat == "лист") console.log(3+qristlat);
	  qrissokwicmakwonli[qristlat] = tyattlat;
	  qrissosla7fmakwonli[qristlat] = tyattlat;
	  //    nyifhlaslwat[qristlat] = tyattlat.length;
	  if (qrispyaclwat.includes(qristlat)){
          	tyattlatlwat.push(tyattlat);
	  }
          }
        });
	let psastlat = cli7kryan(hlas[0]);
	let fyektlat = bvan(psastlat);
	//console.log(`${psastlat} ${fyektlat}`);
        return {"isv": psastlat, "isv_fyek": fyektlat, "en":nyifhlas[0]};
      });

      qrispyaclwat.forEach((qristlat) => {
	      qristlat = qristlat.replace(/_$/, "");
	      let kwictlat = qrissokwicmakwonli[qristlat]; 
	      if (kwictlat == undefined || kwictlat.length == 0) {
		      console.log(`error ${qristlat} undefined`);
	      }
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


