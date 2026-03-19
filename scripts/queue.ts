import path from 'node:path';
import { listFiles, readText, writeText } from '../src/lib/fs.js';

const scoreFiles = listFiles('output/drafts').filter((file) => file.endsWith('.scores.md'));

if (scoreFiles.length === 0) {
  console.error('no score reports found in output/drafts');
  process.exit(1);
}

let queueSections: string[] = ['# posting queue', ''];

for (const file of scoreFiles) {
  const content = readText(file);
  const sections = content.split(/^##\s+/m).slice(1, 4);
  queueSections.push(`## from ${path.basename(file)}`);
  queueSections.push('');
  for (const section of sections) {
    queueSections.push(`### ${section.trim()}`);
    queueSections.push('');
  }
}

writeText('output/queue/posting-queue.md', queueSections.join('\n'));
console.log('wrote output/queue/posting-queue.md');
