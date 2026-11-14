#!/bin/bash
# run files
source variable.sh
for i in $files
do
cd bin
if [ -a "$i" ]
then
echo "testing $i"
#echo -e "testing \n asdfa \n testing2 \n mq" | 
./$i
fi
done
