#!/bin/bash
# debug.sh
source variable.sh
for i in $files
do
gdb bin/$i --directory=src
done
