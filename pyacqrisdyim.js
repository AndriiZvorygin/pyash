#!/usr/bin/env node
'use strict';
const fs = require('fs');
const clattsen = require('child_process');
const file = process.argv[2];

fs.readFile(file, "utf8", function(err, pyashWords) { 
  const kwickwonlwat = pyashWords.toString().split("\n");;
	let kle7nmyin = ""
	let grutkle7nmyin = ""
	console.log(JSON.stringify(kwickwonlwat));
	  let myin = `espeak-ng -x -s450 -w na.wav -vpy+f2 na};` 
  	  console.log(clattsen.execSync(myin).toString());
	  myin = `espeak-ng -x -s450 -w kali.wav -vpy+f2 kali};` 
  	  console.log(clattsen.execSync(myin).toString());
  kwickwonlwat.map((kwichlas, htik)  => {
	  if (kwichlas.length == 0) return 0;
	  kwichlas = kwichlas.split(/,(.+)/);
	  let myin = `espeak-ng -x -s300 -w ${htik}-0.wav -vpy+f2 ${kwichlas[0]};` 
  	  console.log(clattsen.execSync(myin).toString());
          myin = `espeak-ng -w ${htik}-1.wav -s450 -x -ven ${kwichlas[1]};`
  	  console.log(clattsen.execSync(myin).toString());
	  //console.log(myin);
	  kle7nmyin += ` ${htik}-0.wav na.wav ${htik}-1.wav kali.wav`
          grutkle7nmyin = ` ${htik}-1.wav na.wav ${htik}-0.wav kali.wav`
  });
  clattsen.execSync("sox " + kle7nmyin + grutkle7nmyin + ` ${file}.mp3`);
  clattsen.execSync("rm *.wav");
  

});
