import path from 'node:path';
import { writeText } from '../src/lib/fs.js';
import { setOutput } from '../src/lib/ci.js';
import { loadPipelineState } from '../src/lib/performance/store.js';
import { addDays, dayLabel, zonedDate } from '../src/lib/performance/time.js';

const JOURNAL_EXPORT_URL = 'https://journal-app-xi-beryl.vercel.app/api/entries/export';
// Bounds the prompt size if the pipeline was off for a long time
const MAX_DAYS = 7;

const outArg = process.argv.find((a) => a.startsWith('--out='));
const outDir = path.resolve(outArg ? outArg.split('=')[1] ?? 'journal-tmp' : 'journal-tmp');

// Every journal day since the last generation, so days that fell inside a
// queue pause still become posts instead of being skipped
function pendingDays(lastGeneratedThrough: string, yesterday: string): string[] {
  const days: string[] = [];
  for (let d = addDays(lastGeneratedThrough, 1); d <= yesterday; d = addDays(d, 1)) days.push(d);
  return days.slice(-MAX_DAYS);
}

async function fetchDay(date: string): Promise<string | null> {
  const res = await fetch(`${JOURNAL_EXPORT_URL}?date=${date}&tz=Europe%2FBerlin`);
  // 404 means no entries that day, which is normal
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`journal export for ${date} failed with ${res.status}`);
  return (await res.text()).trim();
}

const yesterday = addDays(zonedDate(new Date()), -1);
const days = pendingDays(loadPipelineState().lastGeneratedThrough, yesterday);
if (days.length === 0) {
  console.error(`journal already generated through ${yesterday}, nothing new to read`);
  process.exit(1);
}

const sections: string[] = [];
for (const day of days) {
  const text = await fetchDay(day);
  console.log(`${day}: ${text ? `${text.split('\n').length} lines` : 'no entries'}`);
  if (text) sections.push(`## ${dayLabel(day)}\n${text}`);
}
if (sections.length === 0) {
  console.error(`no journal entries between ${days[0]} and ${yesterday}, skipping post`);
  process.exit(1);
}

const firstDay = days[0] ?? yesterday;
const label = days.length === 1 ? dayLabel(firstDay) : `${dayLabel(firstDay)} to ${dayLabel(yesterday)}`;
writeText(path.join(outDir, `${label}.txt`), sections.join('\n\n') + '\n');
setOutput('journal_dir', outDir);
setOutput('through', yesterday);
