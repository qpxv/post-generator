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

## phases

0. **backfill + one analysis.** a one-off script pulls all 1412 published posts and their stats into json, then runs one analysis (local claude cli, since it's dev tooling). result: is there any pattern worth learning? if not, stop here.
1. **ledger + tags + daily collector.**
2. **weekly insights + review signal**, fed into the prompt.
3. **auto-tuning inside each category** (short share, axiom share, patterns) within fixed limits. the website/personal split is never touched.

## open questions

- **leads are the real gap.** no post has produced a lead yet. the loop optimizes for posts people react to, which is not the same as posts that bring clients. the reply/cta, profile, and pinned post probably matter more for leads than any single post does. worth a separate look.
- **lead logging:** if a dm or lead ever comes from a post, log it by hand (a journal entry like "lead from the hero post", or a field in the ledger) so it can carry far more weight than views.
- **old posts have no tags.** for the backfill, tag the 1412 posts after the fact with a classification pass, or only learn from new posts?
