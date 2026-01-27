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
  kwickwonlwat.map((kwichlas, htik)  => {
	  if (kwichlas.length == 0) return 0;
	  kwichlas = kwichlas.split(/,(.+)/);
	  let myin = `espeak-ng -x -s200 -w ${htik}-0.wav -vpy+f2 ${kwichlas[0]};` 
  	  console.log(clattsen.execSync(myin).toString());
          myin = `espeak-ng -w ${htik}-1.wav -s450 -x -ven -ven ${kwichlas[1]};`
  	  console.log(clattsen.execSync(myin).toString());
	  //console.log(myin);
	  kle7nmyin += ` ${htik}-0.wav ${htik}-1.wav ${htik}-0.wav tlac.wav`
  });
  clattsen.execSync(`sox  ${kle7nmyin} ${file}.mp3`);
  clattsen.execSync("rm *.wav");
  

});
