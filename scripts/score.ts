import fs from 'node:fs';
import path from 'node:path';
import { listFiles, readText, writeText } from '../src/lib/fs.js';
import { scorePost } from '../src/lib/scoring.js';
import type { DraftPost } from '../src/types/index.js';

const draftFiles = listFiles('output/drafts').filter((file) => file.endsWith('.generated.md'));

if (draftFiles.length === 0) {
  console.error('no generated drafts found in output/drafts');
  process.exit(1);
}

for (const file of draftFiles) {
  const content = readText(file);
  const posts = parseDrafts(content);
  const scored = posts.map(scorePost).sort((a, b) => b.scores.total - a.scores.total);

  const report = [
    `# score report for ${path.basename(file)}`,
    '',
    ...scored.map((post) => {
      return [
        `## ${post.id}`,
        '',
        `- total: ${post.scores.total}`,
        `- specificity: ${post.scores.specificity}`,
        `- conviction: ${post.scores.conviction}`,
        `- buyer relevance: ${post.scores.buyerRelevance}`,
        `- originality: ${post.scores.originality}`,
        `- voice match: ${post.scores.voiceMatch}`,
        `- notes: ${post.notes.length ? post.notes.join(', ') : 'none'}`,
        '',
        post.hook,
        '',
        post.body,
        ''
      ].join('\n');
    })
  ].join('\n');

  const outputPath = file.replace('.generated.md', '.scores.md');
  writeText(outputPath, report);
  console.log(`wrote ${outputPath}`);
}

function parseDrafts(markdown: string): DraftPost[] {
  const chunks = markdown.split(/^##\s+/m).slice(1);
  return chunks.map((chunk) => {
    const lines = chunk.split('\n');
    const id = lines[0].trim();
    const type = lines[2].replace('- type:', '').trim() as DraftPost['type'];
    const angle = lines[3].replace('- angle:', '').trim();
    const bodyStart = 5;
    const contentLines = lines.slice(bodyStart).filter((line) => line !== '');
    const hook = contentLines.slice(0, 2).join('\n');
    const body = contentLines.slice(2).join('\n');
    return { id, type, angle, hook, body };
  });
}
