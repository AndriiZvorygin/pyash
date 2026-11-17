#!/bin/bash
# test binaries
source variable.sh
cd src/
for i in $files
do
 vim $i.asm 
done
#echo $all
