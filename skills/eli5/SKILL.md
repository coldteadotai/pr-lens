---
name: eli5
description: "WHAT: Explains a codebase, a folder, a feature, a command or a pull request to someone who knows nothing about it, as a PR Lens canvas whose walkthrough builds the picture one part at a time. WHEN: /eli5 <thing>, or asked to explain code simply, for a beginner, a new hire, a non-engineer, or 'like I'm five'. KEYWORDS: eli5, explain like I'm five, explain simply, beginner, onboarding, walkthrough, diagram, PR Lens"
---

# eli5

Explain like I'm someone who knows nothing about this code: one sentence, then one part at a time, until the whole picture is on screen and the reader already knows every part of it.

A reader who knows nothing cannot take in a diagram. They can take in two boxes and an arrow. So the canvas starts with two boxes and grows. The whole picture is the last thing they see, not the first, and by then it holds nothing new.

You write one graph document. Its views are the growing pictures, its walkthrough plays them in order, and PR Lens draws them. The reader opens a link and presses play. There is no page, no list, no paragraph.

## What you need

The PR Lens skill, installed beside this one. If `pr-lens/SKILL.md` is not there: `npx skills add coldteadotai/pr-lens --skill pr-lens`. Read its SKILL.md and `references/graph-document.md` before your first document. Its rules hold here except where this page marks an **Override**.

## Operating manual

1. **Write the answer first.** Read the code until you can say what it does for a person, in under 48 characters, because the sentence is also a walkthrough heading and a heading stops at 48. Count them.
   - For a feature or a command: "When you ___, this code ___." Example: "When you hit send, it emails everyone."
   - For a whole codebase: what the product is for. Example: "BestRegards sends newsletters for you." The sentence is about the product, not one path through it.
   **Override, summary.** The sentence is also the document `summary`. The reference wants a paragraph about a change; eli5 wants this sentence.

2. **Cut to the path.** For a feature, trace the one path input takes to output. For a whole codebase, first list the 3 to 5 things a person does with the product, then trace the path of the main one: the thing the product is named after or sold on, or the one with the most code on it. The parts on that path are the diagram: 4 to 10 nodes, 2 to 5 lanes. Helpers, config, types and tests stay out. When two entry points converge on the same code, draw the point where they meet and name both in its body; do not drop one.

3. **Write `.pr-lens/graph.json`.** Follow `references/graph-document.md`, plus these rules:
   - **Override, provenance.** The schema requires it. Take the remote from `git remote get-url origin`. `https://github.com/acme/mail.git` and `git@github.com:acme/mail.git` both become `{ "owner": "acme", "name": "mail", "host": "github.com" }`. Put the current `HEAD` sha in both `base.sha` and `head.sha`. The parser rule about "a patch whose two commits are the same" is about `patch`, not `provenance`, so this validates.
   - Lanes are places the reader can picture, left to right in the order the path runs: "your browser", "the website", "the mail company", "your reader". Not the folder tree. Set `order`. A database or queue the path touches more than once is not a place on the path; put it in the lane of the code that owns it.
   - The first node is the reader, or the thing the reader touches: "You write the email". The reader must find themself on the first picture. Use `kind: "external"` for a person; the schema has no person kind.
   - Node `label` is what the part does, in three words or fewer. The real name goes in `subtitle`, the file in `files`.
   - **Override, deltas.** Every `delta` is `unchanged` unless the thing is a pull request.
   - No `stats`. There is no diff to count.
   - Exactly one edge with `emphasis: "hero"`: the hand-off the answer sentence is about, the one edge that, if removed, would make the sentence false. Set `animated: true` on every edge along the path.
   - One flow when the path is a sequence, which it nearly always is. Flow step labels are what is passed, in plain words.

4. **Write the growing views.** **Override, views.** This replaces the C4 decision tree in the pr-lens skill. eli5 views are the same picture growing, not a drill-down.
   - View 1 holds 2 nodes: the reader and the first part they touch, with the edge between them. Scope: `{ "kind": "selection", "nodes": [...], "edges": [...] }`.
   - Each next view holds everything the last one held plus 1 to 3 new nodes along the path, and the edges among them. Never more than 3 new parts in one view. The one exception is the codebase view below.
   - The last architecture view is the whole thing: `"scope": { "kind": "all" }`. It is the only one with `"defaultOpen": true`. The growing view before it must still be missing at least 1 node, so the two are not the same picture; the pr-lens rule against two views with the same nodes holds. **Override, views.** Growing views share most of their nodes on purpose; only the last two must differ.
   - For a whole codebase, view 2 is the reader plus the 3 to 5 things the product does, as nodes in the product's lane. This view may add up to 5 parts; they are a list, not a path. Views 3 onward grow the main path. The other things stay on the picture so the reader knows they exist.
   - One data-flow root scoped to the flow: `"scope": { "kind": "selection", "flows": ["<flow id>"] }`. It is needed or the flow is never drawn.
   - All views are roots. Do not nest.
   - Name views by what is on them: `you-and-the-editor`, `plus-the-queue`, `the-whole-thing`.

5. **Write the walkthrough. One step per growing view, then the flow, then the whole.** Count first: growing views plus 1 to 2 flow steps plus 1 closing step, at most 9. With 10 nodes that means 3 to 5 growing views, so grow by 2 or 3 at a time, not 1.
   - **Override, headings.** A heading says what happens, not what changed: "The website packs your email". No step numbers; the canvas counts.
   - `body`: one line, up to 140 characters, that a smart twelve-year-old reads once. What happens, then what it means. Numbers as digits.
   - Step 1 stages view 1, focus left out, heading is the answer sentence, body introduces the two parts: "This is you, and the screen you write in. Everything starts here."
   - Each next step stages the next growing view and focuses only the new nodes with `{ "kind": "selection", "nodes": [...] }`. The body says what the new part does, and only that.
   - After the last growing view, stage the flow with `{ "kind": "flow", "flow": "<id>" }` for 1 to 2 steps that follow the sequence, focusing `messages`. Where things go wrong is one of these steps, in matter-of-fact words; focus the message that comes right before the failure, since a happy-path flow has no failure message of its own. Do not invent a message for it.
   - The whole-thing view carries two steps: one that introduces the nodes it adds, with focus, and the closing step. The closing step stages the whole-thing view, focus left out, heading is the answer sentence again, body adds one number the reader now understands: "1 email in, 2,000 emails out, 1 request to Postmark."

6. **Validate, render, push.**

   ```bash
   npx @coldtea/pr-lens-cli@latest validate .pr-lens/graph.json
   npx @coldtea/pr-lens-cli@latest render .pr-lens/graph.json --theme light
   npx @coldtea/pr-lens-cli@latest canvas push
   ```

   Fix every failure and validate again. Do not delete the element a failure names; fix the reference. `canvas push` prints the view link, `https://prlens.dev/c/{id}`, and an embed link. The view link is the deliverable.

7. **Open it and stop.** If this harness can open a browser, open the view link. Reply with the answer sentence and the link, on two lines. Nothing else: no step list, no file list, no summary of what you did. If the person who asked wants a report or a comparison, that is a second request, answered after this one.

## Words

Plain words only. Not: leverages, orchestrates, pipeline, abstraction, handler, wrapper, layer, utility, invoke, instantiate. Say what it does. Real names appear once each, in subtitles, so a curious reader can find the code.

An analogy is allowed when the reader is not an engineer and one everyday thing matches the path beat for beat. Use it in bodies, never in labels, and drop it in the last step so the reader leaves with the real thing.

## What this is not

Not a review, not a file list, not a tutorial, not an architecture document. There is no field for a bug, a risk or an opinion, and there is no paragraph anywhere. And it is never one big diagram shown all at once.
