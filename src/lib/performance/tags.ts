// Single source of truth for post tags: the classifier reads the descriptions,
// tag-posts validates against the values, and learn renders the prefer/avoid
// lines into the generation prompt. Adding a value here is the only way the
// learned prompt can say something new.

interface TagValue {
  description: string;
  prefer: string;
  avoid: string;
}

export const CATEGORY_VALUES = {
  website: 'the post lands on a point about websites, design, trust, or conversion',
  personal: 'the post is about life, mindset, work, or money with no website point',
  conspiracy: 'the post lays out a wild theory ben has about life, the brain, people, or everyday tech',
} as const;

export const CATEGORY_NAMES = Object.keys(CATEGORY_VALUES) as Category[];

export const TAG_DIMENSIONS = {
  hook: {
    'buyer-objection': {
      description: 'opens with something a buyer says, believes, or objects to, often quoted',
      prefer: 'open with the exact words a buyer says or believes, quoted the way they would say it',
      avoid: 'stop opening with a quoted buyer objection or belief',
    },
    'real-exchange': {
      description: 'opens with a real interaction with a specific person (a dm, a call, a client, a stranger)',
      prefer: 'open with a real interaction with one specific person and what they actually said',
      avoid: 'stop opening with an interaction with a specific person',
    },
    'scene-from-day': {
      description: 'opens with a concrete moment or scene from ben\'s own day',
      prefer: 'open inside a concrete moment from the journal day, with an object or a number in the first line',
      avoid: 'stop opening with a scene from the day, get to the point in the first line',
    },
    'rule-statement': {
      description: 'opens with a general rule, instruction, or claim ("your website should...")',
      prefer: 'open with a blunt rule stated as fact',
      avoid: 'never open with a general rule or a "your website should" instruction',
    },
    math: {
      description: 'opens with or is built around numbers and a worked calculation',
      prefer: 'build the point around a worked calculation with real numbers',
      avoid: 'stop building posts around calculations',
    },
    stance: {
      description: 'opens with a contrarian or arguable opinion aimed at the reader',
      prefer: 'open with an opinion people will want to argue with',
      avoid: 'stop opening with a contrarian opinion',
    },
  },
  moment: {
    'animal-nature': {
      description: 'the main moment is about animals, birds, plants, weather, or nature',
      prefer: 'use moments from nature and animals as the main material',
      avoid: 'do not use animals, birds, or nature as the main moment of a post',
    },
    'work-ai': {
      description: 'the main moment is about building websites, coding, ai tools, or the 9-5',
      prefer: 'use moments from building websites, coding, and working with ai as the main material',
      avoid: 'use fewer moments about coding and ai tools as the main material',
    },
    people: {
      description: 'the main moment is about other people (family, friends, strangers, clients, colleagues)',
      prefer: 'use moments with other people as the main material',
      avoid: 'use fewer moments about other people as the main material',
    },
    money: {
      description: 'the main moment is about money, pricing, spending, or income',
      prefer: 'use moments about money and pricing as the main material',
      avoid: 'use fewer moments about money as the main material',
    },
    'travel-driving': {
      description: 'the main moment is about travel, commuting, driving, or public transport',
      prefer: 'use moments from travel, driving, and commuting as the main material',
      avoid: 'use fewer moments from travel and driving as the main material',
    },
    other: {
      description: 'none of the above',
      prefer: '',
      avoid: '',
    },
  },
  landing: {
    'named-page-elements': {
      description: 'ends on specific visible things on a website (a font, a photo, a testimonial, a missing face or price)',
      prefer: 'land website points on specific things a stranger would see on the page (the hero photo, the font, a testimonial with only initials)',
      avoid: 'stop ending on lists of page elements',
    },
    'abstract-virtue': {
      description: 'ends on an abstract quality (flow, feels safe, different, intentional) instead of something observable',
      prefer: 'end on the underlying principle',
      avoid: 'never end on an abstract quality like flow or feeling different, end on something the reader can see',
    },
    stance: {
      description: 'ends on an opinion or claim that disagrees with a common belief',
      prefer: 'end on a claim that disagrees with what most people believe',
      avoid: 'stop ending on contrarian claims',
    },
    takeaway: {
      description: 'ends on a practical lesson or system the reader can use',
      prefer: 'end on a practical takeaway the reader can use the same day',
      avoid: 'stop ending on practical takeaways',
    },
  },
} as const satisfies Record<string, Record<string, TagValue>>;

export type TagDimension = keyof typeof TAG_DIMENSIONS;
export type Category = keyof typeof CATEGORY_VALUES;

export type PostTags = { category: Category } & { [D in TagDimension]: keyof (typeof TAG_DIMENSIONS)[D] };

export const TAG_DIMENSION_NAMES = Object.keys(TAG_DIMENSIONS) as TagDimension[];

export function tagValues(dimension: TagDimension): string[] {
  return Object.keys(TAG_DIMENSIONS[dimension]);
}

export function tagValue(dimension: TagDimension, value: string): TagValue | undefined {
  return (TAG_DIMENSIONS[dimension] as Record<string, TagValue>)[value];
}

// Narrow untrusted classifier output to PostTags, or null when any field is off-list
export function parsePostTags(raw: unknown): PostTags | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const category = record.category;
  if (typeof category !== 'string' || !(category in CATEGORY_VALUES)) return null;
  const tags: Record<string, string> = { category };
  for (const dimension of TAG_DIMENSION_NAMES) {
    const value = record[dimension];
    if (typeof value !== 'string' || !tagValues(dimension).includes(value)) return null;
    tags[dimension] = value;
  }
  // Built field by field so extra keys from the model (like id) never get stored
  return tags as PostTags;
}
