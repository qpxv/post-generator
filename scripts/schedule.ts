import fs from 'node:fs';
import path from 'node:path';
import { listFiles, readText, ensureDir } from '../src/lib/fs.js';
import { loadEnv } from '../src/lib/env.js';

loadEnv();

const TYPEFULLY_API_KEY = process.env.TYPEFULLY_API_KEY;

if (!TYPEFULLY_API_KEY) {
  console.error('missing TYPEFULLY_API_KEY in .env');
  process.exit(1);
}

const approvedFiles = listFiles('output/approved').filter(
  (f) => f.endsWith('.md') || f.endsWith('.txt')
);

if (approvedFiles.length === 0) {
  console.log('no approved posts found in output/approved/');
  console.log('copy post text files there, then run npm run schedule');
  process.exit(0);
}

ensureDir('output/scheduled');

// Start scheduling tomorrow at 9am, one post per day
const startDate = new Date();
startDate.setDate(startDate.getDate() + 1);
startDate.setHours(9, 0, 0, 0);

let scheduled = 0;

for (const [i, filePath] of approvedFiles.entries()) {
  const content = readText(filePath).trim();
  if (!content) continue;

  const scheduleDate = new Date(startDate);
  scheduleDate.setDate(startDate.getDate() + i);

  // Detect threads: file uses --- as tweet separator
  const isThread = /\n\s*---\s*\n/.test(content);
  const typefullyContent = isThread
    ? content.replace(/\n\s*---\s*\n/g, '\n\n---\n\n')
    : content;

  try {
    const response = await fetch('https://api.typefully.com/v1/drafts/', {
      method: 'POST',
      headers: {
        'X-API-KEY': `Bearer ${TYPEFULLY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: typefullyContent,
        'schedule-date': scheduleDate.toISOString(),
        threadify: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`failed to schedule ${path.basename(filePath)}: ${error}`);
      continue;
    }

    const dest = path.join('output/scheduled', path.basename(filePath));
    fs.renameSync(filePath, dest);
    console.log(`scheduled: ${path.basename(filePath)} -> ${scheduleDate.toDateString()}`);
    scheduled++;
  } catch (err) {
    console.error(`error scheduling ${path.basename(filePath)}:`, err);
  }
}

console.log(`\ndone. ${scheduled} post(s) sent to typefully.`);
