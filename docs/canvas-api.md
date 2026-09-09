# The canvas API

`pr-lens canvas` keeps a graph document on a server as a canvas. By default that server is prlens.dev. It does not have to be: `--api <url>` or `PR_LENS_API_URL` points the CLI at any server that speaks the protocol below, and a document pushed there never touches prlens.dev.

This page is that protocol. It is written for someone implementing a private store, so the CLI's `push`, `pull`, `rotate` and `delete` work against it. It covers what travels over the wire and nothing behind it: how the hosted app stores revisions, draws pictures or meters traffic is its own business, and a private server is free to do all of that differently or not at all.

The CLI's client, [`packages/cli/src/canvas/api.ts`](../packages/cli/src/canvas/api.ts), is the reference for the shapes here. Where this page and that file disagree, the file is right and this page has a bug.

## Version

This is version 1 of the contract. Changes to it are additive: a field may be added to an answer, a code may be added to the error table, and a client built against this page keeps working. Removing or retyping anything is a version 2, announced in advance.

## Conventions

- Every path below hangs off the base URL the CLI was given, with trailing slashes removed: `--api https://lens.example.com/` calls `https://lens.example.com/api/canvas`.
- Requests and answers are JSON. The CLI sends `accept: application/json`, a `user-agent` of `pr-lens-cli/<version>`, and `content-type: application/json` whenever it sends a body.
- The CLI gives a request 60 seconds. A server that draws on push should draw within that.
- Answers should carry `Cache-Control: no-store`, so that nothing between the CLI and the server keeps a document under an address that is meant to stay secret.

### Ids and tokens

A canvas has two secrets, and both look the same: 128 random bits as base64url, 22 characters, no padding.

```
^[A-Za-z0-9_-]{22}$
```

The id is the read capability. Anyone who has it can fetch the canvas. The write token is the write capability. Anyone who has it can push over the canvas, rotate the token or delete the canvas. The server mints both; the CLI mints the next write token itself during a rotation.

The hosted app stores only a hash of the token and compares in constant time, so a copy of its index is not a copy of every token. A private server should do the same.

### Errors

Every refusal is a JSON envelope with a code the client switches on, a sentence for the person, and sometimes one more field:

```json
{
  "error": {
    "code": "REVISION_MOVED",
    "message": "The canvas has moved on since you pulled it; pull again, then push",
    "rev": 4
  }
}
```

| Code                  | Status | Extra field                          | The CLI reports                                    |
| --------------------- | ------ | ------------------------------------ | -------------------------------------------------- |
| `NOT_FOUND`           | 404    |                                      | `CANVAS_UNKNOWN` (or `CANVAS_UNAVAILABLE` on mint) |
| `INVALID_REQUEST`     | 400    |                                      | `CANVAS_UNAVAILABLE`, with the message             |
| `INVALID_DOCUMENT`    | 422    | `issues: [{ code, path, message }]`  | `CANVAS_REJECTED`, listing every issue             |
| `CANNOT_DRAW`         | 422    |                                      | `CANVAS_REJECTED`, with the message                |
| `REVISION_MOVED`      | 409    | `rev`: the revision the canvas is at | `CANVAS_CONFLICT`, telling the user to pull first  |
| `DELETION_INCOMPLETE` | 409    |                                      | `CANVAS_UNAVAILABLE`, with the message             |
| `RATE_LIMITED`        | 429    | `retryAt`: ISO 8601 timestamp        | `CANVAS_RATE_LIMITED`, naming the time             |
| `TOO_LARGE`           | 413    |                                      | `CANVAS_UNAVAILABLE`, with the message             |

The message is shown to the person who ran the command, so write it for them. An unknown code, or a refusal without the envelope, is reported as the server being unavailable, so a private server that only ever answers with these codes is understood in full.

`NOT_FOUND` deliberately covers three cases with one answer: an id nobody minted, a right id with a wrong token, and a canvas that was minted but never pushed to. A server that distinguished them would tell a guesser which ids exist.

## Routes

### Mint

```
POST /api/canvas
```

No body, no authentication. Creates an empty canvas and hands out its write token, in plaintext, this once.

```json
{
  "id": "Qk3vZp9xLm2aRt8yWn4bCg",
  "writeToken": "uH7sKd2pXw9qLz4mNc6vTe",
  "rev": 0,
  "viewUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg",
  "editUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg#w=uH7sKd2pXw9qLz4mNc6vTe",
  "embedUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg.svg"
}
```

Status 201. `rev` is always 0 here: a fresh canvas has no revision yet, and a `GET` on it answers `NOT_FOUND` until the first push.

The hosted app rate limits minting by client address and answers `RATE_LIMITED` past that. A private server may or may not.

### Fetch

```
GET /api/canvas/{id}
```

No authentication: the id is the capability. Answers with the current revision.

```json
{
  "id": "Qk3vZp9xLm2aRt8yWn4bCg",
  "rev": 3,
  "viewUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg",
  "embedUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg.svg",
  "document": { "kind": "graph", "schemaVersion": "0.1.1", "...": "..." },
  "tiles": []
}
```

`document` is the graph document exactly as it was last pushed. The CLI parses it with `@coldtea/pr-lens-schema`, so it must be a graph document of a schema version that CLI reads, which it is if the server stored what it was given. `tiles` is described [below](#tiles).

### Push

```
PUT /api/canvas/{id}
Authorization: Bearer {writeToken}
If-Match: {rev}
```

The body is the graph document, as JSON. `If-Match` carries the revision the writer last saw as a plain integer, quotes tolerated. A push that lands on that revision creates the next one; a push that does not is refused with `REVISION_MOVED` and the revision the canvas is actually at, and nothing changes. The first push carries `If-Match: 0`.

The checks happen in this order, and the first to fail is the answer:

1. Missing or unparseable `If-Match`: `INVALID_REQUEST`.
2. Body above the size limit: `TOO_LARGE`. The hosted limit is 4,000,000 bytes, above anything the contract accepts.
3. Body not JSON: `INVALID_REQUEST`.
4. Wrong or missing token, or no such canvas: `NOT_FOUND`.
5. Too many pushes lately: `RATE_LIMITED`, on a server that meters them.
6. `If-Match` not the current revision: `REVISION_MOVED`.
7. Body not a graph document: `INVALID_DOCUMENT`, with every issue `safeParseGraphDoc` found, each as `{ code, path, message }` with `path` a dotted path into the document or an empty string for the root.
8. A document the server cannot draw, or whose walkthrough names things its pictures do not contain: `CANNOT_DRAW`, with a message written for the document's author. A server that does not draw never sends this.

On success:

```json
{
  "id": "Qk3vZp9xLm2aRt8yWn4bCg",
  "rev": 4,
  "viewUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg",
  "editUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg#w=uH7sKd2pXw9qLz4mNc6vTe",
  "embedUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg.svg",
  "tiles": []
}
```

Status 200. The CLI records `rev` and sends it as `If-Match` next time.

### Rotate

```
POST /api/canvas/{id}/rotate
Authorization: Bearer {writeToken}
```

```json
{ "writeToken": "Ab3dEf5gHi7jKl9mNo1pQr" }
```

Retires the current token in favour of the one in the body. The CLI mints the new token and saves it before asking, so an answer lost on the way back costs nothing: it asks again with the same pair.

A server has to handle that replay, which means three rules, checked in this order:

- If the token in the body is already the one on record, answer `rotated` whatever the bearer token says. Knowing the new token is proof enough, and this is how a retry finishes.
- If the bearer token is the one on record, swap it for the one in the body and answer `rotated`.
- Otherwise `NOT_FOUND`.

A body without a `writeToken`, or one that is not 22 characters of base64url, is `INVALID_REQUEST`, checked before the bearer token is looked at.

```json
{
  "id": "Qk3vZp9xLm2aRt8yWn4bCg",
  "editUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg#w=Ab3dEf5gHi7jKl9mNo1pQr"
}
```

Status 200. The CLI also uses this route to _check_ a token without changing it: it asks to rotate the current token onto itself, and reads `rotated` as "that token works" and `NOT_FOUND` as "it does not". The first rule above already covers it: the token in the body is the one on record, so nothing changes and the answer is `rotated`.

### Delete

```
DELETE /api/canvas/{id}
Authorization: Bearer {writeToken}
```

No body. Removes the canvas, every revision of it and every picture drawn from it, for good.

```json
{ "id": "Qk3vZp9xLm2aRt8yWn4bCg", "deleted": true }
```

Status 200. A wrong token or unknown id is `NOT_FOUND`. A deletion that started and could not finish is `DELETION_INCOMPLETE`; the client tries again.

### The addresses in the answers

`viewUrl`, `editUrl` and `embedUrl` are the server's to choose, with two constraints:

- `editUrl` is `viewUrl` with `#w={writeToken}` appended. The token rides in the fragment so a browser never sends it to a server or a referrer. The CLI prints this link and parses it when a user pastes it into `pull`.
- `pull` accepts a pasted link only if its path is `/c/{id}`, with or without `.svg` on the end, and takes the link's origin as the API to call. If you want people to paste your view links into `pr-lens canvas pull`, put the canvas page at `/c/{id}`.

Nothing in the CLI fetches these addresses. What `/c/{id}` and `/c/{id}.svg` serve is up to the server. On the hosted app they are the canvas page and the hero diagram as an SVG.

## Tiles

A tile is one picture the server drew from the document. `fetch` and `push` both answer with the list, in the order the canvas shows them.

```json
{
  "id": "view:checkout",
  "title": "Checkout",
  "lens": "architecture",
  "crumbs": ["overview", "checkout"],
  "hero": true,
  "width": 1708,
  "height": 492,
  "renders": { "light": "…", "dark": "…" },
  "images": {
    "light": "https://lens.example.com/images/Qk3vZp9xLm2aRt8yWn4bCg/checkout.light.svg",
    "dark": "https://lens.example.com/images/Qk3vZp9xLm2aRt8yWn4bCg/checkout.dark.svg"
  }
}
```

| Field             | Meaning                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`              | `view:{viewId}` for a picture of a view, `flow:{flowId}` for a sequence drawn from a flow, `lens:architecture` for the whole map of a document with no views |
| `title`           | The view's or flow's title, or the document's for the whole map                                                                                              |
| `lens`            | `architecture` or `data-flow`                                                                                                                                |
| `crumbs`          | The view's place in the drill-down tree, root first                                                                                                          |
| `hero`            | True on exactly one tile: the first, which is what the embed shows                                                                                           |
| `width`, `height` | The SVG's size in its own units                                                                                                                              |
| `images`          | A URL per theme the picture was drawn in, `light` and `dark`                                                                                                 |
| `renders`         | An opaque handle per theme. The hosted app puts a storage key here; a private server may repeat the URL                                                      |

The CLI checks the shape of every tile it receives and counts them for its output, and does nothing else with them. An empty list is valid. A server that stores documents and draws nothing answers `"tiles": []` to both `fetch` and `push`, and the CLI reports "0 diagrams". The pictures come from `@coldtea/pr-lens-renderer`, which is MIT, so a private server that wants them can draw them with the same package. Which views the hosted app draws, and in what order, is its own choice beyond what the `id` column says.

## Revisions

A canvas is a counter and a document per count. Minting starts the counter at 0 with no document. Each push increments it by one and stores the document sent. `fetch` answers the latest; older revisions are not reachable through this API.

The revision check is the only conflict handling there is. Two writers holding the same token and the same revision both push; the first creates the next revision, the second is told `REVISION_MOVED` and pulls. A refused push changes nothing, and the server never merges two documents.

## The smallest server that works

To run the CLI end to end, a server needs the five routes above, the error envelope, and a store keyed by id holding a token hash, a revision counter and the last document. It can answer `tiles: []`, skip drawing, skip rate limiting and serve nothing at `/c/{id}`. Everything the CLI writes to disk, the document at `.pr-lens/graph.json` and the registry at `.pr-lens/canvas.json`, works the same against it as against prlens.dev.

A walk through the whole lifecycle with curl, against a server at `$API`:

```bash
# mint
curl -s -X POST "$API/api/canvas"
# → 201 { id, writeToken, rev: 0, viewUrl, editUrl, embedUrl }

# first push
curl -s -X PUT "$API/api/canvas/$ID" \
  -H "authorization: Bearer $TOKEN" -H "if-match: 0" \
  -H "content-type: application/json" --data-binary @.pr-lens/drawn.graph.json
# → 200 { id, rev: 1, viewUrl, editUrl, embedUrl, tiles }

# stale push
curl -s -X PUT "$API/api/canvas/$ID" \
  -H "authorization: Bearer $TOKEN" -H "if-match: 0" \
  -H "content-type: application/json" --data-binary @.pr-lens/drawn.graph.json
# → 409 { error: { code: "REVISION_MOVED", message, rev: 1 } }

# fetch
curl -s "$API/api/canvas/$ID"
# → 200 { id, rev: 1, viewUrl, embedUrl, document, tiles }

# rotate, then rotate again with the same pair
curl -s -X POST "$API/api/canvas/$ID/rotate" -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" -d "{\"writeToken\":\"$NEXT\"}"
# → 200 { id, editUrl }   (both times)

# delete
curl -s -X DELETE "$API/api/canvas/$ID" -H "authorization: Bearer $NEXT"
# → 200 { id, deleted: true }
```

## What this page leaves out

On purpose: how the hosted app stores revisions and pictures, how it hashes and turns over tokens on its side, its rate limit numbers, what its canvas page does with a document, and how it plays a walkthrough. None of it crosses the wire or is needed to answer the CLI, and all of it may change without notice. If you find yourself needing one of them to make the CLI work, that is a gap in this page: open an issue.
