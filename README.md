# content engine starter

this is a simple typescript repo you can open in vs code and use with claude code.

it is built for one job:
turn your raw observations about websites and client acquisition into x posts that sound like you and attract coaching clients.

## what this repo does

- stores your voice and positioning in one place
- stores raw ideas as markdown files
- turns one raw idea into a structured brief
- generates multiple post drafts using local prompt templates
- scores drafts so you can review the strongest ones first
- exports approved drafts into a posting queue

this starter does **not** call any ai api by itself.
that is intentional.

you will use claude code inside vs code to read the repo, follow the instructions in `CLAUDE.md`, and help you improve or automate each step.

## how to set it up

### 1. create a folder

if you already downloaded this repo, you already have the folder.

if not, make a normal folder anywhere on your computer called:

`content-engine-starter`

### 2. open the folder in vs code

in vs code:

- file
- open folder
- choose `content-engine-starter`

that is it.
yes really.
for a normal node/typescript repo, a folder is the project.

### 3. install dependencies

open the terminal in vs code and run:

```bash
npm install
```

### 4. create your first idea file

make a new file inside `data/ideas/`

example:

`data/ideas/linktree-is-killing-trust.md`

### 5. run the local scripts

```bash
npm run brief -- data/ideas/linktree-is-killing-trust.md
npm run generate -- data/ideas/linktree-is-killing-trust.md
npm run score
npm run queue
```

### 6. use claude code in the repo

once the folder is open in vs code and claude code is installed, use prompts like:

- read this repo and explain how the content flow works
- improve the scoring logic so it penalizes generic advice harder
- add a rewrite step that turns approved posts into thread starters
- build a real ai generation step using my preferred model api
- help me tighten the voice so it matches the examples in `data/examples/`

## recommended workflow

### every time you have a content idea

1. create a markdown file in `data/ideas/`
2. run `npm run brief -- path/to/file.md`
3. run `npm run generate -- path/to/file.md`
4. review the drafts in `output/drafts/`
5. run `npm run score`
6. move the good ones to `output/approved/`
7. run `npm run queue`

## repo structure

```text
content-engine-starter/
  CLAUDE.md
  package.json
  tsconfig.json
  .gitignore
  README.md
  data/
    audience.json
    offers.json
    pillars.json
    voice.md
    examples/
    ideas/
  prompts/
    brief-template.md
    generation-template.md
    critique-template.md
  scripts/
    brief.ts
    generate.ts
    score.ts
    queue.ts
  src/
    lib/
      fs.ts
      scoring.ts
      slug.ts
    types/
      index.ts
  output/
    drafts/
    approved/
    queue/
```

## what each part is for

### `CLAUDE.md`
project instructions for claude code so it behaves like a content engineer inside this repo

### `data/voice.md`
your source of truth for voice

### `data/pillars.json`
content buckets you post about

### `data/audience.json`
who you are trying to attract and what they care about

### `data/offers.json`
what you actually sell so the content can imply commercial value

### `data/ideas/`
raw content thoughts

### `prompts/`
prompt templates and generation rules

### `scripts/`
small local cli scripts

## using this with claude code

once claude code is inside the repo, start simple.

good first prompt:

```text
read this repo and tell me exactly what command to run first and what each file does
```

then:

```text
improve this repo so one raw idea can become 10 stronger x posts and 3 thread starters without losing the voice
```

## important note

this starter is built so you can understand it.
it is not overengineered.

later, claude code can help you:

- connect a real model api
- build a next.js dashboard on top of this
- add a sqlite database
- add scheduling
- add screenshot based website teardown workflows

