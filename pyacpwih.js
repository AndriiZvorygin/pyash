#!/usr/bin/env  node
'use strict';

const fs = require('fs');
const input = process.argv[2];

fs.readFile("program/pyashWords.h", "utf8", function(err, contents) { 
  if (err) return Error(err);
  let example = new RegExp(input, 'i');
  let lines = contents.split('\n');
  let produce = lines.filter((line) => {
    return example.test(line);
  });
  if (produce.length == 0) {
    fs.readFile("dictionary_en.json", "utf8", function(err, contents) {
      if (err) return Error(err);
      let dictionary = JSON.parse(contents);
      //console.log(dictionary);
      console.log(dictionary.en.blacklist['X' + input]);
    });
  } else {
    console.log(produce.join("\n"));
  }

});
