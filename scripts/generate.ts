import path from 'node:path';
import fs from 'node:fs';
import { readText, writeText, listFiles } from '../src/lib/fs.js';
import { slugify } from '../src/lib/slug.js';
import { complete } from '../src/lib/claude.js';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('usage: npm run generate -- data/ideas/your-idea.md');
  process.exit(1);
}

const ideaContent = readText(inputPath);
const topic = path.basename(inputPath, path.extname(inputPath));
const slug = slugify(topic);

const briefPath = `output/drafts/${slug}.brief.md`;
const brief = fs.existsSync(briefPath) ? readText(briefPath) : '';

const voice = readText('data/voice.md');
const genTemplate = readText('prompts/generation-template.md');

const exampleFiles = listFiles('data/examples').filter(
  (f) => f.endsWith('.md') && !f.includes('README')
);
const examples = exampleFiles.map((f) => readText(f)).join('\n\n---\n\n');

const systemPrompt = `you are writing x posts for ben, who builds conversion-focused websites for coaches and online business owners.

voice guide:
${voice}

writing rules:
${genTemplate}

${examples ? `here are real example posts in ben's voice. match this style closely:\n\n${examples}\n` : ''}
output exactly 10 posts using these delimiters. no preamble, no commentary, no labels before the delimiter line.

===short-1===
{post}
===short-2===
{post}
===short-3===
{post}
===short-4===
{post}
===short-5===
{post}
===medium-1===
{post}
===medium-2===
{post}
===medium-3===
{post}
===thread-1===
{tweet 1}

---

{tweet 2}
===thread-2===
{tweet 1}

---

{tweet 2}

short posts: 1-4 punchy lines. one sharp point. direct hook.
medium posts: 6-12 lines. build the point with a real observation. no fluff.
thread starters: 2 tweets. first tweet is the hook, second is the payoff or setup for more.`;

const userPrompt = brief
  ? `here is the content brief:\n\n${brief}`
  : `here is the raw idea:\n\n${ideaContent}`;

console.log('generating posts with claude...');
const response = await complete(systemPrompt, userPrompt);

const posts = parseResponse(response, slug);
const output = [`# generated drafts for ${topic}`, '', ...posts.map(formatPost)].join('\n');

writeText(`output/drafts/${slug}.generated.md`, output);
console.log(`wrote output/drafts/${slug}.generated.md`);

type ParsedPost = { id: string; type: 'short' | 'medium' | 'thread-starter'; content: string };

function parseResponse(text: string, slugPrefix: string): ParsedPost[] {
  const results: ParsedPost[] = [];
  const parts = text.split(/===([a-z]+-\d+)===/);

  // parts: ['', 'short-1', 'content', 'short-2', 'content', ...]
  for (let i = 1; i < parts.length; i += 2) {
    const label = parts[i].trim();
    const content = parts[i + 1]?.trim() ?? '';
    const typeMatch = label.match(/^([a-z]+)-(\d+)$/);
    if (!typeMatch || !content) continue;
    const typePart = typeMatch[1];
    const type = typePart === 'thread' ? 'thread-starter' : (typePart as 'short' | 'medium');
    results.push({ id: `${slugPrefix}-${label}`, type, content });
  }

  return results;
}

function formatPost(post: ParsedPost): string {
  const lines = post.content.split('\n');
  const nonEmpty = lines.filter((l) => l.trim());
  const hook = nonEmpty.slice(0, 2).join('\n');
  const body = nonEmpty.slice(2).join('\n');
  const angle = deriveAngle(post.content);
  return `## ${post.id}\n\n- type: ${post.type}\n- angle: ${angle}\n\n${hook}\n\n${body}\n`;
}

function deriveAngle(content: string): string {
  const firstLine = content.split('\n').find((l) => l.trim()) ?? '';
  return firstLine.slice(0, 60).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}
