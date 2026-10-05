# engagement feedback loop

plan for a system that watches how published posts perform on x and feeds what works back into the daily generation prompt. posts are still reviewed by hand before they go out. nothing here is built yet.

## decisions

- **goal metric:** views and replies. dms would count too, but no post has produced a lead yet and fxtwitter can't see dms, so they are logged by hand if they ever happen (see open questions).
- **storage:** json files in the repo.
- **60/40 website/personal split stays fixed.** the system only learns *inside* each category. it never shifts the mix toward personal posts just because they get more views.

## what was verified (oct 5 2026)

### fxtwitter

- `GET https://api.fxtwitter.com/{handle}/status/{id}` returns `views`, `likes`, `replies`, `retweets`, `quotes`, `bookmarks`, `created_at`, `is_note_tweet`, plus `author.followers`. no key needed.
- `GET https://api.fxtwitter.com/2/profile/{handle}/statuses?cursor=...` lists the timeline, but pagination 404s after roughly 6 pages (121 items, about 3 weeks back). it is fine for spot checks and useless for history.
- python `urllib` got a 404 on the timeline endpoint where `curl` got a 200 with the same url, so use node `fetch` and test it before trusting it.
- it is unofficial. it can rate limit, change shape, or go away. everything built on it has to fail soft.

### typefully

- `GET /v2/social-sets/{id}/drafts?status=published` returns every published draft with `x_published_url` (contains the tweet id), `published_at`, `created_at`, and tags.
- **1412 published drafts** exist, which gives a backfill dataset on day one.
- the draft id comes back when the pipeline creates a draft, so generated posts can be linked to published tweets.

### the account right now

- 632 followers (`b_winzer`).
- last ~70 top-level posts (sep 12 to oct 5): median 82 views, top 10% above ~300, max 823. 151 likes in total, 87 replies, 1 bookmark.
- the top 6 by views were all personal posts (red bull, the 6 hour drive with duvets, noise cancelling airpods...). this is why the split is locked.
- queue lag: a post created aug 11 was published oct 4. anything the loop learns reaches the timeline about 2 months later, on top of the measurement window.

## architecture

reads and writes stay in plain functions so the same core can run from a github action now and from anywhere else later.

### 1. ledger (at generation time)

- the generator outputs a metadata block per post next to the existing delimiters, e.g. `===meta-1===` with json: `category` (website / personal), `length` (short / long), `axiomMode`, `pattern` (rant, teardown, trust callout...), `featuredAxiom`, `hasCaps`.
- after scheduling, store the typefully draft id with the metadata and the original generated text.
- file: `data/performance/ledger.json`, keyed by typefully draft id.
- without tags the loop can see *that* a post won but never *why*.

### 2. collector (daily)

- list published typefully drafts, pull the tweet id from `x_published_url`, fetch stats from fxtwitter.
- snapshot at **fixed ages: 48h and 7d**. views keep growing, so a 2 day old post and a 3 week old post can't be compared.
- subtract ben's own self-reply from `replies` (website posts carry a reply thread, which inflates the count by 1).
- throttle requests, cache results, and never fail the posting run if fxtwitter is down.
- file: `data/performance/snapshots.json`.
- runs in the nightly github action, which commits the json back to the repo.

### 3. scoring

- raw likes on ~80 views is noise. score each post as a **percentile against posts of the same age** in a rolling window, so follower growth doesn't skew older vs newer posts.
- weighted score: replies count well above views. likes are a minor tiebreaker.
- compare **groups, not single posts** ("short website posts beat long ones"). with ~90 posts a month, a group needs ~30 posts before it means anything.
- also control for the publish time slot (3 slots per day), since timing moves views as much as wording at this reach.

### 4. review signal

- the pipeline already saves the original text to `output/drafts/`, and typefully has the published text.
- **deleted drafts** = rejected. **edited drafts** = the diff shows exactly what ben changes.
- this signal is dense (a decision on every post) while engagement is sparse (one like per ~80 views). at current reach it is probably the stronger thing to learn from.

### 5. learning step (weekly)

- the model is never fine-tuned. only the prompt changes.
- a weekly job writes `data/insights.md`: what is working and what is dying inside each category, with real post examples and numbers. `daily.ts` reads it like it reads `axioms.md`.
- top performers get promoted into `data/examples/` automatically, with a cap so old hand-picked examples aren't drowned out.
- that job calls the model in ci, so it uses the anthropic api, not the claude cli.

## risks

- **noise.** at this reach, timing and luck decide more than wording. phase 0 exists to check for any signal before building the rest.
- **drift toward views.** the locked split guards the mix, but the loop could still learn "personal-sounding website posts win" and water down the website angle. the insights prompt should judge website posts on whether the website point survives, not just on views.
- **lag.** ~2 months of queue means slow feedback. shrinking the queue to 4 to 6 weeks makes the loop faster.
- **feedback collapse.** if only winners get used as examples, the voice narrows over time. keep some exploration: a share of posts in each batch try patterns the data hasn't proven yet.
- **fxtwitter breaking.** collector failures get logged and skipped, and the rest of the pipeline never depends on it.

## phase 0 result (oct 5 2026)

`npm run backfill` pulled 1412 published posts (1409 with stats, 3 deleted on x) into `data/performance/backfill.json`. `npm run analyze` ranks each post against its own month, permutation-tests a few features, and has the local claude cli write the report: `data/performance/analysis-2026-10-05.md`.

- **reach is set by the account, not the post.** median views swung about 5x between eras (146 to 195 in aug/sep 2025, 35 to 54 through spring 2026, back to 97 to 148 from july 2026).
- **two real effects, both small:** short posts rank lower (42nd vs 52nd percentile, p < 0.001) and evening posts rank lower (p 0.01, borderline). website vs personal is a dead tie, so the locked 60/40 split costs nothing.
- **untested but consistent pattern:** animal and nature moments sit at the bottom in both categories and never appear in either top list.
- **verdict:** a weekly insights loop would mostly chase noise. keep collecting, review quarterly against hypotheses written down in advance, and add features the table is missing (media, links, animal/nature).

## how it runs now (oct 5 2026)

phases 1 to 3 are built and run in the nightly workflow before posting. each learning step is `continue-on-error`, so it can never block a post.

1. `npm run collect`: new published drafts from typefully, fxtwitter snapshots at 48h and 7d plus latest stats, follower count → `data/performance/posts.json`, `followers.json`.
2. `npm run tag`: haiku tags new posts (category, hook, moment, landing) from the published text. history was tagged once locally with `npm run tag -- --cli`.
3. `npm run learn`: no llm. ranks posts within their month, tests every tag value inside each category over the newest 270 posts, and writes `data/learned/guidance.json` + `data/learned/prompt.md`. rule changes are logged in `data/learned/changelog.md`.
4. `npm run post` injects `prompt.md` (learned rules + the 6 best posts of the last 30 days), applies the short-post knob, and marks the last 1 or 2 posts as exploration posts that ignore the learned block. it records each draft's id, explore flag and original text in `data/performance/ledger.json`.
5. the workflow commits `data/` back to `main`.

**rule gate:** n ≥ 30 per group, effect ≥ 8 percentile points, p < 0.01 (5000 seeded shuffles), same direction in the older and newer half of the window. an active rule stays until p > 0.05. max 6 rules. wording comes only from `src/lib/performance/tags.ts`, so the prompt can only change in pre-written ways.

**first run:** 0 rules passed. the closest was "website posts that open with a scene from the day do better" (+17 points, p 0.023). "short loses" and "animal hooks lose" don't hold in the newest 270 posts.

**queue gate (oct 5 2026):** the queue was cut to 1 day (269 posts back to drafts, backup in `data/performance/typefully-queue-backup-2026-10-05.json`) so feedback lands within days. `npm run gate` pauses generation once the queue reaches 5 days ahead and resumes when it drains to 1 day, so opus only runs while the queue is filling. collect, tag and learn still run nightly. after a pause, `npm run fetch-journal` reads every journal day since the last generation (max 7) into one file with a `## <day>` header per day, so paused days still become posts. state lives in `data/pipeline/state.json`.

**local testing without api credits:** `npm run post -- --cli --dry-run` generates through the local claude cli and schedules nothing.

**edit learning (oct 5 2026):** ben's review is the densest signal (a decision on every draft), so the loop learns from it too, with no input beyond the review itself.

1. `npm run edits` (nightly, no llm): pairs every ledger draft with its outcome in `data/performance/edits.json`. published unchanged → `kept`, published changed → `edited`, the draft 404s in typefully before publishing → `deleted`. drafts still in the queue stay pending and are checked again the next night.
2. `npm run learn-edits` (nightly, but only calls the model once 5+ new reviews came in and at least 10 drafts were edited or deleted): sonnet 5.5 reads the newest 60 edited pairs, 20 deleted and 10 kept drafts and returns at most 10 rules for edits ben makes in 3+ pairs. code renders `data/learned/edits.md` (rules + 3 recent before/after pairs), state lives in `data/learned/edit-rules.json`, and every relearn is logged in `data/learned/changelog.md`. each run rewrites the whole list, so habits ben stops correcting drop out.
3. `npm run post` injects `edits.md` into every post, exploration posts included, since it is about voice, not performance.

bootstrap: `npm run edits -- --history` (local, one-off) recovered 59 pairs from the old `output/drafts` files in git history (20 kept, 39 edited). first rules: cut lines that repeat a point, don't end on a summary or moral, closers are casual asides, put the contrast half of a line on its own line, no years in dated-design jabs.

## phases

0. **backfill + one analysis.** done, see above. a one-off script pulls all 1412 published posts and their stats into json, then runs one analysis (local claude cli, since it's dev tooling). result: is there any pattern worth learning? if not, stop here.
1. **ledger + tags + daily collector.**
2. **weekly insights + review signal**, fed into the prompt.
3. **auto-tuning inside each category** (short share, axiom share, patterns) within fixed limits. the website/personal split is never touched.

## open questions

- **leads are the real gap.** no post has produced a lead yet. the loop optimizes for posts people react to, which is not the same as posts that bring clients. the reply/cta, profile, and pinned post probably matter more for leads than any single post does. worth a separate look.
- **lead logging:** if a dm or lead ever comes from a post, log it by hand (a journal entry like "lead from the hero post", or a field in the ledger) so it can carry far more weight than views.
- **old posts have no tags.** for the backfill, tag the 1412 posts after the fact with a classification pass, or only learn from new posts?
