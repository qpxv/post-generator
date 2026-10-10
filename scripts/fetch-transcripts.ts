import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { listFiles, readText, writeText } from '../src/lib/fs.js';
import { transcriptDir } from '../src/lib/transcripts.js';

const run = promisify(execFile);

// Uploaded captions are punctuated and accurate, the auto track ("en-orig")
// is only the fallback for videos without them
const SUB_LANG_PREFERENCE = ['en', 'en-orig'];
// Channel listings are large, the default 1MB stdout buffer cuts them off
const MAX_BUFFER = 64 * 1024 * 1024;
// YouTube answers a back-to-back run of 100+ caption requests with 429s
const SUBTITLE_SLEEP_SECONDS = '2';

interface Video {
  id: string;
  title: string;
  durationSeconds: number | null;
  views: number | null;
}

interface Json3 {
  events?: { segs?: { utf8?: string }[] }[];
}

function argValue(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

async function assertYtDlp(): Promise<void> {
  try {
    await run('yt-dlp', ['--version']);
  } catch {
    console.error('yt-dlp is not installed. run: brew install yt-dlp');
    process.exit(1);
  }
}

function toNumber(value: string | undefined): number | null {
  const n = Number(value);
  return value && Number.isFinite(n) ? n : null;
}

async function listChannel(channelUrl: string): Promise<Video[]> {
  const { stdout } = await run(
    'yt-dlp',
    ['--flat-playlist', '--print', '%(id)s\t%(duration)s\t%(view_count)s\t%(title)s', `${channelUrl.replace(/\/$/, '')}/videos`],
    { maxBuffer: MAX_BUFFER },
  );
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id = '', duration, views, ...title] = line.split('\t');
      return { id, title: title.join('\t'), durationSeconds: toNumber(duration), views: toNumber(views) };
    })
    .filter((v) => v.id !== '');
}

// Segments inside one event carry their own spacing (auto captions split a
// line into words with leading spaces), but uploaded captions end each event
// without one, so events are joined with a space or their edge words fuse
function json3ToText(raw: string): string {
  const parsed = JSON.parse(raw) as Json3;
  const text = (parsed.events ?? [])
    .map((e) => (e.segs ?? []).map((s) => s.utf8 ?? '').join(''))
    .join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

async function downloadCaptions(videoId: string): Promise<string | null> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));
  try {
    await run(
      'yt-dlp',
      ['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', SUB_LANG_PREFERENCE.join(','),
        '--sub-format', 'json3', '--sleep-subtitles', SUBTITLE_SLEEP_SECONDS, '-o', path.join(tmpDir, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${videoId}`],
      { maxBuffer: MAX_BUFFER },
    );
    for (const lang of SUB_LANG_PREFERENCE) {
      const file = path.join(tmpDir, `${videoId}.${lang}.json3`);
      if (fs.existsSync(file)) return json3ToText(readText(file));
    }
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// execFile's message is just the command line, the real reason is yt-dlp's ERROR line on stderr
function ytDlpError(err: unknown): string {
  const stderr = typeof err === 'object' && err !== null && 'stderr' in err ? String(err.stderr) : '';
  const errorLine = stderr.split('\n').find((l) => l.startsWith('ERROR:'));
  return errorLine ?? (err instanceof Error ? err.message : String(err));
}

function formatTranscript(video: Video, text: string): string {
  const minutes = video.durationSeconds === null ? 'unknown' : `${Math.round(video.durationSeconds / 60)} min`;
  return [
    `title: ${video.title}`,
    `url: https://www.youtube.com/watch?v=${video.id}`,
    `views: ${video.views ?? 'unknown'}`,
    `length: ${minutes}`,
    '',
    text,
    '',
  ].join('\n');
}

const channelUrl = argValue('channel');
const slug = argValue('slug');
if (!channelUrl || !slug) {
  console.error('usage: npm run transcripts -- --channel=<youtube channel url> --slug=<folder name>');
  process.exit(1);
}

await assertYtDlp();
const dir = transcriptDir(slug);
// Rerunning only fetches uploads that don't have a transcript yet
const existing = new Set(listFiles(dir).filter((f) => f.endsWith('.txt')).map((f) => path.basename(f, '.txt')));
const videos = await listChannel(channelUrl);
const pending = videos.filter((v) => !existing.has(v.id));
console.log(`${videos.length} videos on the channel, ${pending.length} without a transcript yet`);

let saved = 0;
const skipped: string[] = [];
for (const [i, video] of pending.entries()) {
  const label = `[${i + 1}/${pending.length}] ${video.title}`;
  try {
    const text = await downloadCaptions(video.id);
    if (!text) {
      skipped.push(video.title);
      console.warn(`${label}: no english captions, skipped`);
      continue;
    }
    writeText(path.join(dir, `${video.id}.txt`), formatTranscript(video, text));
    saved++;
    console.log(`${label}: ${text.split(' ').length} words`);
  } catch (err) {
    skipped.push(video.title);
    console.error(`${label}: failed - ${ytDlpError(err)}`);
  }
}

console.log(`\ndone. ${saved} saved to ${dir}, ${skipped.length} skipped (rerun to retry failures)`);
