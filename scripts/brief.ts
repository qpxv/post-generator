import path from 'node:path';
import { readText, writeText, listFiles } from '../src/lib/fs.js';
import { slugify } from '../src/lib/slug.js';
import { complete } from '../src/lib/claude.js';

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('usage: npm run brief -- data/ideas/your-idea.md');
  process.exit(1);
}

const ideaContent = readText(inputPath);
const topic = path.basename(inputPath, path.extname(inputPath));
const slug = slugify(topic);

const voice = readText('data/voice.md');
const briefTemplate = readText('prompts/brief-template.md');

const exampleFiles = listFiles('data/examples').filter(
  (f) => f.endsWith('.md') && !f.includes('README')
);
const examples = exampleFiles.map((f) => readText(f)).join('\n\n---\n\n');

const systemPrompt = `you are a content strategist for ben, who builds conversion-focused websites for coaches and online business owners.

here is ben's voice guide:
${voice}

here is what you need to output:
${briefTemplate}

${examples ? `here are real example posts in ben's voice for reference:\n\n${examples}\n` : ''}
write the brief in markdown with clear section headers. keep it tight. no filler. no generic advice.`;

const userPrompt = `here is the raw idea:\n\n${ideaContent}`;

console.log('generating brief with claude...');
const brief = await complete(systemPrompt, userPrompt);

writeText(`output/drafts/${slug}.brief.md`, brief);
console.log(`wrote output/drafts/${slug}.brief.md`);
