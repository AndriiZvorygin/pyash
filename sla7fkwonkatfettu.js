#!/usr/bin/env  node
'use strict';

const fs = require('fs');
//const input = process.argv[2];
const qrishkom = "en";
const kwichkom = "isv";
const kwichnim = "Меджусловјанскы";
const kwicpyachnim = "пјаш";
const clattsen = require('child_process');

function bvan(kwictlat) {
	  let myin = `espeak-ng -x --ipa -q  -v${kwichkom} "${kwictlat}";`
  	  return(clattsen.execSync(myin).toString());
}

function ryan(kwickwonli, qristlatpu) {
  let dluk = qristlatpu.includes(",")? ", " : " ";
  const qristlatlwat = qristlatpu.split(dluk);
  
  const psas = qristlatlwat.map((tlat) => {
    const syamtlat = tlat.replace(/-/g,"_").replace(/_$/,"");
  	return kwickwonli[syamtlat];	
  }).join(dluk);
  return psas;
}

function nyif(kwonlwat, tlat) {
for (let i = 0; i < kwonlwat.length; i++) {
  if (kwonlwat[i][tlat] && kwonlwat[i][tlat].length > 0) {

     const kwictlat = kwonlwat[i][tlat];
     return `${kwictlat}`;
  }
  if (kwonlwat[i][kwichkom] && kwonlwat[i][kwichkom].length > 0) {
    const kwictlat = kwonlwat[i][kwichkom];
    return `${kwictlat}`;
  }
}
return "";
}

function fyek(tlat) {
  return tlat.replace(/c/g,"ʃ").replace("j","ʒ").replace("2","˩")
    .replace("7","˥").replace("a","ä").replace("6","ə").replace("q","ŋ")
    .replace("h","ʰ").replace("y","j");
}

function cli7kryan(tlat) {
	return tlat == undefined || tlat.length == 0? tlat: 
		tlat.replace(/[Ьь]/g, "ј").replace(/Єє/g, "је").replace(/Її/g, "ји").replace(/Йй/g, "иј").replace(/Юю/g, "ју").replace(/Яяя/g, "ја")
}



fs.readFile("dictionary_" + kwichkom + ".json", "utf8", function(err, kwictlatpu) {
	let kwickwonlwat = JSON.parse(kwictlatpu);
	let qrissokwicmakwonli = {};
	let kwicsoqrismakwonli = {};
        let pyackwon = {};
  	for (let i = 0; i < kwickwonlwat.length; i++) {
		let kwictlat = kwickwonlwat[i][kwichkom] && kwickwonlwat[i][kwichkom].replace(/\n/g,"");
		qrissokwicmakwonli[kwickwonlwat[i][qrishkom].replace(/-/g,"_")] = cli7kryan(kwictlat);
                if (kwickwonlwat[i].pya) {
                  //if (kwickwonlwat[i].pya.localeCompare("trah") == 0) {
                  //console.log(` pyackwon[${kwickwonlwat[i].pya}] = ${kwickwonlwat[i][kwichkom]}`);
                  //}
                  pyackwon[kwickwonlwat[i].pya] = kwickwonlwat[i][kwichkom];
                }
               
	}
	const kwickwon = qrissokwicmakwonli;

fs.readFile("pyashWords.json", "utf8", function(err, pyashWords) { 
  const qriskwonlwat = JSON.parse(pyashWords);
  let qrissopyacmakwonli = {};
  let qrissoryanlwat = [];
  let kwicsoryanlwat = [];
  let pyacsoryanlwat = [];
  let hnucsoryanlwat = [];
  let qriskwon = {};
  let hnuckwon = {};
  let kwictlat = "";
//  let pyacsoqrismakwonli = {};
  for (let i = 0; i < qriskwonlwat.length; i++) {
    if (qriskwonlwat[i].pya == null || qriskwonlwat[i][qrishkom].length <= 1) continue;
    qrissoryanlwat.push([qriskwonlwat[i][qrishkom], qriskwonlwat[i].pya, qriskwonlwat[i].hnuc]);
    kwictlat = ryan(kwickwon, qriskwonlwat[i][qrishkom]);
    if (kwictlat.length > 0 && kwictlat.split(" ").length == 1) {
    kwicsoryanlwat.push([kwictlat, qriskwonlwat[i].pya, qriskwonlwat[i].hnuc, qriskwonlwat[i].en]);
    }
    pyacsoryanlwat.push([qriskwonlwat[i].pya, qriskwonlwat[i].hnuc, qriskwonlwat[i][qrishkom]]);
    hnucsoryanlwat.push([qriskwonlwat[i].hnuc, qriskwonlwat[i].pya, qriskwonlwat[i][qrishkom]]);
//	  console.log(`${qrissokwicmakwonli[qriskwonlwat[i][qrishkom]]} ${qriskwonlwat[i][qrishkom]}`);
    if (qrissokwicmakwonli[qriskwonlwat[i][qrishkom].replace(/_*$/g,"")]){
    pyackwon[qriskwonlwat[i].pya] = qrissokwicmakwonli[qriskwonlwat[i][qrishkom].replace(/_*$/g,"")];
    }
    hnuckwon[qriskwonlwat[i].pya] = qriskwonlwat[i].hnuc;
    qriskwon[qriskwonlwat[i][qrishkom]] = qriskwonlwat[i].pya;
    qrissopyacmakwonli[qriskwonlwat[i][qrishkom]] = qriskwonlwat[i].pya;
//    pyacsoqrismakwonli[qriskwonlwat[i].pya] = qriskwonlwat[i][qrishkom];
  }
  fs.readFile("pyackwon.json", "utf8", function(err, pyackwonmrut) {
    const pyackwonlwat = JSON.parse(pyackwonmrut);
    for (let i = 0; i < pyackwonlwat.length; i++) {
        if (pyackwonlwat[i][qrishkom].length > 0) {
  	pyackwon[pyackwonlwat[i].pya] = pyackwonlwat[i][qrishkom];
        }
    }
    
  
  fs.readFile("dictionary_en.json", "utf8", function(err, contents) {
    if (err) return Error(err);
    let dictionary = JSON.parse(contents);
    //console.log(dictionary);
	  // populate blacklist entries
    const bli2s = dictionary[qrishkom].blacklist;
    const bli2scigwic = Object.keys(bli2s);
    for (let i = 0; i < bli2scigwic.length; i++) {
      qrissoryanlwat.push([bli2scigwic[i].slice(1).replace(/_/g,"-"),]);
      kwictlat = ryan(kwickwon, bli2scigwic[i].slice(1)) && 
                 ryan(kwickwon, bli2scigwic[i].slice(1)).replace(/_/g,"-");
      if (kwictlat.length > 0 && kwictlat.split(" ").length == 1) {
      kwicsoryanlwat.push([kwictlat,  ryan(kwickwon, bli2s[bli2scigwic[i]].replace(/_/g,"-"))]);
      }
    }
	  // sort alphabetically
    const qrissoryanlwatkanyitli = qrissoryanlwat.sort((hyik, tyut) => {
      return (hyik[0].localeCompare(tyut[0]));
    });
    const kwicsoryanlwatkanyitli = kwicsoryanlwat.sort((hyik, tyut) => {
      return (hyik[0].localeCompare(tyut[0]));
    });
    const qrislwat = qrissoryanlwatkanyitli;
    const kwiclwat = kwicsoryanlwatkanyitli;
    //console.log(JSON.stringify(qrislwat.length));
    console.log("\\begin{multicols}{2}");
    console.log("\\scriptsize");
	
    console.log(`\\section{${qrissokwicmakwonli["grammar"]}}`);
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical mood")}}`);
    let grammatical_moods = qriskwonlwat.filter((psut) => {
	return (/mood_$|clause_$/.test(psut[qrishkom]));
    });
    let grammatical_mood_strings = grammatical_moods.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_mood_strings.join("\n").replace(/_/g,"-"));
	  // tense
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical tense")}}`);
    let grammatical_tenses = qriskwonlwat.filter((psut) => {
	return (/tense_$/.test(psut[qrishkom]));
    });
    let grammatical_tense_strings = grammatical_tenses.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_tense_strings.join("\n").replace(/_/g,"-"));
	  // aspect
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical aspect")}}`);
    let grammatical_aspects = qriskwonlwat.filter((psut) => {
	return (/aspect_$/.test(psut[qrishkom]));
    });
    let grammatical_aspect_strings = grammatical_aspects.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_aspect_strings.join("\n").replace(/_/g,"-"));
	  // evidential
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical evidential")}}`);
    let grammatical_evidentials = qriskwonlwat.filter((psut) => {
	return (/evidential_$/.test(psut[qrishkom]));
    });
    let grammatical_evidential_strings = grammatical_evidentials.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_evidential_strings.join("\n").replace(/_/g,"-"));
	  // Cases
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical case")}}`);
    let grammatical_cases = qriskwonlwat.filter((psut) => {
        if (/genitive_case_$|possessed_case_$/.test(psut[qrishkom])) {
          return false;
        }
	return (/case_$|intransitive_$/.test(psut[qrishkom]));
    });
    let grammatical_case_strings = grammatical_cases.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_case_strings.join("\n").replace(/_/g,"-"));
	  // Genitive Cases
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical possessive marker")}}`);
    let grammatical_genitive_cases = qriskwonlwat.filter((psut) => {
	return (/genitive_case_$|possession_$|possessed_case_$|possessive_marker_$/.test(psut[qrishkom]));
    });
    let grammatical_genitive_case_strings = grammatical_genitive_cases.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_genitive_case_strings.join("\n").replace(/_/g,"-"));
	  // Context
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical context")}}`);
    let grammatical_contexts = qriskwonlwat.filter((psut) => {
	return (/context_$/.test(psut[qrishkom]));
    });
    let grammatical_context_strings = grammatical_contexts.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_context_strings.join("\n").replace(/_/g,"-"));
	  // gender
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical gender")}}`);
    let grammatical_genders = qriskwonlwat.filter((psut) => {
	return (/gender_$/.test(psut[qrishkom]));
    });
    let grammatical_gender_strings = grammatical_genders.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_gender_strings.join("\n").replace(/_/g,"-"));
	  // number
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical number")}}`);
    let grammatical_numbers = qriskwonlwat.filter((psut) => {
	return (/number_$|ordinal_$|integer_$|vector_$/.test(psut[qrishkom]));
    });
    let grammatical_number_strings = grammatical_numbers.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_number_strings.join("\n").replace(/_/g,"-"));
	  // pronoun
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical pronoun")}}`);
    let grammatical_pronouns = qriskwonlwat.filter((psut) => {
	return (/^me_$|^us_$|^you_$|^it_$|reflexive_voice_$|^proximity_$|distal_demonstrative_|^question_$|^other_$/.test(psut[qrishkom]));
    });
    let grammatical_pronoun_strings = grammatical_pronouns.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_pronoun_strings.join("\n").replace(/_/g,"-"));
	  // emotion
  fs.readFile("emotionWords.txt", "utf8", function(err, xyektlatmrut) {
    let xyektlatlwatmrut = xyektlatmrut.split('\n');
    let xyektlatlwat = [];
    for (let i = 0; i < xyektlatlwatmrut.length; i++) {
        if (qriskwon[xyektlatlwatmrut[i]+"_"]) {
  	  xyektlatlwat.push(xyektlatlwatmrut[i]+"_");
        }
    }
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical emotion")}}`);
    let grammatical_emotion_strings = xyektlatlwat.sort().map((qristlat) => {
            const pyactlat = qriskwon[qristlat];
	    return `\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${hnuckwon[pyactlat]}: ${qrissokwicmakwonli[qristlat.replace(/_$/g,"")]}\\\\`;
    });
    console.log(grammatical_emotion_strings.join("\n").replace(/_/g,"-"));
    //console.log(xyektlatlwat);
    //console.log(xyektlatlwatmrut);
	  // si-units
  fs.readFile("si-units.txt", "utf8", function(err, flantlatmrut) {
    let flantlatlwatmrut = flantlatmrut.split('\n');
    let flantlatlwat = [];
    for (let i = 0; i < flantlatlwatmrut.length; i++) {
        if (qriskwon[flantlatlwatmrut[i]+"_"]) {
  	  flantlatlwat.push(flantlatlwatmrut[i]+"_");
        }
    }
    console.log(`\\subsection{${ryan(qrissokwicmakwonli,"grammatical standard international si_units")}}`);
    let grammatical_si_units_strings = flantlatlwat.sort().map((qristlat) => {
            const pyactlat = qriskwon[qristlat];
	    return `\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${hnuckwon[pyactlat]}: ${qrissokwicmakwonli[qristlat.replace(/_$/g,"")]}\\\\`;
    });
    console.log(grammatical_si_units_strings.join("\n").replace(/_/g,"-"));
    let lyat = ""
    console.log(`\\section{${kwichnim} -> ${kwicpyachnim}}`);
    let psas = "";
    //console.log(`kwiclwat.length ${kwiclwat.length}`);
    for (let i = 0; i < kwiclwat.length; i++) {
      const kwicryan = kwiclwat[i];
      const kwictlat = kwicryan[0];
      if (kwictlat && kwictlat[0].localeCompare(lyat) > 0 && kwicryan[1].length > 0) {
        lyat = kwictlat[0];
        psas += `\\subsection{ ${lyat} }\n`;
      }
      if (kwicryan.length == 2 && kwicryan[1].length > 0) {
        psas += `${kwictlat}: ${kwicryan[1]} \\\\\n`;
      }
      if (kwicryan.length == 4) {
        psas+=(`${kwictlat}: \\textbf{${kwicryan[1]}} [\\emph{${fyek(kwicryan[1])}}] ${kwicryan[2]} (${kwicryan[3]}) \\\\\n`);
      }
    }
    // 
    console.log(psas.replace(/_/g,"-"));
    // pyacso kwon
    const pyacsoryanlwatkanyitli = pyacsoryanlwat.sort((hyik, tyut) => {
      return (hyik[0].localeCompare(tyut[0]));
    });
    const pyaclwat = pyacsoryanlwatkanyitli;
    console.log(`\\section{${kwicpyachnim} -> ${kwichnim}}`);
    lyat = "";
    psas = "";
    for (let i = 0; i < pyaclwat.length; i++) {
      const pyacryan = pyaclwat[i];
      const pyactlat = pyacryan[0];
      if (pyactlat && pyactlat[0].localeCompare(lyat) > 0) {
        lyat = pyactlat[0];
        psas += (`\\subsection{ ${lyat} }\n`);
      }
      if (pyacryan.length == 2 && pyacryan[1].length > 0) {
        psas += (`${pyactlat}: ${pyacryan[1]} \\\\\n`);
      }
	    // command = 'echo \"' + word.toString() + '\" | espeak-ng --stdin --ipa -q ' + ' -v ' + inLangCode;
      if (pyacryan.length == 3) {
	     //console.log(`pyactlat ${pyactlat}`);
	const nyifhtin = pyackwon[pyactlat] && pyackwon[pyactlat].length > 0?  pyackwon[pyactlat] : pyacryan[3];
        if (nyifhtin == undefined) {
          console.log("error undefined word");
          console.log(`\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${pyacryan[1]} (${pyacryan[3]}): ${nyifhtin}\\\\\n`);
          exit();
        }
        psas += (`\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${pyacryan[1]} (${pyacryan[2]}): ${nyifhtin}\\\\\n`);
      }
    }
    console.log(psas.replace(/_/g,"-"));
    // hnucso kwon
    const hnucsoryanlwatkanyitli = hnucsoryanlwat.sort((hyik, tyut) => {
      //console.log(`${hyik[0].substr(2)} ${parseInt(hyik[0].substr(2),16)} ${tyut[0].substr(2)} ${parseInt(tyut[0].substr(2),16)}`);
      return parseInt(hyik[0].substr(2),16) > parseInt(tyut[0].substr(2),16)? 1 : -1;
    });
    const hnuclwat = hnucsoryanlwatkanyitli;
    console.log(`\\section{${kwicpyachnim} Numbers, Rhyming dictionary}`);
    psas = ""
    lyat = "0";
    console.log(`\\subsection{ 0 }`);
    for (let i = 0; i < hnuclwat.length; i++) {
      const hnucryan = hnuclwat[i];
      const hnuctlat = hnucryan[0];
      if (hnuctlat && parseInt(hnuctlat[2], 16) > parseInt(lyat, 16)) {
        lyat = hnuctlat[2];
        psas+=(`\\subsection{ ${lyat} }\n`);
      }
      if (hnucryan.length == 2 && hnucryan[1].length > 0) {
        psas +=(`${hnuctlat}: ${hnucryan[1]} \\\\\n`);
      }
      if (hnucryan.length == 3) {
	const pyactlat = hnucryan[1];
        // console.log(pyactlat);
	const nyifhtin = pyackwon[pyactlat] && pyackwon[pyactlat].length > 0?  `${pyackwon[pyactlat]}`  : hnucryan[3];
        psas +=(`${hnuctlat} \\textbf{${hnucryan[1]}} [\\emph{${fyek(hnucryan[1])}}] (${hnucryan[2]}): ${nyifhtin}\\\\\n`);
      }
    }
    console.log(psas.replace(/_/g,"-"));
    // hgafkwonli
    console.log("\\end{multicols}");
    //console.log(flantlatlwat);
    //console.log(flantlatlwatmrut);
  });
});
});
});
});
});
