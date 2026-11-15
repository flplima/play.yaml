# contributing to play.yaml

Thanks for checking out **play.yaml**! Any contribution is welcome, whether you are fixing a bug, adding a new instrument control, or transcribing a song you love.

## ai agents are very welcome here

I build **play.yaml** alongside AI coding agents every day. If you use Claude Code, Antigravity, Cursor, Codex, Copilot, or your own custom agent, you are in the right place.

You do not need to hide that an agent wrote your code or your song transcription. On the contrary, this repo is designed so agents can work on it autonomously and check their own work:

- **Bar-bounded YAML**: each measure is one string (`- 1: "c d e f"`), so an agent can edit bar 12 without breaking bar 13.
- **Self-verifying MIDI import (`play-yaml-import --verify`)**: proves a transcription kept every note onset and pitch (`missing 0 extra 0 | EXACT`).
- **Musical fidelity grading (`play-yaml-fidelity`)**: scores a `.play.yaml` arrangement from 0 to 100 against a reference `.mid` file and prints the weakest bars so your agent can fix them in a loop.
- **Deterministic golden tests**: every example and song is pinned in `packages/core/examples.golden.json`.

If you want to point your agent at an issue right now, give it this prompt:

```text
Read README.md, docs/reference.md, CONTRIBUTING.md, and docs/syntax-differentiation.md.
Then implement the change and run `npm run build && npm test` to verify.
```

## quick setup

You only need Node.js (v16 or newer) and npm.

```bash
npm install
npm run build
npm test
```

To open the browser studio (the dev server prints its `https://localhost:<port>` URL; the port comes from `packages/web/.env.example`):

```bash
npm run dev:vite -w @play.yaml/web
# From here, ask your AI agent for help. Good luck!
```

## easy ways to contribute

You do not need to learn the whole compiler to ship something cool. These four areas live in one file or folder each:

1. **Transcribe a song (`songs/<slug>/`)**: pick a piece whose composition is in the public domain — Bach, Chopin, Debussy, Villa-Lobos' predecessors, early choro and samba, folk tunes. Follow [docs/song-workflow.md](docs/song-workflow.md) and aim for 92+ on `play-yaml-fidelity`.
2. **Add vocabulary or instrument controls (`packages/core/src/vocabulary.ts`)**: add playing technique words, drum tokens, or named controls with a unit test in `packages/core/test.ts`.
3. **Add a compile-time generator (`packages/core/src/generate.ts`)**: each generator (`spread:`, `alternate:`, `arp:`, `walk:`) is a pure function that expands a YAML block into measure strings. See [docs/generative-design.md](docs/generative-design.md) for the next ones on the list (`talea:`, `markov:`, `sieve:`).
4. **Improve the web studio or CLI (`packages/web/`, `packages/cli/`)**: UI polish, keyboard shortcuts, or CLI playback flags.

## rules for the codebase

Please make sure both you and your agent follow these rules:

- **Zero dependencies in `@play.yaml/core`**: the core engine runs identically in Node and in the browser. Do not add npm packages or Node/DOM APIs to `packages/core`.
- **Keep the syntax distinct from Tidal/Strudel mini-notation**: read [docs/syntax-differentiation.md](docs/syntax-differentiation.md) before touching the grammar. We use readable YAML keys and score words (`dolce, crescendo to forte over 2`), never in-string operator soup (`*n`, `/n`, `< >`, `(3,8)`, `?`).
- **Determinism**: every random choice in `generate.ts` or `humanize` must come from the seeded hash function (`seed:`). The same `.play.yaml` file must always compile to the exact same MIDI bytes.
- **Update the golden digest when adding or editing a bundled score**: run `UPDATE_GOLDEN=1 npm test -w @play.yaml/core` and check `git diff packages/core/examples.golden.json` to confirm only your song changed.

## copyright rule for songs

This is an open-source MIT repository, and the MIT license covers the code and the scores — so a score can only be here if the **composition itself is free to redistribute**: in the public domain (in Brazil, the EU and most of the world that means the composer died more than 70 years ago; in the US, published before 1930), or your own original work, or released by its author under a licence that allows it.

A note-for-note transcription of a copyrighted piece is a derivative work, however it was made. Film and game soundtracks, jazz standards from the 1950s on, bossa nova, MPB and anything by a living composer do **not** qualify, even when transcribed by ear or from the game's own sound data. Keep those in your own private folder.

For the pieces that do qualify, commit only your own `.play.yaml` transcription and your own notes in `research/*.md`. Never commit third-party `.mid` files, `.musicxml` files, PDF sheet music scans or song lyrics. Your agent can use a reference `.mid` in a temporary folder to run `play-yaml-import --verify` and `play-yaml-fidelity`, then delete the `.mid` before committing.

## submitting a pr

Any PR or draft PR is welcome at any stage. You do not need to ask for permission or claim an issue before starting.

In your PR description, just tell me two things:

1. What command your agent ran to verify the change (`npm test`, `play-yaml-fidelity`, etc.).
2. What you tested or listened to yourself (for song PRs, please press Play or render the MP3 in the studio and listen to it with human ears at least once!).
