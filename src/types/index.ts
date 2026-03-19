export type IdeaSections = {
  topic?: string;
  audience?: string;
  observation?: string;
  whyThisMatters?: string;
  proof?: string;
  angleIdeas?: string[];
  callToAction?: string;
};

export type DraftPost = {
  id: string;
  type: 'short' | 'medium' | 'thread-starter';
  angle: string;
  hook: string;
  body: string;
};

export type ScoredPost = DraftPost & {
  scores: {
    specificity: number;
    conviction: number;
    buyerRelevance: number;
    originality: number;
    voiceMatch: number;
    total: number;
  };
  notes: string[];
};
