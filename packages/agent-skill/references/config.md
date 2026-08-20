# Correcting the map — `.github/pr-lens.yml`

The generated document is regenerated on every run, so editing it is pointless. Corrections live in `.github/pr-lens.yml`, an overlay applied over fresh inference every time. Inference never writes back into this file, which is why a correction keeps holding as the code moves.

```yaml
schemaVersion: 0.1.0          # required
lenses: [architecture, data-flow]
branding: true
map:
  rename:
    - match: functions/src/broadcast/sendBroadcastBulk.ts
      to: Broadcast sender
  exclude:
    - "**/*.test.ts"
    - scripts/**
  lane:
    - match: packages/broadcast-lib/**
      lane: functions
  group:
    - match: id:build-bulk-payload
      group: broadcast-lib
```

Every field except `schemaVersion` is optional, and the file itself is optional. The JSON Schema for editor autocomplete ships with the contract:

```jsonc
{ "$ref": "node_modules/@coldtea/pr-lens-schema/json-schema/config.schema.json" }
```

## Selectors

A `match` beginning with `id:` addresses exactly one node — `id:build-bulk-payload`. Anything else is a repository-relative path glob matched against the node's file paths.

**Prefer the glob.** Ids come from inference and may change when the code does; a path correction survives that. Reach for `id:` only when no path distinguishes the node, or when the node has no files at all (an external service, a queue).

## The four corrections

| | What it does |
| --- | --- |
| `rename` | replaces the inferred label |
| `exclude` | drops matching nodes, and the edges and flow steps that hung from them |
| `lane` | moves matching nodes into a lane **the document already declares** |
| `group` | clusters matching nodes under a sub-group inside their lane |

Up to 128 of each. They are about intent, never structure: there is no way to add a node, draw an edge or invent a lane here. If the map is wrong in a way corrections cannot express, the fix belongs in the analysis, not in this file.

## Recipes

**"Stop showing me the test files."**
```yaml
map:
  exclude: ["**/*.test.ts", "**/__tests__/**"]
```

**"That node is called the wrong thing."** Match the file it comes from, not its id:
```yaml
map:
  rename:
    - match: server/lib/broadcast/createBroadcastSendTask.ts
      to: Send task
```

**"Keep the shared library together."**
```yaml
map:
  group:
    - match: packages/broadcast-lib/**
      group: broadcast-lib
```

**"Only draw the architecture."**
```yaml
lenses: [architecture]
```

## Check it

```bash
npx @coldtea/pr-lens-cli validate .github/pr-lens.yml
```

A correction that matches nothing is reported when the analysis runs — that is a config that has drifted out of date, not a silent no-op. A lane pin naming a lane the document never declared is skipped and said out loud for the same reason.
