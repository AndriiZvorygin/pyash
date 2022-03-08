#!/usr/bin/env node
'use strict';
const fs = require('fs');
const clattsen = require('child_process');

fs.readFile("pyashWords.json", "utf8", function(err, pyashWords) { 
  const kwickwonlwat = JSON.parse(pyashWords);
  kwickwonlwat.forEach((kwickwon)  => {
	  let myin = `espeak-ng -x -s300  -vpy+f2 ${kwickwon.pya}; espeak-ng  -s450 -x -ven ${kwickwon.en};`
	  //console.log(myin);
  console.log(clattsen.execSync(myin).toString());
  });

});
