# Authoring a graph document

This page is the whole shape, and what a schema cannot tell you besides: which parts matter, and where documents actually go wrong. `references/example.graph.json` is one document that validates, if you would rather read than be told.

The validator enforces the same thing from a JSON Schema, published at `https://unpkg.com/@coldtea/pr-lens-schema/json-schema/graph-doc.schema.json` if you want it machine-readable.

Every schema here is **strict**: an unknown key is a rejection, not a warning. A field with a default may be left out.

## The document

```json
{
  "schemaVersion": "0.3.1",
  "kind": "graph",
  "title": "Batch broadcast sending through Postmark",
  "summary": "One paragraph answering: what does this change do?",
  "lenses": ["architecture", "data-flow"],
  "provenance": { "repo": { "owner": "…", "name": "…" }, "base": { "sha": "…" }, "head": { "sha": "…" } },
  "lanes": [],
  "nodes": [],
  "edges": [],
  "flows": [],
  "stats": {},
  "views": []
}
```

`lenses` declares what the document carries enough detail to draw: `architecture`, `data-flow`, `data-model`, or any of them together. A document carrying flows must declare `data-flow`; one carrying a `dataModel` must declare `data-model`.

`provenance` is where the document came from: the repository, the base and head commit shas (lowercase hex, 7-40 characters), optionally the pull request and the generator. When you produce a document through the CLI these are filled in from the repository, so do not invent them.

## Ids

`^[A-Za-z0-9][A-Za-z0-9._:/-]*$`, at most 128 characters, unique within their own collection. Use readable kebab-case: `broadcast-sender`, not `n1`. An id ends up in an SVG id, a URL fragment and a comment anchor, so nothing else is allowed through.

## Deltas

Every node, edge, flow and flow step declares one: `added`, `modified`, `removed`, `unchanged`.

`unchanged` is not padding. It is the neighbouring code the change touches, and it is what turns a diagram into a blast radius. A document whose every element is `added` describes a change nobody can place.

## Lanes

1 to 16. Every node belongs to exactly one.

```json
{ "id": "functions", "label": "Cloud Functions", "subtitle": "Node 20", "order": 1 }
```

`order` (0-64) places lanes left to right; ties fall back to array order. Give a lane a `delta` only when the lane itself is new or gone.

## Nodes

1 to 256.

```json
{
  "id": "send-broadcast-bulk",
  "label": "sendBroadcastBulk",
  "kind": "function",
  "delta": "added",
  "lane": "functions",
  "group": "broadcast-lib",
  "subtitle": "(broadcastId) => Promise<void>",
  "summary": "Claims the broadcast, builds one bulk payload and posts it.",
  "files": [{ "path": "functions/src/broadcast/sendBroadcastBulk.ts", "startLine": 1, "endLine": 142 }],
  "badges": ["retry"]
}
```

`kind` is one of `service app module function route job queue datastore cache external ui config test package other`. It drives the card's icon and shape and nothing else; when in doubt, `other` still renders.

`group` clusters nodes inside a lane: a package, a folder that means something. `files` (up to 64) become diff permalinks. `badges` (up to 6) are extra chips; the delta badge is drawn for you, so do not restate it.

## Edges

Up to 512.

```json
{
  "id": "bulk-to-postmark",
  "from": "send-broadcast-bulk",
  "to": "postmark",
  "kind": "http",
  "delta": "added",
  "label": "POST /email/bulk",
  "emphasis": "hero",
  "animated": true
}
```

`kind` is one of `call http rpc event queue data dependency render other`. `emphasis` is `normal` (default), `hero` or `muted`. More than one or two heroes and the emphasis stops meaning anything. `from` and `to` must be node ids you declared. This is the single most common failure.

## Flows

Up to 16, for the data-flow lens.

```json
{
  "id": "send-pipeline",
  "title": "Sending a broadcast",
  "delta": "modified",
  "participants": [{ "node": "queue-route" }, { "node": "send-broadcast-bulk" }, { "node": "postmark" }],
  "messages": [
    { "id": "enqueue", "from": "queue-route", "to": "send-broadcast-bulk", "label": "enqueue job", "kind": "async", "delta": "modified" },
    { "id": "send", "from": "send-broadcast-bulk", "to": "postmark", "label": "POST /email/bulk", "kind": "sync", "delta": "added", "repeat": 4 },
    { "id": "accepted", "from": "postmark", "to": "send-broadcast-bulk", "label": "200 Accepted", "kind": "return", "delta": "added" }
  ]
}
```

- 2 to 12 participants, ordered by array position; each names a node id.
- 1 to 64 messages. **Step order is array order**: there is no step number field, so a document cannot disagree with its own animation.
- `kind` is `sync`, `async`, `return` or `self`. `self` requires `from === to`, and no other kind may have them equal.
- Both endpoints must be participants of that flow, not merely nodes of the document.
- `repeat` says a step happens more than once per run, e.g. 4 batched requests.
- `payload`: what travels on the step. Optional. Only a canvas draws it, so leave it out of a document that is not going to one.

### Sample traffic

```json
{
  "id": "send",
  "from": "send-broadcast-bulk",
  "to": "postmark",
  "label": "POST /email/bulk",
  "kind": "sync",
  "delta": "added",
  "payload": {
    "request": {
      "type": "EmailBatch[500]",
      "shape": "Email[]  // max 500\nEmail = { From: string; To: string; Subject: string }",
      "sample": [{ "From": "news@example.com", "To": "ada@example.com", "Subject": "The batching issue, fixed" }],
      "before": [{ "From": "news@example.com", "To": "ada@example.com", "Cc": "ops@example.com", "Subject": "The batching issue, fixed" }],
      "source": { "path": "tests/fixtures/postmark-batch.json" }
    },
    "response": { "type": "void" }
  }
}
```

- A payload has `request`, `response` or both. One with neither is rejected.
- `type` is required on a side: a name a reader of the code would know, with the count in it for a collection (`EmailBatch[500]`). `void` for a side that carries nothing.
- `shape` is the type signature as text, up to 2048 bytes.
- `sample` and `before` are JSON values written inline, not JSON strings. A string where a value belongs is rejected. Each is at most 8 levels deep and 4096 bytes once serialised. The parser refuses a value over either cap rather than truncating it.
- `before` needs a `sample` to differ from.
- `source` is a file reference, the fixture or type the side was taken from.
- `changedPaths` is filled in when the document is stored, from `before` and `sample`. Do not write it. Up to 64 paths of the form `Metadata.batchId`, `[0].Cc` or `headers["Content-Type"]`.
- Use placeholder values in samples: `ada@example.com`, `cmp_0001`. Never one that could belong to a real person or unlock anything.

## Data model

For the data-model lens. Write one only when the change touched a schema: a migration, an ORM model, a schema or a SQL file. A change that touched no schema has no data model, and the document leaves `dataModel` out.

```json
{
  "stores": [
    { "id": "identity", "label": "Identity", "platform": "Postgres" },
    { "id": "billing", "label": "Billing", "platform": "Postgres" }
  ],
  "tables": [
    {
      "id": "user",
      "label": "User",
      "store": "identity",
      "name": "users",
      "delta": "modified",
      "badges": ["−1 column"],
      "columns": [
        { "name": "id", "type": "uuid", "key": "primary", "delta": "unchanged" },
        { "name": "email", "type": "citext", "delta": "unchanged" },
        { "name": "stripe_customer_id", "type": "text", "delta": "removed" }
      ],
      "files": [{ "path": "migrations/0042_billing_by_org.sql", "startLine": 30, "endLine": 34 }]
    },
    {
      "id": "subscription",
      "label": "Subscription",
      "store": "billing",
      "name": "subscriptions",
      "delta": "modified",
      "badges": ["key moved"],
      "columns": [
        { "name": "id", "type": "uuid", "key": "primary", "delta": "unchanged" },
        { "name": "user_id", "type": "uuid", "key": "foreign", "delta": "removed" },
        { "name": "org_id", "type": "uuid", "key": "foreign", "delta": "added" },
        { "name": "amount_cents", "type": "bigint", "previousType": "int", "delta": "modified" }
      ],
      "files": [{ "path": "migrations/0042_billing_by_org.sql", "startLine": 36, "endLine": 48 }]
    }
  ],
  "relations": [
    { "id": "subscription-user", "from": { "table": "subscription", "column": "user_id" }, "to": { "table": "user", "column": "id" }, "delta": "removed", "label": "billed to the user until now" }
  ]
}
```

- A `store` is a database, a schema or a namespace: the lane a table sits in, so split one database into the schemas or domains a reader would name (identity, workspace, billing) rather than one store for everything; the picture reads left to right. `label` is the team's word for it and `platform` the engine, which goes in the lane header beside the label, so do not repeat the engine in the label. 1 to 16.
- A `table` is a table, a collection or a key family: a Mongo collection with its fields, or a Redis key pattern such as `invoice:{id}:lock` with its fields and ttl, is a table in a store whose `platform` is that engine. `label` is what a reader calls it, `name` the physical name when it differs. 1 to 64 tables, each with 1 to 64 columns. Every table names a store you declared.
- Columns carry a delta each, so a dropped column is drawn struck through and an arrived one in green. `key` is `primary` for the table's own key, `foreign` for a column that holds another table's key, `index` for an index row; leave it out otherwise. A column whose type changed keeps the old spelling in `previousType`, so the picture says `int → bigint`. No table lists a column twice.
- A `relation` runs from the column that holds a key to the column it points at, each end `{ "table", "column" }`, and every end must be a column that table lists. `enforced: false` draws a reference nothing enforces, such as one across stores, as a dotted line. Up to 256.
- A key that moved from one table to another is two relations: the old one `removed`, with a `label` that is a short clause with a verb saying what was true before: who owned, held or paid for what. `user subscription` names the tables and says nothing; `shipped from the warehouse until now` on an orders key says what changed. Then the new one, `added`.
- A column's `type` is a name as the schema spells it, up to 64 characters: `uuid`, `text[]`, `numeric(5,4)`, `timestamp with time zone`. A quote, an equals sign, a slash, a colon or a `--` is refused, because they belong to defaults, literals, connection strings and comments, and the picture shows the shape of the data, never the data. A `summary` says what a table is for and names no value.
- Include the unchanged tables a changed key points at, marked `unchanged`, so the reader sees what hangs off the thing that moved. Leave out tables the change does not touch and nothing touched points at.
- `files` on a table are the migration and model lines that define it; they become the diff links.

## Stats

```json
{ "filesChanged": 27, "additions": 1979, "deletions": 1370, "chips": [{ "label": "Postmark calls", "value": "500x fewer", "tone": "hero" }] }
```

Up to 8 chips, `tone` one of `neutral added modified removed hero`. Per-delta element counts are deliberately absent from the schema: they are derivable from the document, and a stored copy can only go stale.

## Views

The drill-down tree in the comment: up to 32 at the root, nesting up to 32 children each. A document with no views renders as one picture and nothing else.

```json
{
  "id": "the-new-path",
  "title": "The new batch path",
  "lens": "architecture",
  "summary": "What replaced the per-recipient loop.",
  "defaultOpen": false,
  "scope": { "kind": "selection", "nodes": ["send-broadcast-bulk", "postmark"] },
  "children": []
}
```

`scope` is either `{ "kind": "all" }` (the default) or a selection naming at least one node, edge, flow or table. The two are distinct states on purpose: removing the last element a view pointed at can never quietly turn it into a view of everything. A view's `lens` must be one the document declares. A selection may also name lanes, but leave them out: a lane draws every node in it, wanted or not.

### Choosing architecture views

Treat the architecture tree as a set of decisions, not a quota:

1. Ask whether the change affects a user, an external system or a system boundary. If it does, start with a system-context view. If it does not, leave that level out.
2. Show affected applications, services, jobs, data stores and runtimes in a container view. Make it the root when there is no useful context view; otherwise make it a child of that context.
3. Add a component child only when the internals of an affected container matter to the change. Components may be modules, routes or functions, but the view should explain their responsibilities and relationships rather than mirror folders.
4. Stop at components unless someone explicitly asks for code-level detail.

One architecture view may be the right answer for a small change. Each child must move down exactly one level and cover a materially narrower scope. Skip a level when it would be empty, speculative or a repeat of its parent. Do not create two views with substantially the same nodes and edges, and do not infer a boundary from a folder name alone. Keep unchanged direct neighbours when they make the blast radius clear.

Set `defaultOpen: true` on the highest useful architecture view. Lower levels should normally stay collapsed. A data-flow view describes an ordered sequence, so keep it as a separate root instead of placing it inside the architecture hierarchy.

This compact fragment shows the shape. The selected ids refer to elements declared elsewhere in the document:

```json
{
  "views": [
    {
      "id": "checkout-context",
      "title": "Checkout in its environment",
      "lens": "architecture",
      "defaultOpen": true,
      "scope": {
        "kind": "selection",
        "nodes": ["shopper", "commerce-platform", "payment-provider", "fulfilment-system"],
        "edges": ["shopper-to-commerce", "commerce-to-payment", "commerce-to-fulfilment"]
      },
      "children": [
        {
          "id": "checkout-containers",
          "title": "Checkout containers",
          "lens": "architecture",
          "scope": {
            "kind": "selection",
            "nodes": ["storefront", "checkout-api", "orders-db", "payment-provider"],
            "edges": ["storefront-to-checkout", "checkout-to-orders", "checkout-to-payment"]
          },
          "children": [
            {
              "id": "checkout-components",
              "title": "Checkout API components",
              "lens": "architecture",
              "scope": {
                "kind": "selection",
                "nodes": ["checkout-route", "order-service", "payment-client"],
                "edges": ["route-to-orders", "orders-to-payment-client"]
              }
            }
          ]
        }
      ]
    },
    {
      "id": "place-order-flow",
      "title": "Placing an order",
      "lens": "data-flow",
      "scope": { "kind": "selection", "flows": ["place-order"] }
    }
  ]
}
```

## Walkthrough

Optional in the format, but write one for anything that is not trivial: more than one diagram, a diagram with several changed parts, or any flow. Skip it only when the document is one small diagram whose single step would just repeat the title. A canvas or a share page plays it.

```json
{
  "walkthrough": {
    "steps": [
      {
        "id": "four-batch-calls",
        "heading": "Postmark now gets 500 emails per call",
        "body": "One call per batch, and Postmark answers with a result for each message.",
        "stage": { "kind": "flow", "flow": "send-pipeline" },
        "focus": { "kind": "selection", "messages": ["batch-post", "batch-results"] },
        "detail": {
          "text": "sendBroadcastBulk posts each batch to Postmark and reads the results back.",
          "cites": [
            { "text": "sendBroadcastBulk", "ref": { "kind": "node", "node": "send-broadcast-bulk" } },
            { "text": "posts each batch", "ref": { "kind": "message", "flow": "send-pipeline", "message": "batch-post" } },
            { "text": "Postmark", "ref": { "kind": "node", "node": "postmark" } }
          ]
        }
      },
      {
        "id": "old-path-goes-dark",
        "heading": "processBroadcast and sendSingleEmail removed",
        "body": "sendBroadcastBulk does their job for whole batches.",
        "stage": { "kind": "view", "view": "retired-path" },
        "focus": { "kind": "selection", "nodes": ["process-broadcast", "send-single-email"] }
      }
    ]
  }
}
```

A walkthrough is a short guided tour of the diagrams. It has two to twelve steps. Each step shows one diagram, points at one part of it, and says a few words about it.

Every step is one change, never a description of the diagram: the heading names the thing and what happened to it, built from change words such as added, removed, replaced, now, moved and split, and the body is one line on what that means for behaviour, with the numbers when they matter. The headline change is step one and the last step is the last real change. Do not end on a recap: the reader already saw the whole picture when the canvas opened. Write it all for a smart twelve-year-old, in short common words and active voice. The skill page has the rule in full, with examples of a step written well and the same step written badly.

Each step has:

- `heading`: the thing and what happened to it, up to 48 characters, in sentence case. For example "Postmark now gets 500 emails per call".
- `body`: one line under the heading, up to 140 characters, on what the change means for behaviour. For example "One call per batch instead of one call per person". Required: a heading with no body reads as unfinished.
- `stage`: which diagram to show. A document can have several diagrams: its views (the drill-down diagrams) and its flows (the sequence diagrams). `{ "kind": "view", "view": "overview" }` shows the view called `overview`. `{ "kind": "flow", "flow": "send-pipeline" }` shows the flow called `send-pipeline`. Leave `stage` out and the step uses the diagram the reader is already on.
- `focus`: what to zoom in on inside that diagram. `{ "kind": "all" }`, the default, means the whole diagram. A selection means "just these things": name any lanes, nodes, edges, tables or flow steps (`messages`) by id, and the camera zooms to them while everything else dims. A selection must name at least one thing. The canvas lights everything inside one box around what a focus names, so keep it small: up to three nodes and the edges between them on a view of four cards or fewer, one node on a bigger view, and up to three flow steps in a row on a flow. Never name a lane. The skill page has the rule in full.
- `detail`: optional. One or two sentences under the body, up to 240 characters, that name the parts of the diagram the step is about. `text` is the sentence. `cites` turns words in it into links: each cite has `text`, copied letter for letter from the sentence, and a `ref`. A `ref` is `{ "kind": "node", "node": … }`, `{ "kind": "message", "flow": …, "message": … }`, `{ "kind": "view", "view": … }`, `{ "kind": "flow", "flow": … }`, `{ "kind": "table", "table": … }` or `{ "kind": "column", "table": …, "column": … }`. List cites in the order the sentence says them. A detail has one to eight, and no two use the same words. Do not cite files on a canvas you push: with no pull request behind it, a file link shows as plain words.

The validator checks:

- Every id you name exists in the document. A flow step you name must belong to the flow the stage shows, because flow step ids are only unique inside their own flow.
- `messages` needs a stage that shows a flow. Leave it out when the stage is an architecture view.
- Step ids are unique within the walkthrough. Two steps minimum, twelve maximum.
- Every cite's words are in its detail's `text`, in the order the cites are listed. The node, flow step, view, flow, table or column it points to exists in the document.
- A stored map never carries a walkthrough. A map describes the system; a walkthrough tells the story of one change.

A step about the data model stages the view whose lens is `data-model` and focuses `tables`. That is how a moved key gets its story: "Billing follows the org", focused on the two tables it moved between, with the old and new columns cited.

## Layout

```json
{ "direction": "right", "laneOrder": ["api", "functions", "external"], "rank": { "send-broadcast-bulk": 2 } }
```

Hints, not instructions: the renderer owns final placement, so a diagram stays deterministic and a stale hint cannot break it. Absolute coordinates are not expressible. Omitting `layout` entirely is normal.

## File references

```json
{ "path": "functions/src/broadcast/sendBroadcastBulk.ts", "startLine": 1, "endLine": 142, "revision": "head" }
```

Repository-relative POSIX paths: no leading `/`, no drive letter, no backslash, no `..` segment. Lines are 1-based, `endLine` requires `startLine` and may not precede it. `revision` defaults to `head`; use `base` on elements the change removes.

## Length limits

Labels 120 characters, summaries 2000, chip values 32. A data model holds up to 16 stores, 64 tables of 64 columns each, and 256 relations. They are display fields: a label that needs 120 characters is a label the diagram cannot draw. On a payload side, `shape` 2048 bytes, `sample` and `before` 4096 bytes each once serialised and 8 levels deep, `changedPaths` 64 entries.

## Then validate

```bash
npx @coldtea/pr-lens-cli@latest validate .pr-lens/graph.json
```

Every problem is reported at once, with a path into the document. Fix them all and run it again until it is clean.
