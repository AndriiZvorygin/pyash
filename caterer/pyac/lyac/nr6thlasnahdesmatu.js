#!/usr/bin/env node
'use strict';
const fs = require('fs');
const clattsen = require('child_process');
const file = "chinese_to_english.txt";
const qrishkom = "en";
const kwichkom = "hi";
//const tyutkwichkom = "ru";
const cyi7nhkom = "hi";
const bvanhkom = "hi";

function bvan(kwictlat) {
	 let myin = `espeak-ng -x --ipa -q  -v${bvanhkom} "${kwictlat}";`
	 let tlat = clattsen.execSync(myin).toString()
  	 return(tlat);
	return kwictlat;
	//return kwictlat? kwictlat.replace("ф","f"): kwictlat;
}

function cli7kryan(tlat) {
	return tlat;
//  if (tlat == undefined || tlat.length == 0) return tlat;
//  const ryantlat = 
//    tlat.toLowerCase().replace(/e$/,"") .replace(/e[ ]/g, " ")
//    .replace(/[Ьь]/g, "ј").replace(/[Єєєє]/g, "јe").replace(/[Її]/g, "ји")
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
//    .replace(/[Ss]/g, "s").replace(/ии/g, "i").replace(/ее/,"ејо")
//	.replace(/\ дело$/, " падеж");
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
//  return ryantlat;
}

  fs.readFile("pyashWords.json", "utf8", function(err, pyactlatpu) { 
    const pyackwonlwat = JSON.parse(pyactlatpu);
    let qrissopyacmakwonli = {};
    let qrispyaclwat = [];
    for (let i = 0; i < pyackwonlwat.length; i++) {
	    qrissopyacmakwonli[pyackwonlwat[i].en] = pyackwonlwat[i].pya;
	    qrispyaclwat.push(pyackwonlwat[i].en);
    }
fs.readFile("dictionary_" + kwichkom + ".json", "utf8", function(err, kwictlatpu) {
  let kwickwonlwat = JSON.parse(kwictlatpu);
  let cyi7nlwat = [];
  let qrissokwicmakwonli = {};
  let kwicsoqrismakwonli = {};
  let kwiclwat = [];
  for (let i = 0; i < kwickwonlwat.length; i++) {
  	let kwictlat = kwickwonlwat[i][kwichkom] && kwickwonlwat[i][kwichkom].replace(/\n/g,"");
	let qristlat = kwickwonlwat[i][qrishkom].replace(/-/g,"_");
	if (! kwiclwat.includes(kwictlat)) { 
  	  qrissokwicmakwonli[qristlat] = cli7kryan(kwictlat);
	  if (qrispyaclwat.includes(qristlat)) {
	  kwiclwat.push(kwictlat);
	  }
	}
	
  }
//fs.readFile("dictionary_" + tyutkwichkom + ".json", "utf8", function(err, kwictlatpu) {
//  for (let i = 0; i < kwickwonlwat.length; i++) {
//  	let kwictlat = kwickwonlwat[i][kwichkom] && kwickwonlwat[i][kwichkom].replace(/\n/g,"");
//	let qristlat = kwickwonlwat[i][qrishkom].replace(/-/g,"_");
//	if (! kwiclwat.includes(kwictlat)) { 
//  	  qrissokwicmakwonli[qristlat] = cli7kryan(kwictlat);
//	  if (qrispyaclwat.includes(qristlat)) {
//	  kwiclwat.push(kwictlat);
//	  }
//	}
//	
//  }
    fs.readFile(file, "utf8", function(err, cyi7nkwonhlas) { 
      let qrissocyi7nmakwonli = {};
      let cyi7nkwonlwat = cyi7nkwonhlas.toString().split("\n");;
      // split into lines of words
      cyi7nkwonlwat = cyi7nkwonlwat.map( hlas => {
        return hlas.split("\t").filter(tlat => {
          return ! /\.$/.test(tlat);
        });
      });
      // generate dictionary
      let tyattlatlwat = [];
      cyi7nlwat = cyi7nkwonlwat.map(hlas => {
        return cli7kryan(hlas[0]);
      });
      let nyifhlaslwat = {};
      cyi7nkwonlwat = cyi7nkwonlwat.map(hlas => {
        const nyifhlas = hlas.slice(1).join(" ").split(/[,;]/g);
        //nyifhlaslwat[hlas[0]] = hlas[0].length;
	nyifhlas.forEach(qristlat => {
          qristlat = qristlat.trim();
          let tyattlat = qrissocyi7nmakwonli[qristlat] == undefined? "":
            qrissocyi7nmakwonli[qristlat];
          const kwictlat = hlas[0] == undefined? "": cli7kryan(hlas[0]);
	 //if(qristlat == "all") { console.log(1+qristlat+tyattlat+tyattlat.length+" "+kwictlat+" " + (tyattlatlwat.includes(kwictlat))+ 
	 //        ( ! tyattlatlwat.includes(kwictlat) && ! /[0-9]/.test(kwictlat))); 
	 //        console.log(tyattlatlwat.indexOf(kwictlat) + tyattlatlwat[tyattlatlwat.indexOf(kwictlat)]);
	 //}

          if ((tyattlat.length == 0 || tyattlat.length > kwictlat.length 
                  //|| nyifhlaslwat[qristlat] > kwictlat.length
		  || (! cyi7nlwat.includes(tyattlat) && kwictlat.length > 0)
               ||  /[0-9]/.test(tyattlat)) 
                && ! tyattlatlwat.includes(kwictlat) && ! /[0-9]/.test(kwictlat)) {
              tyattlat = kwictlat;
	  //if(qristlat == "all") console.log(2+tyattlat+" "+kwictlat+ "nyifhlaslwat[tyattlat]" + nyifhlaslwat[qristlat]);
	  //if(tyattlat == "лист") console.log(3+qristlat);
	  qrissokwicmakwonli[qristlat] = tyattlat;
	  qrissocyi7nmakwonli[qristlat] = tyattlat;
	  //    nyifhlaslwat[qristlat] = tyattlat.length;
	  if (qrispyaclwat.includes(qristlat)){
          	tyattlatlwat.push(tyattlat);
	  }
          }
        });
	let psastlat = cli7kryan(hlas[0]);
	let fyektlat = bvan(psastlat);
	console.log(`${psastlat} ${fyektlat}`);
        return {"zh": psastlat, "zh_fyek": fyektlat, "en":nyifhlas[0]};
      });

      qrispyaclwat.forEach((qristlat) => {
	      let hnunqristlat = qristlat.replace(/_*$/, "");
	      let kwictlat = qrissokwicmakwonli[hnunqristlat]; 
	      if (kwictlat == undefined || kwictlat.length == 0) {
		     // console.log(`error ${hnunqristlat} undefined`);
	      }
      });
      let syacpyackwonlwat = pyackwonlwat.map((psut) => {
	      const qristlat = psut.en.replace(/_*$/, "");
	      const kwictlat = qrissokwicmakwonli[qristlat];
	      psut[kwichkom] = kwictlat;
	      psut[`${kwichkom}_fyek`] = bvan(kwictlat);
	   //   console.log("kwim" + JSON.stringify(psut));
//	      console.log(`${qristlat} ${psut.fi}`);
	      return psut;
      });
      cyi7nkwonlwat.forEach((psut) => {
	if (qrissopyacmakwonli[psut.en] == undefined) {
           syacpyackwonlwat.push(psut);
        }
      });

      for (let i = 0; i < cyi7nkwonlwat.length; i++) {
  	let cyi7ntlat = cyi7nkwonlwat[i][cyi7nhkom] && cyi7nkwonlwat[i][cyi7nhkom].replace(/\n/g,"");
	if (cyi7nkwonlwat[i][qrishkom]) {
  	qrissocyi7nmakwonli[cyi7nkwonlwat[i][qrishkom].replace(/-/g,"_")] = cyi7ntlat;
	}
      }
      //console.log(JSON.stringify(cyi7nkwonlwat));
      //console.log(JSON.stringify(qrissokwicmakwonli));
	console.log(JSON.stringify(syacpyackwonlwat));
    });
  });
});
//});


