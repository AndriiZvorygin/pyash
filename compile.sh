#!/bin/bash
cat header.tex > kwon.tex
./kwonkatfettu.js > body.tex
cat body.tex >> kwon.tex
cat footer.tex >> kwon.tex
lualatex kwon.tex
lualatex kwon.tex
pdfbook2 kwon.pdf --paper=letterpaper  --top-margin=10 --bottom-margin=5 --outer-margin=20 --signature=48 --inner-margin=80
