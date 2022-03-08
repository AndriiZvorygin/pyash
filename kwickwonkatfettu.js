#!/usr/bin/env  node
'use strict';

const fs = require('fs');
//const input = process.argv[2];
const qrishkom = "en";
const kwichkom = "ru";

function nyif(kwonlwat, tlat) {
for (let i = 0; i < kwonlwat.length; i++) {
  if (kwonlwat[i][tlat] && kwonlwat[i][tlat].length > 0) {
    return kwonlwat[i][tlat];
  }
  if (kwonlwat[i][qrishkom] && kwonlwat[i][qrishkom].length > 0) {
    return kwonlwat[i][qrishkom];
  }
}
return "";
}

function fyek(tlat) {
  return tlat.replace(/c/g,"ʃ").replace("j","ʒ").replace("2","˩")
    .replace("7","˥").replace("a","ä").replace("6","ə").replace("q","ŋ")
    .replace("h","ʰ").replace("y","j");
}

fs.readFile("dictionary_" + kwichkom + ".json", "utf8", function(err, kwictlatpu) {
	let kwickwonlwat = JSON.parse(kwictlatpu);
	let qrissokwicmakwonli = {};
	let kwicsoqrismakwonli = {};
  	for (let i = 0; i < kwickwonlwat.length; i++) {
		qrissokwicmakwonli[kwickwonlwat[i][qrishkom].replace(/-/g,"_")] = kwickwonlwat[i][kwichkom];
	}

fs.readFile("pyashWords.json", "utf8", function(err, pyashWords) { 
  const qriskwonlwat = JSON.parse(pyashWords);
  let qrissopyacmakwonli = {};
  let qrissoryanlwat = [];
  let pyacsoryanlwat = [];
  let hnucsoryanlwat = [];
  let pyackwon = {};
  let qriskwon = {};
  let hnuckwon = {};
//  let pyacsoqrismakwonli = {};
  for (let i = 0; i < qriskwonlwat.length; i++) {
    if (qriskwonlwat[i].pya == null || qriskwonlwat[i][qrishkom].length <= 1) continue;
    qrissoryanlwat.push([qriskwonlwat[i][qrishkom], qriskwonlwat[i].pya, qriskwonlwat[i].hnuc]);
    pyacsoryanlwat.push([qriskwonlwat[i].pya, qriskwonlwat[i].hnuc, qriskwonlwat[i][qrishkom]]);
    hnucsoryanlwat.push([qriskwonlwat[i].hnuc, qriskwonlwat[i].pya, qriskwonlwat[i][qrishkom]]);
//	  console.log(`${qrissokwicmakwonli[qriskwonlwat[i][qrishkom]]} ${qriskwonlwat[i][qrishkom]}`);
    pyackwon[qriskwonlwat[i].pya] = qrissokwicmakwonli[qriskwonlwat[i][qrishkom].replace(/_*$/g,"")];
    hnuckwon[qriskwonlwat[i].pya] = qriskwonlwat[i].hnuc;
    qriskwon[qriskwonlwat[i][qrishkom]] = qriskwonlwat[i].pya;
    qrissopyacmakwonli[qriskwonlwat[i][qrishkom]] = qriskwonlwat[i].pya;
//    pyacsoqrismakwonli[qriskwonlwat[i].pya] = qriskwonlwat[i][qrishkom];
  }
  fs.readFile("pyackwon.json", "utf8", function(err, pyackwonmrut) {
    const pyackwonlwat = JSON.parse(pyackwonmrut);
    for (let i = 0; i < pyackwonlwat.length; i++) {
  	pyackwon[pyackwonlwat[i].pya] = pyackwonlwat[i][qrishkom];
    }
    
  
  fs.readFile("dictionary_en.json", "utf8", function(err, contents) {
    if (err) return Error(err);
    let dictionary = JSON.parse(contents);
    //console.log(dictionary);
    const bli2s = dictionary[qrishkom].blacklist;
    const bli2scigwic = Object.keys(bli2s);
    for (let i = 0; i < bli2scigwic.length; i++) {
      qrissoryanlwat.push([bli2scigwic[i].slice(1).replace(/_/g,"-"), bli2s[bli2scigwic[i]].replace(/_/g,"-")]);
    }
    const qrissoryanlwatkanyitli = qrissoryanlwat.sort((hyik, tyut) => {
      return (hyik[0].localeCompare(tyut[0]));
    });
    const qrislwat = qrissoryanlwatkanyitli;
    //console.log(JSON.stringify(qrislwat.length));
    console.log("\\begin{multicols}{2}");
    console.log("\\scriptsize");
	
    console.log("\\section{Grammar}");
    console.log("\\subsection{Grammatical Mood}");
    let grammatical_moods = qriskwonlwat.filter((psut) => {
	return (/mood_$|clause_$/.test(psut[qrishkom]));
    });
    let grammatical_mood_strings = grammatical_moods.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_mood_strings.join("\n").replace(/_/g,"-"));
	  // tense
    console.log("\\subsection{Grammatical Tense}");
    let grammatical_tenses = qriskwonlwat.filter((psut) => {
	return (/tense_$/.test(psut[qrishkom]));
    });
    let grammatical_tense_strings = grammatical_tenses.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_tense_strings.join("\n").replace(/_/g,"-"));
	  // aspect
    console.log("\\subsection{Grammatical Aspect}");
    let grammatical_aspects = qriskwonlwat.filter((psut) => {
	return (/aspect_$/.test(psut[qrishkom]));
    });
    let grammatical_aspect_strings = grammatical_aspects.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_aspect_strings.join("\n").replace(/_/g,"-"));
	  // evidential
    console.log("\\subsection{Grammatical Evidential}");
    let grammatical_evidentials = qriskwonlwat.filter((psut) => {
	return (/evidential_$/.test(psut[qrishkom]));
    });
    let grammatical_evidential_strings = grammatical_evidentials.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_evidential_strings.join("\n").replace(/_/g,"-"));
	  // Cases
    console.log("\\subsection{Grammatical Cases}");
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
    console.log("\\subsection{Grammatical Possessive Markers}");
    let grammatical_genitive_cases = qriskwonlwat.filter((psut) => {
	return (/genitive_case_$|possession_$|possessed_case_$|possessive_marker_$/.test(psut[qrishkom]));
    });
    let grammatical_genitive_case_strings = grammatical_genitive_cases.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_genitive_case_strings.join("\n").replace(/_/g,"-"));
	  // Context
    console.log("\\subsection{Grammatical Contexts}");
    let grammatical_contexts = qriskwonlwat.filter((psut) => {
	return (/context_$/.test(psut[qrishkom]));
    });
    let grammatical_context_strings = grammatical_contexts.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_context_strings.join("\n").replace(/_/g,"-"));
	  // gender
    console.log("\\subsection{Grammatical Gender}");
    let grammatical_genders = qriskwonlwat.filter((psut) => {
	return (/gender_$/.test(psut[qrishkom]));
    });
    let grammatical_gender_strings = grammatical_genders.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_gender_strings.join("\n").replace(/_/g,"-"));
	  // number
    console.log("\\subsection{Grammatical Number}");
    let grammatical_numbers = qriskwonlwat.filter((psut) => {
	return (/number_$|ordinal_$|integer_$|vector_$/.test(psut[qrishkom]));
    });
    let grammatical_number_strings = grammatical_numbers.map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_number_strings.join("\n").replace(/_/g,"-"));
	  // pronoun
    console.log("\\subsection{Grammatical Pronouns}");
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
    console.log("\\subsection{Grammatical Emotions}");
    let grammatical_emotion_strings = xyektlatlwat.sort().map((qristlat) => {
            const pyactlat = qriskwon[qristlat];
	    return `\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${hnuckwon[pyactlat]}: ${qristlat}\\\\`;
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
    console.log("\\subsection{Grammatical Standard International Units}");
    let grammatical_si_units_strings = flantlatlwat.sort().map((qristlat) => {
            const pyactlat = qriskwon[qristlat];
	    return `\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${hnuckwon[pyactlat]}: ${qristlat}\\\\`;
    });
    console.log(grammatical_si_units_strings.join("\n").replace(/_/g,"-"));
    let lyat = ""
    console.log(`\\section{English to Pyash}`);
    //console.log(`\\subsection{  }`);
    let psas = "";
    for (let i = 0; i < qrislwat.length; i++) {
      const qrisryan = qrislwat[i];
      const qristlat = qrisryan[0];
      if (qristlat && qristlat[0].localeCompare(lyat) > 0 && qrisryan[1].length > 0) {
        lyat = qristlat[0];
        psas += `\\subsection{ ${lyat} }\n`;
      }
      if (qrisryan.length == 2 && qrisryan[1].length > 0) {
        psas += `${qristlat}: ${qrisryan[1]} \\\\\n`;
      }
      if (qrisryan.length == 3) {
        psas+=(`${qristlat}: \\textbf{${qrisryan[1]}} [\\emph{${fyek(qrisryan[1])}}] ${qrisryan[2]} \\\\\n`);
      }
    }
    console.log(psas.replace(/_/g,"-"));
    // pyacso kwon
    const pyacsoryanlwatkanyitli = pyacsoryanlwat.sort((hyik, tyut) => {
      return (hyik[0].localeCompare(tyut[0]));
    });
    const pyaclwat = pyacsoryanlwatkanyitli;
    console.log("\\section{Pyash to English}");
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
	      console.log(`pyactlat ${pyactlat}`);
	const nyifhtin = pyackwon[pyactlat].length > 0?  pyackwon[pyactlat] : pyacryan[3];
        psas += (`\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${pyacryan[1]}: ${nyifhtin}\\\\\n`);
      }
    }
    console.log(psas.replace(/_/g,"-"));
    // hnucso kwon
    const hnucsoryanlwatkanyitli = hnucsoryanlwat.sort((hyik, tyut) => {
      //console.log(`${hyik[0].substr(2)} ${parseInt(hyik[0].substr(2),16)} ${tyut[0].substr(2)} ${parseInt(tyut[0].substr(2),16)}`);
      return parseInt(hyik[0].substr(2),16) > parseInt(tyut[0].substr(2),16)? 1 : -1;
    });
    const hnuclwat = hnucsoryanlwatkanyitli;
    console.log("\\section{Pyash Numbers, Rhyming dictionary}");
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
	const nyifhtin = pyackwon[pyactlat].length > 0?  pyackwon[pyactlat] : hnucryan[3];
        psas +=(`${hnuctlat} \\textbf{${hnucryan[1]}} [\\emph{${fyek(hnucryan[1])}}]: ${nyifhtin}\\\\\n`);
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
