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

Three request shapes are implemented rather than a list of vendors:

| `--provider` | Endpoint | Key |
| --- | --- | --- |
| `gemini` (default) | Google's own API | `GEMINI_API_KEY` |
| `openai` | OpenAI's own API | `OPENAI_API_KEY` |
| `openai-compatible` | anything else speaking `/chat/completions`, named by `--base-url` | `OPENAI_API_KEY` |

DeepSeek, Anthropic's compatibility endpoint, OpenRouter, Ollama and llama.cpp are all reached by pointing `--base-url` at them, and a new vendor needs no release here. OpenAI is listed separately from the servers that copied it because the two have drifted: it renamed the output limit to `max_completion_tokens` and its newer models reject `max_tokens`, which is the only spelling the others know. There is no field both accept, so you say which endpoint you are talking to rather than the CLI guessing from a hostname.

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

Draws the document as self-contained light and dark SVGs — one pair per drill-down section per lens, or one pair per lens when the document has no sections — and writes two files beside them: `manifest.json`, which says what was drawn and under which file name, and `drawn.graph.json`, the document those pictures actually show.

Both matter to what comes next. The manifest is where `comment` gets its file names, so neither command re-derives the other's. And `drawn.graph.json` exists because this is where corrections are applied: excluding a node can empty out a whole drill-down section, and the renderer then draws no picture for it. A comment composed from the document that went *in* would announce a section that came out of nothing.

The SVGs carry no script and no external reference, and the same document renders to the same bytes every time. `--theme light` or `--theme dark` draws one half of the pair.

### `comment`

```bash
pr-lens comment --graph pr-lens/drawn.graph.json --manifest pr-lens/manifest.json \
  --asset-base-url https://raw.githubusercontent.com/owner/repo/pr-lens/42
```

Composes the markdown — the `<picture>` pairs that read in both GitHub themes, the headline chips, the nested `<details>` tree — and prints it. Each diagram links to itself: a comment column is about 830 pixels wide and a system with several lanes is several times that, so it arrives scaled to fit and one click gives a reader the size the labels were drawn at. The two files have to belong to each other: the manifest records the hash of the document it came from, and a mismatched pair is refused rather than composed into a comment describing diagrams nobody drew. It posts nothing; posting is the caller's business, and `--print-marker` gives that caller the hidden marker that identifies an existing comment to update.

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

A repository's `.github/pr-lens.yml` is picked up automatically by `render` and applied at draw time — renames, exclusions, lane pins, groupings. It is an overlay: inference never writes back into it, so a correction keeps holding as the code moves and the model renames things between runs, and the document on disk stays the record of what was inferred.

```yaml
schemaVersion: 0.1.0
map:
  rename:
    - match: functions/src/broadcast/sendBroadcastBulk.ts
      to: Broadcast sender
  exclude:
    - "**/*.test.ts"
```

A lane pin may name a lane the document never declared; the band is created and takes the id for its label. And `render` reports any correction that changed nothing about what it drew — a config that has drifted, usually because the file a selector named has moved, otherwise fails silently and forever.

`--config` points elsewhere and `--no-config` ignores it, on both `render` and `analyze` — `analyze` reads only `lenses` from it, since which lenses to fill is a question for extraction and the rest is a question for drawing.

## Failures

Every failure carries a code, so a script can branch on it: `USAGE`, `UNREADABLE_FILE`, `UNKNOWN_DOCUMENT`, `INVALID_DOCUMENT`, `GIT_FAILED`, `EMPTY_DIFF`, `REPOSITORY_UNKNOWN`, `MISSING_API_KEY`, `PROVIDER_FAILED`, `MODEL_OUTPUT_INVALID`, `RENDER_FAILED`. Misuse exits 2, everything else exits 1.
