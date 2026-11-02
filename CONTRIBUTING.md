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
Read README.md, CONTRIBUTING.md, and docs/syntax-differentiation.md.
Then implement the change and run `npm run build && npm test` to verify.
```

## quick setup

You only need Node.js (v16 or newer) and npm.

```bash
npm install
npm run build
npm test
```

To open the browser studio on `https://localhost:5173`:

```bash
npm run dev:vite -w @play.yaml/web
# From here, ask your AI agent for help. Good luck!
```

## easy ways to contribute

You do not need to learn the whole compiler to ship something cool. These four areas live in one file or folder each:

1. **Transcribe a song (`songs/<slug>/`)**: pick a classical piece, jazz standard, Brazilian samba/choro, or retro video game track. Follow [docs/song-workflow.md](docs/song-workflow.md) and aim for 92+ on `play-yaml-fidelity`.
2. **Add vocabulary or instrument controls (`packages/core/src/vocabulary.ts`, `surface.ts`)**: add playing technique words, drum tokens, or VST parameter surfaces with a unit test in `packages/core/test.ts`.
3. **Add a compile-time generator (`packages/core/src/generate.ts`)**: each generator (`spread:`, `alternate:`, `arp:`, `walk:`) is a pure function that expands a YAML block into measure strings. See [docs/generative-design.md](docs/generative-design.md) for the next ones on the list (`talea:`, `markov:`, `sieve:`).
4. **Improve the web studio or CLI (`packages/web/`, `packages/cli/`)**: UI polish, keyboard shortcuts, or CLI playback flags.

## rules for the codebase

Please make sure both you and your agent follow these rules:

- **Zero dependencies in `@play.yaml/core`**: the core engine runs identically in Node and in the browser. Do not add npm packages or Node/DOM APIs to `packages/core`.
- **Keep the syntax distinct from Tidal/Strudel mini-notation**: read [docs/syntax-differentiation.md](docs/syntax-differentiation.md) before touching the grammar. We use readable YAML keys and score words (`dolce, crescendo to f over 2`), never in-string operator soup (`*n`, `/n`, `< >`, `(3,8)`, `?`).
- **Determinism**: every random choice in `generate.ts` or `humanize` must come from the seeded hash function (`seed:`). The same `.play.yaml` file must always compile to the exact same MIDI bytes.
- **Update the golden digest when adding or editing a bundled score**: run `UPDATE_GOLDEN=1 npm test -w @play.yaml/core` and check `git diff packages/core/examples.golden.json` to confirm only your song changed.

## copyright rule for songs

This is an open-source MIT repository. Commit only your own `.play.yaml` transcription and your own notes in `research/*.md`.

Never commit third-party `.mid` files, `.musicxml` files, PDF sheet music scans, SPC game rips, or song lyrics. Your agent can use a reference `.mid` in a temporary folder to run `play-yaml-import --verify` and `play-yaml-fidelity`, then delete the `.mid` before committing.

## submitting a pr

Any PR or draft PR is welcome at any stage. You do not need to ask for permission or claim an issue before starting.

In your PR description, just tell me two things:

1. What command your agent ran to verify the change (`npm test`, `play-yaml-fidelity`, etc.).
2. What you tested or listened to yourself (for song PRs, please press Play or render the MP3 in the studio and listen to it with human ears at least once!).
