# @coldtea/pr-lens-cli

PR Lens on the command line. It reads a diff with your own model key, checks the result against the contract, and hands you the pull request comment.

MIT © Ohans Emmanuel.

```bash
npx @coldtea/pr-lens-cli analyze --base origin/main
```

## Bring your own key

The key is read from the environment, never from a flag: a flag lands in shell history and in the log of whatever CI runs it. The diff goes to the provider you name and nowhere else — there is no PR Lens service in this path.

```bash
export GEMINI_API_KEY=…
pr-lens analyze --base origin/main --head HEAD
```

Two shapes are implemented rather than a list of vendors:

| `--provider` | Endpoint | Key |
| --- | --- | --- |
| `gemini` (default) | Google's own API | `GEMINI_API_KEY` |
| `openai-compatible` | anything speaking `/chat/completions` | `OPENAI_API_KEY` |

So OpenAI, DeepSeek, Anthropic's compatibility endpoint, OpenRouter, Ollama and llama.cpp are all reached by pointing `--base-url` at them, and a new vendor needs no release here:

```bash
pr-lens analyze --base origin/main \
  --provider openai-compatible \
  --base-url http://localhost:11434/v1 \
  --model qwen3-coder \
  --api-key-env OLLAMA_KEY
```

## The commands

### `analyze`

Diff in, graph document out.

```bash
pr-lens analyze --base origin/main --pr 42 -o pr-lens/graph.json
```

The base is the merge base of the two refs, not the tip of the base branch: a diff against the tip would blame this pull request for every change made on the base branch since it forked.

The commit shas, the repository, the pull request number and the line counts are filled in from the repository itself, and anything the model writes there is discarded. A fact the model is free to restate is a fact that eventually disagrees with itself.

The answer is parsed against the contract. If it fails, the validation errors — paths and all — go back to the model once, and only once: a model that cannot fix a named path in one round does not fix it in three. `--dry-run` reports what would be sent and sends nothing.

### `render`

```bash
pr-lens render pr-lens/graph.json -o pr-lens/
```

Draws the document as self-contained light and dark SVGs and writes the manifest describing them.

### `comment`

```bash
pr-lens comment --graph pr-lens/graph.json --manifest pr-lens/manifest.json \
  --asset-base-url https://raw.githubusercontent.com/owner/repo/pr-lens/42
```

Composes the markdown — the `<picture>` pairs that read in both GitHub themes, the headline chips, the nested `<details>` tree — and prints it. It posts nothing; posting is the caller's business, and `--print-marker` gives that caller the hidden marker that identifies an existing comment to update.

### `validate`

```bash
pr-lens validate pr-lens/graph.json .github/pr-lens.yml
```

Parses graph documents, patch documents, render manifests and configs, JSON or YAML, and reports every problem in each rather than only the first. A file with no `kind` field is read as a config, because a config is the only one of the four a person writes by hand.

### `export`

```bash
pr-lens export pr-lens/graph.json -o .github/pr-lens.map.json
```

Turns a pull-request document into the map of the system once that pull request has merged: elements the change deletes are dropped — with the edges and flow steps that hung from them — the rest stops being annotated, and the result is stamped with the single commit it reflects.

The map is a snapshot, not a source of truth. Nothing reads it back into the pipeline: a committed map that overrode inference would be hand-maintained rot with merge conflicts attached. Commit it so a repository has something to read, to diff, and to hand an agent.

## Corrections

A repository's `.github/pr-lens.yml` is picked up automatically and applied to every fresh analysis — renames, exclusions, lane pins, groupings. It is an overlay: inference never writes back into it, so a correction keeps holding as the code moves and the model renames things between runs.

```yaml
schemaVersion: 0.1.0
map:
  rename:
    - match: functions/src/broadcast/sendBroadcastBulk.ts
      to: Broadcast sender
  exclude:
    - "**/*.test.ts"
```

A correction that matches nothing is reported rather than swallowed, so a config that has drifted out of date is visible. `--config` points elsewhere, `--no-config` ignores it.

## Failures

Every failure carries a code, so a script can branch on it: `USAGE`, `UNREADABLE_FILE`, `UNKNOWN_DOCUMENT`, `INVALID_DOCUMENT`, `GIT_FAILED`, `EMPTY_DIFF`, `REPOSITORY_UNKNOWN`, `MISSING_API_KEY`, `PROVIDER_FAILED`, `MODEL_OUTPUT_INVALID`, `RENDERER_UNAVAILABLE`. Misuse exits 2, everything else exits 1.
