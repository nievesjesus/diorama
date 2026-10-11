# Contributing

Thanks for wanting to improve Diorama. Issues and pull requests are welcome. Keep changes small, focused and in English.

## Tests

Every module under `kit/` and every script under `scripts/` has a `*.test.mjs` next to it. Run the whole suite with Node's built-in test runner:

```sh
node --test kit/ scripts/
```

Single file while you work:

```sh
node --test kit/iso.test.mjs
```

## Building the examples

Each example is a `scene.json` plus the standalone page built from it. Rebuild them all with:

```sh
node scripts/build-examples.mjs
```

To also run the geometry audit over the examples:

```sh
node scripts/build-examples.mjs --audit
```

The built pages are committed. If a pull request changes the kit or an example, it must include the rebuilt pages, so the diff stays honest and CI's `git diff --exit-code` stays green.

## House rules

These are not preferences; a change that breaks one will be sent back.

- **No comments in code.** Names carry the intent. If a line needs a comment to be understood, the line needs to be written differently.
- **Zero dependencies.** Only `node:` builtins. Nothing to `npm install`, and nothing that reaches the network at build or render time.
- **Deterministic output.** The same scene renders byte-identical, every run. Never call `Date.now`, `Math.random`, or locale-dependent formatting in a render path.
- **English only.** Code, comments, docs, fixtures and commit messages.
- **Rebuild the examples.** A PR that changes rendering has to include the regenerated pages.

## Issues

Before opening one, search the existing issues. When you file, say what you asked for, what you got, and the smallest `scene.json` or command that reproduces it. For a figure request, include the real numbers (counts, sizes, rates) — a scene needs facts.

## Pull requests

- One topic per PR. Keep the description to what changed and why.
- Run `node --test kit/ scripts/` and rebuild the examples before pushing.
- Match the surrounding style; do not reformat files you are not changing.
- By contributing you agree your work is released under the project's [MIT license](LICENSE).

There is no formal code of conduct yet. Until there is: be kind, assume good faith, and keep review about the code.
