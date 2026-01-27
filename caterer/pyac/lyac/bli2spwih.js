#!/usr/bin/env  node
'use strict';

const fs = require('fs');
const input = process.argv[2];

    fs.readFile("dictionary_en.json", "utf8", function(err, contents) {
      if (err) return Error(err);
      let dictionary = JSON.parse(contents);
      //console.log(dictionary);
      console.log(dictionary.en.blacklist['X' + input]);
    });
