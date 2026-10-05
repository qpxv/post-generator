import fs from 'node:fs';

// Hands a value to later workflow steps. Outside github actions it just logs,
// so the scripts behave the same when run by hand.
export function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) fs.appendFileSync(outputFile, `${name}=${value}\n`);
  console.log(`output ${name}=${value}`);
}
