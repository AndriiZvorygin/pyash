#!/usr/bin/env  node
'use strict';

const fs = require('fs');
//const input = process.argv[2];
const kwichkom = "en";
function nyif(kwonlwat, tlat) {
for (let i = 0; i < kwonlwat.length; i++) {
  if (kwonlwat[i][tlat] && kwonlwat[i][tlat].length > 0) {
    return kwonlwat[i][tlat];
  }
  if (kwonlwat[i][kwichkom] && kwonlwat[i][kwichkom].length > 0) {
    return kwonlwat[i][kwichkom];
  }
}
return "";
}

function fyek(tlat) {
  return tlat.replace(/c/g,"ʃ").replace("j","ʒ").replace("2","˩")
    .replace("7","˥").replace("a","ä").replace("6","ə").replace("q","ŋ")
    .replace("h","ʰ").replace("y","j");
}

fs.readFile("cwec.txt", "utf8", function(err, cwechfas) { 
  const cweclwat = cwechfas.split("\n");
fs.readFile("xyek.txt", "utf8", function(err, xyekhfas) { 
  const xyeklwat = xyekhfas.split("\n");
fs.readFile("drac.txt", "utf8", function(err, drachfas) { 
  const draclwat = drachfas.split("\n");
fs.readFile("hyan.txt", "utf8", function(err, hyanhfas) { 
  const hyanlwat = hyanhfas.split("\n");
fs.readFile("hcit.txt", "utf8", function(err, hcithfas) { 
  const hcitlwat = hcithfas.split("\n");
fs.readFile("hjep.txt", "utf8", function(err, hjephfas) { 
  const hjeplwat = hjephfas.split("\n");
fs.readFile("nyit.txt", "utf8", function(err, nyithfas) { 
  const nyitlwat = nyithfas.split("\n");
fs.readFile("hn6t.txt", "utf8", function(err, hn6thfas) { 
  const hn6tlwat = hn6thfas.split("\n");
fs.readFile("psam.txt", "utf8", function(err, psamhfas) { 
  const psamlwat = psamhfas.split("\n");
fs.readFile("hnim.txt", "utf8", function(err, hnimhfas) { 
  const hnimlwat = hnimhfas.split("\n");
fs.readFile("gvak.txt", "utf8", function(err, gvakhfas) { 
  const gvaklwat = gvakhfas.split("\n");
fs.readFile("pyashWords.json", "utf8", function(err, pyashWords) { 
  const kwickwonlwat = JSON.parse(pyashWords);
  let kwicsopyacmakwonli = {};
  let kwicsoryanlwat = [];
  let pyacsoryanlwat = [];
  let hnucsoryanlwat = [];
  let pyackwon = {};
  let kwickwon = {};
  let hnuckwon = {};
//  let pyacsokwicmakwonli = {};
  for (let i = 0; i < kwickwonlwat.length; i++) {
    if (kwickwonlwat[i].pya == null || kwickwonlwat[i][kwichkom].length <= 1) continue;
    kwicsoryanlwat.push([kwickwonlwat[i][kwichkom], kwickwonlwat[i].pya, kwickwonlwat[i].hnuc]);
    pyacsoryanlwat.push([kwickwonlwat[i].pya, kwickwonlwat[i].hnuc, kwickwonlwat[i][kwichkom]]);
    hnucsoryanlwat.push([kwickwonlwat[i].hnuc, kwickwonlwat[i].pya, kwickwonlwat[i][kwichkom]]);
    pyackwon[kwickwonlwat[i].pya] = kwickwonlwat[i][kwichkom];
    hnuckwon[kwickwonlwat[i].pya] = kwickwonlwat[i].hnuc;
    kwickwon[kwickwonlwat[i][kwichkom]] = kwickwonlwat[i].pya;
    kwicsopyacmakwonli[kwickwonlwat[i][kwichkom]] = kwickwonlwat[i].pya;
//    pyacsokwicmakwonli[kwickwonlwat[i].pya] = kwickwonlwat[i][kwichkom];
  }
  fs.readFile("pyackwon.json", "utf8", function(err, pyackwonmrut) {
    const pyackwonlwat = JSON.parse(pyackwonmrut);
    for (let i = 0; i < pyackwonlwat.length; i++) {
  	pyackwon[pyackwonlwat[i].pya] = pyackwonlwat[i][kwichkom];
    }
    
  
  fs.readFile("dictionary_en.json", "utf8", function(err, contents) {
    if (err) return Error(err);
    let dictionary = JSON.parse(contents);
    //console.log(dictionary);
    const bli2s = dictionary[kwichkom].blacklist;
    const bli2scigwic = Object.keys(bli2s);
    for (let i = 0; i < bli2scigwic.length; i++) {
      kwicsoryanlwat.push([bli2scigwic[i].slice(1).replace(/_/g,"-"), bli2s[bli2scigwic[i]].replace(/_/g,"-")]);
    }
    const kwicsoryanlwatkanyitli = kwicsoryanlwat.sort((hyik, tyut) => {
      return (hyik[0].localeCompare(tyut[0]));
    });
    const kwiclwat = kwicsoryanlwatkanyitli;
    //console.log(JSON.stringify(kwiclwat.length));
    console.log("\\begin{multicols}{2}");
    console.log("\\scriptsize");
	
    console.log("\\section{Grammar}");
    console.log("\\subsection{Grammatical Mood}");

    let used_grammar_words = [];
    let grammatical_moods = kwickwonlwat.filter((psut) => {
	return (/mood_$|clause_$/.test(psut[kwichkom]) 
                || psamlwat.includes(psut.pya));
    });
    let grammatical_mood_strings = grammatical_moods.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_mood_strings.join("\n").replace(/_/g,"-"));
	  // tense
    console.log("\\subsection{Grammatical Tense}");
    let grammatical_tenses = kwickwonlwat.filter((psut) => {
	return (/tense_$|perfective_$|hodiernal_$/.test(psut[kwichkom]));
    });
    let grammatical_tense_strings = grammatical_tenses.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_tense_strings.join("\n").replace(/_/g,"-"));
	  // aspect
    console.log("\\subsection{Grammatical Aspect}");
    let grammatical_aspects = kwickwonlwat.filter((psut) => {
	return (/aspect_$|duration_$|perfective_$|term_$/.test(psut[kwichkom]));
    });
    let grammatical_aspect_strings = grammatical_aspects.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_aspect_strings.join("\n").replace(/_/g,"-"));
	  // verb
    console.log("\\subsection{Grammatical Verbal Modifiers}");
    let grammatical_cwec = kwickwonlwat.filter((psut) => {
	return (cweclwat.includes(psut.pya));
    });
    let grammatical_cwec_strings = grammatical_cwec.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_cwec_strings.join("\n").replace(/_/g,"-"));
	  // evidential
    console.log("\\subsection{Grammatical Evidential}");
    let grammatical_evidentials = kwickwonlwat.filter((psut) => {
	return (/evidential_$|speech_$/.test(psut[kwichkom]));
    });
    let grammatical_evidential_strings = grammatical_evidentials.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_evidential_strings.join("\n").replace(/_/g,"-"));
    // dependent clauses
    console.log("\\subsection{Grammatical Dependent Clauses}");
    let grammatical_hyan = kwickwonlwat.filter((psut) => {
	return (hyanlwat.includes(psut.pya));
    });
    let grammatical_hyan_strings = grammatical_hyan.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_hyan_strings.join("\n").replace(/_/g,"-"));
	  // Cases
    console.log("\\subsection{Grammatical Cases}");
    let grammatical_cases = kwickwonlwat.filter((psut) => {
        if (/genitive_case_$|possessed_case_$/.test(psut[kwichkom])) {
          return false;
        }
	return (/case_$|intransitive_$/.test(psut[kwichkom]) || gvaklwat.includes(psut.pya));
    });
    let grammatical_case_strings = grammatical_cases.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_case_strings.join("\n").replace(/_/g,"-"));
	  // Context
    console.log("\\subsection{Grammatical Contexts}");
    let grammatical_contexts = kwickwonlwat.filter((psut) => {
	return (/context_$/.test(psut[kwichkom]));
    });
    let grammatical_context_strings = grammatical_contexts.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_context_strings.join("\n").replace(/_/g,"-"));
	  // Genitive Cases
    console.log("\\subsection{Grammatical Possessive Markers}");
    let grammatical_genitive_cases = kwickwonlwat.filter((psut) => {
	return (/genitive_case_$|possession_$|possessed_case_$|possessive_marker_$/.test(psut[kwichkom]));
    });
    let grammatical_genitive_case_strings = grammatical_genitive_cases.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_genitive_case_strings.join("\n").replace(/_/g,"-"));
	  // Adjective
    console.log("\\subsection{Grammatical Adjectives}");
    let grammatical_adjectives = kwickwonlwat.filter((psut) => {
	return (hcitlwat.includes(psut.pya));
    });
    let grammatical_adjective_strings = grammatical_adjectives.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_adjective_strings.join("\n").replace(/_/g,"-"));
	  // Connector
    console.log("\\subsection{Grammatical Connectors}");
    let grammatical_connectors = kwickwonlwat.filter((psut) => {
	return (hn6tlwat.includes(psut.pya));
    });
    let grammatical_connector_strings = grammatical_connectors.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_connector_strings.join("\n").replace(/_/g,"-"));
	  // Sort
    console.log("\\subsection{Grammatical Sorts}");
    let grammatical_sorts = kwickwonlwat.filter((psut) => {
	return (nyitlwat.includes(psut.pya));
    });
    let grammatical_sort_strings = grammatical_sorts.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_sort_strings.join("\n").replace(/_/g,"-"));
	  // gender
    console.log("\\subsection{Grammatical Gender}");
    let grammatical_genders = kwickwonlwat.filter((psut) => {
	return (/gender_$/.test(psut[kwichkom]) ||
                hjeplwat.includes(psut.pya));
    });
    let grammatical_gender_strings = grammatical_genders.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_gender_strings.join("\n").replace(/_/g,"-"));
	  // number
    console.log("\\subsection{Grammatical Number}");
    let grammatical_numbers = kwickwonlwat.filter((psut) => {
	return (/number_$|ordinal_$|integer_$|vector_$/.test(psut[kwichkom]));
    });
    let grammatical_number_strings = grammatical_numbers.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_number_strings.join("\n").replace(/_/g,"-"));
	  // pronoun
    console.log("\\subsection{Grammatical Pronouns}");
    let grammatical_pronouns = kwickwonlwat.filter((psut) => {
	return (/^me_$|^us_$|^you_$|^it_$|reflexive_voice_$|^proximity_$|distal_demonstrative_|^question_$|^other_$/.test(psut[kwichkom])
                || hnimlwat.includes(psut.pya));
    });
    let grammatical_pronoun_strings = grammatical_pronouns.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_pronoun_strings.join("\n").replace(/_/g,"-"));
    // Discourse Particles
    console.log("\\subsection{Grammatical Discourse}");
    let grammatical_drac = kwickwonlwat.filter((psut) => {
	return (draclwat.includes(psut.pya));
    });
    let grammatical_drac_strings = grammatical_drac.map((psut) => {
	    used_grammar_words.push(psut.pya);
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${psut.hnuc}: ${nyif([pyackwon, psut], psut.pya)}\\\\`;
    });
    console.log(grammatical_drac_strings.join("\n").replace(/_/g,"-"));
	  // emotion
  fs.readFile("emotionWords.txt", "utf8", function(err, xyektlatmrut) {
    let xyektlatlwatmrut = xyektlatmrut.split('\n');
    let xyektlatlwat = [];
    for (let i = 0; i < xyektlatlwatmrut.length; i++) {
        if (kwickwon[xyektlatlwatmrut[i]+"_"]) {
  	  xyektlatlwat.push(xyektlatlwatmrut[i]+"_");
        }
    } 
    kwickwonlwat.forEach((psut) => {
	if (xyeklwat.includes(psut.pya)) {
          xyektlatlwat.push(psut.en);
        }
    });

    console.log("\\subsection{Grammatical Emotions}");
    let grammatical_emotion_strings = xyektlatlwat.sort().map((kwictlat) => {
            const pyactlat = kwickwon[kwictlat];
	    used_grammar_words.push(pyactlat);
	    return `\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${hnuckwon[pyactlat]}: ${kwictlat}\\\\`;
    });
    console.log(grammatical_emotion_strings.join("\n").replace(/_/g,"-"));
    //console.log(xyektlatlwat);
    //console.log(xyektlatlwatmrut);
	  // si-units
  fs.readFile("si-units.txt", "utf8", function(err, flantlatmrut) {
    let flantlatlwatmrut = flantlatmrut.split('\n');
    let flantlatlwat = [];
    for (let i = 0; i < flantlatlwatmrut.length; i++) {
        if (kwickwon[flantlatlwatmrut[i]+"_"]) {
  	  flantlatlwat.push(flantlatlwatmrut[i]+"_");
        }
    }
    console.log("\\subsection{Grammatical Standard International Units}");
    let grammatical_si_units_strings = flantlatlwat.sort().map((kwictlat) => {
            const pyactlat = kwickwon[kwictlat];
	    used_grammar_words.push(pyactlat);
	    return `\\textbf{${pyactlat}} [\\emph{${fyek(pyactlat)}}] ${hnuckwon[pyactlat]}: ${kwictlat}\\\\`;
    });
    console.log(grammatical_si_units_strings.join("\n").replace(/_/g,"-"));
    console.log("\\subsection{Other Grammar}");
    let other_grammar = kwickwonlwat.filter((psut) => {
      if (/[aeiou627h]$/.test(psut.pya) 
           && ! used_grammar_words.includes(psut.pya)
           && psut.en != undefined) {
        return true;
      } else {
       return false;
      }
    });
    let other_grammar_strings = other_grammar.sort().map((psut) => {
	    return `\\textbf{${psut.pya}} [\\emph{${fyek(psut.pya)}}] ${hnuckwon[psut.pya]}: ${psut.en}\\\\`;
    });
    console.log(other_grammar_strings.join("\n").replace(/_/g,"-"));

    let lyat = ""
    console.log(`\\section{English to Pyash}`);
    //console.log(`\\subsection{  }`);
    let psas = "";
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
      if (kwicryan.length == 3) {
        psas+=(`${kwictlat}: \\textbf{${kwicryan[1]}} [\\emph{${fyek(kwicryan[1])}}] ${kwicryan[2]} \\\\\n`);
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
