# The canvas API

This documents the protocol underneath the canvas page. Mostly the shape of /api/canvas — the three methods, request and response bodies, auth header, revision-conflict semantics as a stable contract. So you can implement a private store and set PR_LENS_API_URL at it to self host your own canvas.

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
- The CLI does not follow redirects, and it reports a 3xx as the server being unavailable. A store must answer every route directly at the base URL it was given.

### Ids and tokens

A canvas has two secrets, and both look the same: 128 random bits as base64url, 22 characters, no padding.

```
^[A-Za-z0-9_-]{22}$
```

The id is the read capability. Anyone who has it can fetch the canvas. The write token is the write capability. Anyone who has it can push over the canvas, rotate the token or delete the canvas. The server mints both; the CLI mints the next write token itself during a rotation.

The hosted app stores only a hash of the token and compares in constant time, so a copy of its index is not a copy of every token. A private server should do the same.

### The account credential

The [ownership routes](#ownership) take a third secret. It says who is asking and grants nothing on any one canvas by itself. The hosted app's account tokens are 128 random bits as base64url behind a prefix naming the kind, sent in the header:

```
Authorization: Bearer prl_u_xK9mQw2vRt7yLp4nBc6sZe
```

The CLI keeps one per origin, so a private store never receives the credential for another. `$PR_LENS_TOKEN` overrides the stored one, which is how CI signs in without a browser. An empty `$PR_LENS_TOKEN` counts as unset, because a workflow with no token to pass sets it to the empty string.

A store with no accounts serves none of these routes, and the CLI carries on without them: everything under [Routes](#routes) works signed out. Pushing, pulling, rotating and deleting a canvas never require an account.

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
| `UNAUTHENTICATED`     | 401    |                                      | `AUTH_REQUIRED`, telling the user to sign in       |
| `ALREADY_OWNED`       | 409    |                                      | `CANVAS_OWNED`, naming the canvas                  |
| `LIVE_ENDED`          | 404    |                                      | `LIVE_ENDED`, telling the user to open a new tab   |
| `UNKNOWN_PLACE`       | 422    | `unknown`, `valid`: see [Live mode](#live-mode) | `LIVE_UNKNOWN_PLACE`, listing both      |
| `NOT_OWNER`           | 403    |                                      | `CANVAS_UNAVAILABLE`, with the message             |
| `INSTALL_REVOKED`     | 403    |                                      | `CANVAS_UNAVAILABLE`, with the message             |
| `MACHINE_LINKED`      | 409    |                                      | `CANVAS_UNAVAILABLE`, with the message             |

No route on this page raises the last three. They are listed because one vocabulary owns every code and its status. `NOT_OWNER` is only for a caller who already knows the canvas exists because it came from their own listing. Everywhere else, "exists, and is not yours" stays `NOT_FOUND`, including on the [re-grant route](#a-fresh-write-token-for-an-owner). `INSTALL_REVOKED` and `MACHINE_LINKED` belong to the machine-linking route the CLI signs in through, which this page does not cover. A private store that never sends any of the three is understood in full.

The message is shown to the person who ran the command, so write it for them. An unknown code, or a refusal without the envelope, is reported as the server being unavailable, so a private server that only ever answers with these codes is understood in full.

`NOT_FOUND` deliberately covers three cases with one answer: an id nobody minted, a right id with a wrong token, and a canvas that was minted but never pushed to. A server that distinguished them would tell a guesser which ids exist.

## Routes

### Mint

```
POST /api/canvas
```

No body, no authentication. Creates an empty canvas and hands out its write token, in plaintext, this once.

The CLI may send one optional header:

```
X-PR-Lens-Install: prl_i_...
```

It names the machine that minted, so a person who signs in there later can be given the canvases that machine pushed. A server that ignores it still behaves exactly as this page describes, and the CLI won't notice. A mint without an install id stays anonymous, like every mint before anyone signs in. The value is 128 random bits as base64url behind a `prl_i_` prefix. The CLI keeps one per origin, so a private store never learns the id used anywhere else.

A signed-in CLI also sends the [account credential](#the-account-credential) on this request. A CI runner is a new machine every time, so its install id is never linked, and the bearer is the only way a workflow's canvases reach the account that named it. The hosted app gives such a canvas to that account as soon as it is minted. A store with no accounts ignores the header. One that recognises the token's shape but finds no account behind it answers `UNAUTHENTICATED`, so a workflow whose token was revoked finds out instead of drawing canvases nobody will ever see.

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

## Ownership

These three routes are optional, and they are the only ones on this page that ask who you are. They let a person see every canvas they own from a machine that never pushed it, and take a canvas onto their account from a machine they no longer have.

A store that serves none of them is still complete. `push`, `pull`, `rotate` and `delete` never require an account, `pr-lens canvas list` reads the local registry, and only `canvas list --remote` and `canvas claim` use these routes.

### Everything an account owns

```
GET /api/canvases
Authorization: Bearer {accountToken}
```

```json
{
  "canvases": [
    {
      "id": "Qk3vZp9xLm2aRt8yWn4bCg",
      "rev": 3,
      "createdAt": "2026-02-11T09:14:02.000Z",
      "lastWriteAt": "2026-03-02T16:40:55.000Z",
      "viewUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg",
      "embedUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg.svg",
      "preview": {
        "type": "drawn",
        "title": "Auth flow rewrite",
        "delta": { "added": 4, "changed": 2, "removed": 1 }
      }
    }
  ]
}
```

Status 200, or `UNAUTHENTICATED` when there is no account behind the credential. The answer carries no write tokens, because only their hashes were ever stored, so a machine can own a canvas here and still hold no write token for it. `canvas list --remote` shows exactly that: it merges this answer over the local registry, and the `EDIT HERE` column comes from the registry alone.

`preview` is what a listing can say about a canvas without opening it, and it has three shapes:

| `type`       | Carries          | Means                                                            |
| ------------ | ---------------- | ---------------------------------------------------------------- |
| `drawn`      | `title`, `delta` | A revision that reads. `title` is the document's                 |
| `not_drawn`  |                  | Minted, never pushed to. `rev` is 0                              |
| `unreadable` |                  | The revision would not read. Not an empty canvas                 |

`unreadable` means the read failed. Keep it apart from `not_drawn`: a store that answered `not_drawn` for a failed read would tell a person their work is gone because a bucket had a bad minute. The CLI shows a canvas with no `title` under its id, as the local listing does for one nobody named.

Order is the server's business; the CLI sorts by name and then by id. It reads `id`, `rev` and the preview's `title`, and ignores everything else in the answer.

### Claiming a canvas

```
POST /api/canvas/{id}/claim
Authorization: Bearer {accountToken}
```

```json
{ "writeToken": "uH7sKd2pXw9qLz4mNc6vTe", "nextWriteToken": "Ab3dEf5gHi7jKl9mNo1pQr" }
```

Takes a canvas onto the account on the strength of its write token, and retires that token in the same step. Both write tokens go in the body because the header carries the account credential.

The claim rotates the token because a write token sits in the fragment of every edit link ever shared. If possession alone granted ownership and the token survived, every link ever pasted into a chat would be a standing offer of the canvas. Whoever claims walks away with a token nobody else has seen.

The checks happen in this order, and the first to fail is the answer:

1. No account behind the credential: `UNAUTHENTICATED`.
2. Body above the size limit: `TOO_LARGE`. Not JSON, or missing either token: `INVALID_REQUEST`.
3. `nextWriteToken` not 22 characters of base64url: `INVALID_REQUEST`.
4. No such canvas, or neither token is the one on record: `NOT_FOUND`. Possession is checked before ownership, so a canvas that is somebody else's cannot be told from one that never existed.
5. Already owned by another account: `ALREADY_OWNED`. The caller has shown the write token by this point, so they know the canvas is real and naming the case gives nothing away.

```json
{
  "id": "Qk3vZp9xLm2aRt8yWn4bCg",
  "editUrl": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg#w=Ab3dEf5gHi7jKl9mNo1pQr"
}
```

Status 200. The app writes ownership first, and only once, so two racing claims cannot both win; the token swap follows.

Asking again with the same pair gets 200 again, which is how a claim whose answer was lost gets finished. [rotate](#rotate) has the same replay rule, and it is why the caller brings the next token instead of being handed one.

If the owner asks again with a different next token, the app rotates the token instead of refusing. First claim wins, and after that a claim only ever finishes itself. The CLI never makes that call: `canvas claim` asks `/api/canvases` first and stops if the canvas is already yours, so running the command twice never rotates by surprise. A store implementing this route should know it leaves that decision to the caller.

### A fresh write token for an owner

```
POST /api/canvas/{id}/write-token
Authorization: Bearer {accountToken}
```

```json
{ "writeToken": "Ab3dEf5gHi7jKl9mNo1pQr" }
```

For an owner who has no write token left. Only a hash was ever kept, so the old token cannot be handed back. This route replaces it, and any edit link still in circulation stops working. Ownership is the only proof, so the body carries just the new token.

- No account behind the credential: `UNAUTHENTICATED`.
- A body that is not JSON, or a `writeToken` that is not 22 characters of base64url: `INVALID_REQUEST`.
- An unknown id, a canvas nobody owns, or one owned by somebody else: `NOT_FOUND`, all three. `NOT_OWNER` is deliberately not used here, since it would tell anyone with an account which ids are real.
- Otherwise 200, with the same `{ id, editUrl }` a claim answers with.

The CLI does not call this route yet.

## Live mode

A canvas can follow the reader's own coding agent. The agent runs `pr-lens canvas open .pr-lens/<drawing>/drawn.graph.json`, which pairs one browser tab, and then sends answers, camera moves and drawings to that tab through the server. The server checks every id against the canvas and relays what it resolved; the thinking happens on the reader's machine, not the server's.

A store that serves none of these routes is still understood: `open` is reported as the store being unavailable, and nothing else on this page changes.

Two credentials. The CLI sends the same bearer a [push](#push) takes, a write token or an owner's [account credential](#the-account-credential). The paired tab sends the session's secret as its bearer, and never the write token.

Session ids and secrets are 22 characters of base64url. A session lasts 2 hours after the last thing sent to it.

### Open a session

```
POST /api/canvas/{id}/live
Authorization: Bearer {writeToken}
```

No body. Mints a session on the canvas as it stands.

```json
{
  "session": "Tq8wLm3xZp9aRv2yNc4bKe",
  "url": "https://lens.example.com/c/Qk3vZp9xLm2aRt8yWn4bCg#live=Tq8wLm3xZp9aRv2yNc4bKe.Hs5dPw7qXk2mLz9nBv4cTa",
  "expiresAt": "2026-09-25T18:00:00.000Z"
}
```

Status 200. `url` is the canvas page with the session and its secret in the fragment, so the secret never reaches a server log or a referrer. The CLI opens it once and keeps `session` beside the write token. A canvas nobody has pushed to, a wrong token or an unknown id is `NOT_FOUND`.

### Send a command

```
POST /api/canvas/{id}/live/{session}
Authorization: Bearer {writeToken}
```

The body is a `LiveCommand` from `@coldtea/pr-lens-schema` (published as `live-command.schema.json` beside the graph document's schema). There are three kinds:

- `answer`: `{ question, steps }`, one to four steps. Each step takes a walkthrough step's `stage` and `focus`, a `heading`, and paragraphs of `parts`, where a part that names a place carries a `ref`.
- `show`: a `stage` and `focus` to move the camera to, and optionally a message whose payload to open.
- `fork`: a graph document of what is inside one or more components, drawn under them.

Ids are the document's own: a component is a node id, a message is `flowId/messageId`, a diagram is a view or flow id. The server resolves them exactly.

```json
{ "seq": 3, "tab": "following" }
```

Status 200. `tab` is where the reader was when their tab last reported: `following` in agent mode, `stepped_out` of it (the answer waits for them), or `not_open` when no tab has reported yet.

Refusals, beyond the usual `INVALID_REQUEST`, `TOO_LARGE` and `NOT_FOUND`:

- `LIVE_ENDED`: the session is unknown or has lapsed. Open another.
- `UNKNOWN_PLACE`: an id the canvas does not have, or does not draw where the command puts it. `unknown` lists each one as `{ at, kind, id, detail }`, with `at` a path into the command, and `valid` lists the `components`, `messages` and `diagrams` the canvas does have, so the next attempt copies one instead of guessing again.
- `INVALID_DOCUMENT` and `CANNOT_DRAW`: a fork's drawing, refused as a push would refuse it.

### What the reader is looking at

```
GET /api/canvas/{id}/live/{session}/look
Authorization: Bearer {writeToken}
```

```json
{
  "status": "seen",
  "seenAt": "2026-09-25T16:04:11.000Z",
  "look": {
    "following": true,
    "rev": 3,
    "diagram": { "stage": { "kind": "view", "view": "overview" }, "title": "Overview" },
    "inFrame": [{ "kind": "component", "id": "canvas-api", "label": "Canvas API" }],
    "scope": { "kind": "place", "place": { "kind": "component", "id": "canvas-api", "label": "Canvas API" } },
    "answer": null,
    "fork": null
  }
}
```

Status 200, or `{ "status": "not_open" }` before the tab has reported. `scope` is what the reader selected: a clicked part, a dragged region (`places`), or a box inside a drawing (`label`, `within`, `places`). `fork` names the drawing hung under the canvas and its parts, or is null. The shape is `ViewerLook` in `@coldtea/pr-lens-schema`.

The tab's own two routes, reading the relayed events and reporting its look, take the secret rather than the write token and are the server's business. A push to the canvas tells every paired tab to reload onto the new revision.

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

To run the CLI end to end, a server needs the five routes above, the error envelope, and a store keyed by id holding a token hash, a revision counter and the last document. It does not need the [ownership routes](#ownership): without accounts nobody owns anything, and everything except `canvas list --remote` and `canvas claim` works the same. It can answer `tiles: []`, skip drawing, skip rate limiting and serve nothing at `/c/{id}`. Everything the CLI writes to disk, the document at `.pr-lens/graph.json` and the registry at `.pr-lens/canvas.json`, works the same against it as against prlens.dev.

A walk through the whole lifecycle with curl, against a server at `$API`:

```bash
# mint
curl -s -X POST "$API/api/canvas"
# → 201 { id, writeToken, rev: 0, viewUrl, editUrl, embedUrl }

# first push
curl -s -X PUT "$API/api/canvas/$ID" \
  -H "authorization: Bearer $TOKEN" -H "if-match: 0" \
  -H "content-type: application/json" --data-binary @.pr-lens/<drawing>/drawn.graph.json
# → 200 { id, rev: 1, viewUrl, editUrl, embedUrl, tiles }

# stale push
curl -s -X PUT "$API/api/canvas/$ID" \
  -H "authorization: Bearer $TOKEN" -H "if-match: 0" \
  -H "content-type: application/json" --data-binary @.pr-lens/<drawing>/drawn.graph.json
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

How the page hashes and turns over tokens, its rate limit numbers etc. None of this should be needed to answer the CLI. If you find yourself needing one of them to make the CLI work, that is a gap in this page: please open an issue and we'll prioritize
