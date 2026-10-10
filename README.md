# content engine

turns ben's daily journal into x posts, queues them in typefully for review, and learns from how published posts perform and how they get edited in review.

it runs every night in github actions. nothing gets published without a hand review in typefully.

## how the nightly run works

`.github/workflows/nightly-post.yml` runs at 01:05 utc. the steps, in order:

1. **collect** (`npm run collect`): pulls published drafts from typefully and their stats from fxtwitter, snapshots each post at 48h and 7d
2. **tag** (`npm run tag`): classifies new posts (website / personal, length, pattern...) with haiku
3. **learn** (`npm run learn`): compares post groups against each other and writes the rules that hold up statistically to `data/learned/`
4. **edits** (`npm run edits`): pairs each generated draft with what was actually published, or notes that it was deleted
5. **learn-edits** (`npm run learn-edits`): turns review edits into writing rules, only once 5+ new reviews have come in
6. **gate** (`npm run gate`): checks queue depth. generation pauses once the typefully queue is 5+ days deep and resumes when it drains to 1
7. **fetch-journal** (`npm run fetch-journal`): downloads every journal day since the last generation from the journal app export
8. **post** (`npm run post`): generates the batch with opus and adds each post to typefully on the next free slot, tagged "needs review"

steps 1 to 5 are `continue-on-error`. if one of them fails, that night's batch just uses the previous day's guidance. at the end the run commits `data/performance`, `data/learned` and `data/pipeline` back to the repo.

## generation

all generation rules live in `scripts/daily.ts`. that file is the source of truth for voice, banned patterns and batch mix.

- batch size follows how many journal entries the day had (4, 6, 9 or 12 posts)
- the mix is fixed by ben and scales with batch size: half value posts, a third conspiracy posts, the rest personal (6 posts: 3 value, 1 personal, 2 conspiracy). the learner never changes it
- value posts teach one rotating principle from `data/philosophy/` on a skeleton from `data/formats/value-posts.md`. each one gets a different skeleton per day, and they get a reply
- conspiracy posts are ben's wild theories about anything (perception, the brain, everyday tech), from the journal when it has one. no reply
- about one batch in three, the personal post is an axiom post built on an entry from `axioms.md`
- the last 1 or 2 value posts are exploration posts that ignore the learned rules, so the account doesn't narrow into one style

inputs it reads:

| file | what it is |
| --- | --- |
| `data/examples/good-posts.md` | reference posts for hook and pacing |
| `data/examples/good-replies.md` | reference replies |
| `data/voice-samples.md` | ben's raw writing (messages, notes) for how he actually sounds |
| `axioms.md`, `definitions.md` | ben's worldview, one axiom and a few definitions are featured per day |
| `data/philosophy/*.md` | distilled principles, buyer psychology and client objections (`npm run distill`). website posts land their point on one of the day's rotating featured items, and the drafts file labels which |
| `data/formats/value-posts.md` | how value posts are built (hooks, skeletons, point structure), studied from another creator's posts with `npm run study-format`. every website post is a value post built on it. personal posts never see it |
| `data/learned/prompt.md` | performance rules written by `learn` |
| `data/learned/edits.md` | review rules written by `learn-edits` |

the generated batch is also saved to `output/drafts/<date>.daily.md`.

## setup

```bash
npm install
```

create a `.env` in the repo root:

```bash
ANTHROPIC_API_KEY=   # generation, tagging, learn-edits
TYPEFULLY_API_KEY=   # queue, stats, edits
JOURNAL_DIR=         # folder with journal exports, read by `post` and `newsletter`
```

the same keys are github actions secrets for the nightly run. `JOURNAL_DIR` is set by the workflow itself.

## running locally

```bash
npm run post -- --cli --dry-run
```

`--cli` routes model calls through the local `claude` cli (subscription usage instead of api credits). `--dry-run` skips typefully. use both to test a prompt change without spending anything or touching the queue. `tag` and `learn-edits` also accept `--cli`.

other commands:

| command | what it does |
| --- | --- |
| `npm run newsletter` | writes a newsletter from the newest journal file to `output/newsletters/` |
| `npm run analyze` | one-off performance analysis report in `data/performance/` |
| `npm run collect -- --refresh-all` | refreshes stats on every post, not just recent ones |
| `npm run edits -- --history` | recovers edit pairs from old committed drafts (local only) |
| `npm run gate -- --horizon=N` | tests the pause/resume switch as if the queue were N days deep |
| `npm run transcripts -- --channel=<url> --slug=<name>` | downloads english captions for every video on a youtube channel to `data/transcripts/<name>/` (needs `brew install yt-dlp`, only fetches new uploads on rerun) |
| `npm run distill -- --slug=<name>` | turns those transcripts into `data/philosophy/<name>.md` via the claude cli. `--focus=design --out=<path>` writes a design playbook instead (used for the website collection's `DESIGN-PLAYBOOK.md`). `--limit=N` writes notes for N videos only, to check quality first |
| `npm run study-format -- --in=<posts file> --out=data/formats/value-posts.md` | studies a creator's pasted posts and writes the value post format guide via the claude cli. the posts file stays outside the repo |
| `npm run check` | `tsc --noEmit` |

## repo layout

```text
.github/workflows/   nightly pipeline
scripts/             one entry script per npm command
src/lib/             claude api + cli wrappers, fs/env helpers
src/lib/performance/ typefully + fxtwitter clients, stats, tags, json store
src/types/           shared types
data/examples/       reference posts, replies, newsletters
data/learned/        rules the pipeline writes for itself (committed nightly)
data/performance/    post stats, ledger, review edits (committed nightly)
data/pipeline/       queue gate state (committed nightly)
data/philosophy/     distilled philosophy of creators ben learns from (raw transcripts in data/transcripts/ are gitignored)
docs/                design notes for the feedback loop
output/              generated drafts and newsletters
web/                 next.js dashboard for reviewing typefully drafts
```
