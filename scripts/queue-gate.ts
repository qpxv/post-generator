import { loadEnv } from '../src/lib/env.js';
import { setOutput } from '../src/lib/ci.js';
import { createUnscheduledDraft, fetchScheduledDates, fetchSocialSetId, fetchTagSlug } from '../src/lib/performance/typefully.js';
import { loadPipelineState, savePipelineState } from '../src/lib/performance/store.js';
import type { PipelineState } from '../src/types/performance.js';

loadEnv();

// Stop generating once the queue reaches this far ahead, and start again once
// it drains back down. The gap between the two is what saves the opus credits:
// one run fills a few days, then the pipeline sits idle until they are used up.
const PAUSE_AT_DAYS = 5;
const RESUME_AT_DAYS = 1;
const DAY_MS = 86400000;

const recordArg = process.argv.find((a) => a.startsWith('--record='));
// --horizon=N skips typefully and pretends the queue is N days deep, for testing the switch
const horizonArg = process.argv.find((a) => a.startsWith('--horizon='));

function nextMode(mode: PipelineState['mode'], horizonDays: number): PipelineState['mode'] {
  if (mode === 'filling' && horizonDays >= PAUSE_AT_DAYS) return 'draining';
  if (mode === 'draining' && horizonDays <= RESUME_AT_DAYS) return 'filling';
  return mode;
}

async function queueHorizonDays(): Promise<number> {
  if (horizonArg) return Number(horizonArg.split('=')[1]);
  const apiKey = process.env.TYPEFULLY_API_KEY;
  if (!apiKey) throw new Error('missing TYPEFULLY_API_KEY');
  const dates = await fetchScheduledDates(apiKey, await fetchSocialSetId(apiKey));
  const latest = Math.max(...dates.map((d) => new Date(d).getTime()), Date.now());
  return (latest - Date.now()) / DAY_MS;
}

// Shows up in the review app on paused nights, so an empty review day reads as
// "queue is full" rather than "pipeline broke". Ben deletes it after seeing it.
async function postPipelineFullNotice(horizonDays: number): Promise<void> {
  const apiKey = process.env.TYPEFULLY_API_KEY;
  if (!apiKey) throw new Error('missing TYPEFULLY_API_KEY');
  const socialSetId = await fetchSocialSetId(apiKey);
  const needsReview = await fetchTagSlug(apiKey, socialSetId, 'needs review');
  const text = `pipeline full: queue is ${horizonDays.toFixed(1)} days deep, generation resumes at ${RESUME_AT_DAYS} day. nothing to review today, delete this`;
  await createUnscheduledDraft(apiKey, socialSetId, text, [needsReview]);
}

const state = loadPipelineState();

if (recordArg) {
  const through = recordArg.split('=')[1] ?? '';
  savePipelineState({ ...state, lastGeneratedThrough: through });
  console.log(`recorded journal generated through ${through}`);
} else {
  try {
    const horizon = await queueHorizonDays();
    const mode = nextMode(state.mode, horizon);
    savePipelineState({ ...state, mode });
    const verdict = mode === 'filling' ? 'generating tonight' : `paused until the queue is down to ${RESUME_AT_DAYS} day`;
    console.log(`queue reaches ${horizon.toFixed(1)} days ahead, mode ${state.mode} -> ${mode}, ${verdict}`);
    setOutput('should_generate', String(mode === 'filling'));
    // --horizon is a dry test of the switch, so it shouldn't drop drafts into typefully
    if (mode === 'draining' && !horizonArg) {
      await postPipelineFullNotice(horizon).then(
        () => console.log('left a "pipeline full" draft in the review queue'),
        (err: unknown) => console.error(`failed to leave the "pipeline full" draft: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  } catch (err) {
    // Fail open: a typefully hiccup should cost one extra batch, not a missed day
    console.error(`queue check failed, generating anyway: ${err instanceof Error ? err.message : String(err)}`);
    setOutput('should_generate', 'true');
  }
}
