import process from "node:process";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  let output = input;
  if (output.includes("\\r\\n")) output = output.replace(/\\r\\n/g, "\n");
  if (output.includes("\\n")) output = output.replace(/\\n/g, "\n");
  if (output.includes("\\r")) output = output.replace(/\\r/g, "\r");
  process.stdout.write(output);
});
if (process.stdin.isTTY) process.stdin.emit("end");
