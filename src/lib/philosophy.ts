import fs from 'node:fs';
import path from 'node:path';
import { listFiles, readText } from './fs.js';
import { PHILOSOPHY_ROOT } from './transcripts.js';

// Parses the docs written by `npm run distill` (buyer focus). The section
// headings and item shapes are fixed by the distill prompt, so this relies on
// them: principles are blank-line separated blocks opening with a bold title,
// everything else is one bullet per item.

export interface PhilosophyItem {
  title: string;
  text: string;
}

export interface Philosophy {
  principles: PhilosophyItem[];
  buyerJudgment: string[];
  objections: PhilosophyItem[];
  tactics: string[];
}

const EMPTY: Philosophy = { principles: [], buyerJudgment: [], objections: [], tactics: [] };

function sections(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const chunk of markdown.split(/^## /m).slice(1)) {
    const newline = chunk.indexOf('\n');
    const heading = chunk.slice(0, newline === -1 ? undefined : newline).trim().toLowerCase();
    map.set(heading, newline === -1 ? '' : chunk.slice(newline + 1));
  }
  return map;
}

function boldTitle(text: string): string {
  return text.match(/\*\*(.+?)\*\*/)?.[1]?.trim() ?? text.slice(0, 60);
}

function bullets(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
}

function parsePrinciples(body: string): PhilosophyItem[] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith('**'))
    .map((block) => ({ title: boldTitle(block), text: block }));
}

// Tactics sit under ### group headings, kept as a prefix so a tip like
// "use 16px body text" still says which part of the page it is about
function parseTactics(body: string): string[] {
  let group = '';
  const tactics: string[] = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('### ')) group = line.slice(4).trim().toLowerCase();
    else if (line.startsWith('- ')) tactics.push(group ? `${group}: ${line.slice(2).trim()}` : line.slice(2).trim());
  }
  return tactics;
}

export function parsePhilosophy(markdown: string): Philosophy {
  const byHeading = sections(markdown);
  const body = (heading: string): string => byHeading.get(heading) ?? '';
  return {
    principles: parsePrinciples(body('core principles')),
    buyerJudgment: bullets(body('how buyers judge a website')),
    objections: bullets(body('what clients believe and object to')).map((text) => ({ title: boldTitle(text), text })),
    tactics: parseTactics(body('tactics')),
  };
}

// Merges every distilled doc, so a second creator's philosophy adds to the pool
export function loadPhilosophy(dir = PHILOSOPHY_ROOT): Philosophy {
  if (!fs.existsSync(dir)) return EMPTY;
  return listFiles(dir)
    .filter((file) => path.extname(file) === '.md')
    .map((file) => parsePhilosophy(readText(file)))
    .reduce<Philosophy>((all, p) => ({
      principles: [...all.principles, ...p.principles],
      buyerJudgment: [...all.buyerJudgment, ...p.buyerJudgment],
      objections: [...all.objections, ...p.objections],
      tactics: [...all.tactics, ...p.tactics],
    }), EMPTY);
}

// A window that moves a full window each day, so consecutive days feature
// different items instead of overlapping by all but one
export function rotatingWindow<T>(items: T[], seed: number, count: number): T[] {
  if (items.length === 0) return [];
  const size = Math.min(count, items.length);
  const start = (seed * size) % items.length;
  return Array.from({ length: size }, (_, i) => items[(start + i) % items.length]);
}
