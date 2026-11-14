#!/bin/bash
source variable.sh
for i in $files
do
cd bin
if [ -a $i ]
then
echo "removing $i"
rm $i
fi
if [ -a $i.o ]
then
echo "removing $i"
rm $i.o
fi
cd ..
done
