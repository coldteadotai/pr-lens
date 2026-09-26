import {
  assertNever,
  LiveCommand,
  safeParseGraphDoc,
  type GraphDoc,
  type LiveRef,
  type StepFocus,
  type StepStage,
  type View,
} from "@coldtea/pr-lens-schema";

import { readJsonFile } from "../io.js";
import { readGraphDoc } from "../document.js";
import type { Terminal } from "../terminal.js";
import { askToOpen } from "../commands/auth.js";
import { PrLensCliError, usageError } from "../errors.js";
import { parseOptions, readBoolean, readList, readString } from "../args.js";
import { openLive, readLook, sendLive, unknownPlaces, type TabState } from "./api.js";
import { readApi, settlePendingRotation, writeCredential } from "./write.js";
import {
  ensureRegistryHome,
  findBySource,
  readRegistry,
  REGISTRY_PATH,
  selectCanvas,
  updateRegistry,
  type CanvasRegistry,
  type Registered,
} from "./registry.js";

/**
 * Live mode: the reader's own coding agent answers on a canvas open beside
 * it. `open` pairs one browser tab; the other four talk to that tab through
 * the app, which checks every id against the canvas before relaying anything.
 */

type Env = Record<string, string | undefined>;

type Paired = { target: Registered; api: string; token: string; session: string };

/**
 * The canvas a live command means: the one named, else the only one in the
 * registry, else the only one with a tab paired. The last is what makes a
 * checkout holding several canvases still need no flag while one is open.
 */
type CanvasChoice = { kind: "drawing"; path: string } | { kind: "canvas"; ref: string } | { kind: "unnamed" };

const canvasOf = (values: { canvas?: unknown; drawing?: unknown }): CanvasChoice => {
  const path = readString(values.drawing, "drawing");
  const ref = readString(values.canvas, "canvas");
  if (path !== undefined && ref !== undefined) throw usageError("pass --drawing or --canvas, not both");
  if (path !== undefined) return { kind: "drawing", path };
  return ref === undefined ? { kind: "unnamed" } : { kind: "canvas", ref };
};

const liveCanvas = (registry: CanvasRegistry, choice: CanvasChoice): Registered => {
  switch (choice.kind) {
    case "drawing": {
      const found = findBySource(registry, choice.path);
      if (found === undefined) throw notPushed(choice.path);
      return found;
    }
    case "canvas":
      return selectCanvas(registry, choice.ref);
    case "unnamed":
      break;
    default:
      return assertNever(choice, "Unhandled canvas choice");
  }

  const paired = Object.entries(registry.canvases).filter(([, entry]) => entry.live !== undefined);
  const [only, ...more] = paired;
  if (only !== undefined && more.length === 0) return { id: only[0], entry: only[1] };

  return selectCanvas(registry, undefined);
};

const notPushed = (drawing: string): PrLensCliError =>
  new PrLensCliError("CANVAS_UNREGISTERED", `${drawing} has not been pushed from this checkout`, "pr-lens canvas push puts it on a canvas first");

const paired = async (choice: CanvasChoice, apiFlag: unknown, terminal: Terminal, env: Env): Promise<Paired> => {
  const api = readApi(apiFlag, env);
  const selected = liveCanvas(await readRegistry(), choice);
  const target = await settlePendingRotation(api, selected, terminal, env);

  const session = target.entry.live?.session;
  if (session === undefined)
    throw new PrLensCliError(
      "LIVE_UNOPENED",
      `no tab is paired with ${target.id}`,
      "pr-lens canvas open <drawing> opens one that follows your agent",
    );

  return { target, api, token: await writeCredential(target, env, api), session };
};

/** An ended session is forgotten here too, so the next command says so without asking the app. */
const forgetEnded = async (error: unknown, { target, session }: Paired, terminal: Terminal): Promise<never> => {
  if (error instanceof PrLensCliError && error.code === "LIVE_ENDED")
    await updateRegistry((current) => {
      const entry = current.canvases[target.id];
      if (entry?.live?.session !== session) return;
      current.canvases[target.id] = { ...entry, live: undefined };
    }, terminal);
  throw error;
};

const send = async (pairing: Paired, command: LiveCommand, terminal: Terminal): Promise<TabState> =>
  sendLive(pairing.api, pairing.target.id, pairing.token, pairing.session, command).then(
    ({ tab }) => tab,
    (error: unknown) => forgetEnded(error, pairing, terminal),
  );

/**
 * What was drawn, when this checkout still has it. The app checks every id
 * again, so a document that has moved or gone only means the check happens
 * there instead of here.
 */
const drawnDocument = async ({ entry }: Registered): Promise<GraphDoc | undefined> => {
  if (entry.source === undefined) return undefined;
  return readGraphDoc(entry.source).catch((error: unknown) => {
    if (error instanceof PrLensCliError) return undefined;
    throw error;
  });
};

type Afterword = "answer" | "show" | "fork";

const tellTab = (tab: TabState, after: Afterword, terminal: Terminal): void => {
  switch (tab) {
    case "following":
      terminal.out("  the reader's tab is following along");
      return;
    case "stepped_out":
      switch (after) {
        case "answer":
          terminal.out("  the reader stepped out of agent mode, so the answer is waiting in their Questions list");
          return;
        case "show":
          terminal.out("  the reader stepped out of agent mode, so their canvas did not move");
          return;
        case "fork":
          terminal.out("  the reader stepped out of agent mode; the drawing is there when they come back");
          return;
        default:
          return assertNever(after, "Unhandled live command");
      }
    case "not_open":
      terminal.out("  no tab has opened the link yet: pr-lens canvas open opens one");
      return;
    default:
      return assertNever(tab, "Unhandled tab state");
  }
};

const flatViews = (views: readonly View[]): View[] => views.flatMap((view) => [view, ...flatViews(view.children)]);

/** Every id the canvas answers to, spelled the way a live command spells it. */
type Places = {
  components: Set<string>;
  edges: Set<string>;
  lanes: Set<string>;
  views: Set<string>;
  flows: Map<string, Set<string>>;
};

const placesOf = (doc: GraphDoc): Places => ({
  components: new Set(doc.nodes.map((node) => node.id)),
  edges: new Set(doc.edges.map((edge) => edge.id)),
  lanes: new Set(doc.lanes.map((lane) => lane.id)),
  views: new Set(flatViews(doc.views).map((view) => view.id)),
  flows: new Map(doc.flows.map((flow) => [flow.id, new Set(flow.messages.map((message) => message.id))])),
});

const messageKeys = (places: Places): string[] =>
  [...places.flows].flatMap(([flow, messages]) => [...messages].map((message) => `${flow}/${message}`));

const validOf = (places: Places) => ({
  components: [...places.components],
  messages: messageKeys(places),
  diagrams: [...places.views, ...places.flows.keys()],
});

/** `flow/message`, or a message's own id when some flow has it. */
const hasMessage = (places: Places, id: string): boolean => {
  const slash = id.indexOf("/");
  const flow = slash === -1 ? undefined : places.flows.get(id.slice(0, slash));
  if (flow?.has(id.slice(slash + 1)) === true) return true;
  return [...places.flows.values()].some((messages) => messages.has(id));
};

const hasDiagram = (places: Places, id: string): boolean => {
  const bare = id.replace(/^(view|flow):/, "");
  return places.views.has(bare) || places.flows.has(bare);
};

const stageProblems = (places: Places, stage: StepStage | undefined, at: string): string[] => {
  if (stage === undefined) return [];
  switch (stage.kind) {
    case "view":
      return places.views.has(stage.view) ? [] : [`${at}.view: no view "${stage.view}"`];
    case "flow":
      return places.flows.has(stage.flow) ? [] : [`${at}.flow: no flow "${stage.flow}"`];
    default:
      return assertNever(stage, "Unhandled step stage");
  }
};

const focusProblems = (places: Places, focus: StepFocus, at: string): string[] => {
  switch (focus.kind) {
    case "all":
      return [];
    case "selection": {
      const missing = (field: string, ids: readonly string[], known: (id: string) => boolean, noun: string) =>
        ids.flatMap((id, index) => (known(id) ? [] : [`${at}.${field}[${index}]: no ${noun} "${id}"`]));
      return [
        ...missing("nodes", focus.nodes, (id) => places.components.has(id), "component"),
        ...missing("edges", focus.edges, (id) => places.edges.has(id), "edge"),
        ...missing("lanes", focus.lanes, (id) => places.lanes.has(id), "lane"),
        ...missing("messages", focus.messages, (id) => hasMessage(places, id), "message"),
      ];
    }
    default:
      return assertNever(focus, "Unhandled step focus");
  }
};

const refProblem = (places: Places, ref: LiveRef, at: string): string[] => {
  switch (ref.kind) {
    case "component":
      return places.components.has(ref.id) ? [] : [`${at}: no component "${ref.id}"`];
    case "message":
      return hasMessage(places, ref.id) ? [] : [`${at}: no message "${ref.id}"`];
    case "diagram":
      return hasDiagram(places, ref.id) ? [] : [`${at}: no view or flow "${ref.id}"`];
    default:
      return assertNever(ref.kind, "Unhandled live ref");
  }
};

/** The ids a command names that the drawn document does not have, each with where it was named. */
const commandProblems = (places: Places, command: LiveCommand): string[] => {
  switch (command.kind) {
    case "answer":
      return command.steps.flatMap((step, s) => [
        ...stageProblems(places, step.stage, `steps[${s}].stage`),
        ...focusProblems(places, step.focus, `steps[${s}].focus`),
        ...step.paragraphs.flatMap((paragraph, p) =>
          paragraph.parts.flatMap((part, i) =>
            part.ref === undefined ? [] : refProblem(places, part.ref, `steps[${s}].paragraphs[${p}].parts[${i}].ref`),
          ),
        ),
      ]);
    case "show":
      return [
        ...stageProblems(places, command.stage, "stage"),
        ...focusProblems(places, command.focus, "focus"),
        ...(command.open === undefined || hasMessage(places, command.open.message)
          ? []
          : [`open.message: no message "${command.open.message}"`]),
      ];
    case "fork":
      return command.subject.components.flatMap((id, index) =>
        places.components.has(id) ? [] : [`subject.components[${index}]: no component "${id}"`],
      );
    default:
      return assertNever(command, "Unhandled live command");
  }
};

const checkLocally = (doc: GraphDoc | undefined, command: LiveCommand): void => {
  if (doc === undefined) return;
  const places = placesOf(doc);
  const problems = commandProblems(places, command);
  if (problems.length > 0) throw unknownPlaces(problems, validOf(places));
};

const parseCommand = (input: unknown, what: string): LiveCommand => {
  const parsed = LiveCommand.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new PrLensCliError(
    "INVALID_DOCUMENT",
    `${what} is not a live command the canvas takes`,
    parsed.error.issues
      .map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`))
      .join("\n"),
  );
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
};

const readAnswerInput = async (path: string): Promise<unknown> => {
  if (path !== "-") return readJsonFile(path);
  const text = await readStdin();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PrLensCliError(
      "UNREADABLE_FILE",
      "the answer on stdin is not valid JSON",
      error instanceof Error ? error.message : String(error),
    );
  }
};

/** The answer on its own, `{ question, steps }`, or already wrapped as a command. */
const asAnswer = (input: unknown): unknown =>
  typeof input === "object" && input !== null && !("kind" in input) ? { kind: "answer", ...input } : input;

/** Like a bare push: one is the answer, and several are reported by the paths to pass. */
const onlyPushed = (registry: CanvasRegistry): Registered => {
  const all = Object.entries(registry.canvases);
  const [only, ...more] = all;
  if (only === undefined || more.length === 0) return selectCanvas(registry, undefined);

  const sources = all.flatMap(([, entry]) => (entry.source === undefined ? [] : [entry.source]));
  throw usageError(
    `${all.length} canvases in this checkout`,
    sources.length === 0 ? "pass --canvas <id|name>" : `name the drawing to open: ${sources.join(", ")}`,
  );
};

export const openLiveCommand = async (args: readonly string[], terminal: Terminal, env: Env): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    api: { type: "string" },
    "no-browser": { type: "boolean" },
  });
  if (positionals.length > 1) throw usageError(`open takes one drawing, got ${positionals.length}`);

  const api = readApi(values.api, env);
  await ensureRegistryHome(terminal);
  const registry = await readRegistry();
  const [drawing] = positionals;
  const ref = readString(values.canvas, "canvas");
  const selected =
    drawing !== undefined ? findBySource(registry, drawing) : ref !== undefined ? selectCanvas(registry, ref) : onlyPushed(registry);
  if (selected === undefined) throw notPushed(drawing ?? "that drawing");

  const target = await settlePendingRotation(api, selected, terminal, env);
  const opened = await openLive(api, target.id, await writeCredential(target, env, api));

  await updateRegistry((current) => {
    const entry = current.canvases[target.id];
    if (entry === undefined) return;
    current.canvases[target.id] = { ...entry, live: { session: opened.session, expiresAt: opened.expiresAt } };
  }, terminal);

  const opening = readBoolean(values["no-browser"]) ? false : askToOpen(opened.url);
  terminal.out(`✓ ${opening ? "opening" : "open"} ${opened.url}`);
  terminal.out("  a tab opened with this link follows your agent; anyone with the plain view link sees the canvas as it is");
  terminal.out("  the session ends after 2 hours with nothing sent to it");
};

export const answerCommand = async (args: readonly string[], terminal: Terminal, env: Env): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    drawing: { type: "string" },
    api: { type: "string" },
  });
  const [path, ...more] = positionals;
  if (path === undefined || more.length > 0)
    throw usageError("answer takes one file holding the answer, or - to read it from stdin");

  const command = parseCommand(asAnswer(await readAnswerInput(path)), path === "-" ? "the answer on stdin" : path);
  if (command.kind !== "answer") throw usageError(`${path} holds a ${command.kind} command, not an answer`);

  const pairing = await paired(canvasOf(values), values.api, terminal, env);
  checkLocally(await drawnDocument(pairing.target), command);

  const tab = await send(pairing, command, terminal);
  terminal.out(`✓ answered on ${pairing.target.id} in ${command.steps.length} ${command.steps.length === 1 ? "step" : "steps"}`);
  tellTab(tab, "answer", terminal);
};

type Stage = StepStage | undefined;

const stageFor = (doc: GraphDoc | undefined, id: string | undefined): Stage => {
  if (id === undefined) return undefined;
  if (id.startsWith("view:")) return { kind: "view", view: id.slice("view:".length) };
  if (id.startsWith("flow:")) return { kind: "flow", flow: id.slice("flow:".length) };
  if (doc === undefined) return { kind: "view", view: id };

  const places = placesOf(doc);
  if (places.views.has(id)) return { kind: "view", view: id };
  if (places.flows.has(id)) return { kind: "flow", flow: id };
  throw unknownPlaces([`--diagram: no view or flow "${id}"`], validOf(places));
};

/** Sorted into the selection a walkthrough step takes, by what the drawn document calls each id. */
const focusFor = (doc: GraphDoc | undefined, ids: readonly string[]): StepFocus => {
  if (ids.length === 0) return { kind: "all" };
  const places = doc === undefined ? undefined : placesOf(doc);
  const focus = { kind: "selection" as const, lanes: new Array<string>(), nodes: new Array<string>(), edges: new Array<string>(), messages: new Array<string>() };
  const unknown: string[] = [];

  for (const id of ids) {
    if (places === undefined || places.components.has(id)) focus.nodes.push(id);
    else if (places.edges.has(id)) focus.edges.push(id);
    else if (places.lanes.has(id)) focus.lanes.push(id);
    else if (hasMessage(places, id)) focus.messages.push(id);
    else unknown.push(`--focus: no component, message, edge or lane "${id}"`);
  }
  if (places !== undefined && unknown.length > 0) throw unknownPlaces(unknown, validOf(places));
  return focus;
};

export const showCommand = async (args: readonly string[], terminal: Terminal, env: Env): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    drawing: { type: "string" },
    api: { type: "string" },
    focus: { type: "string", multiple: true },
    diagram: { type: "string" },
    open: { type: "string" },
  });
  if (positionals.length > 0) throw usageError(`show takes no positional arguments, got ${positionals.join(" ")}`);

  const pairing = await paired(canvasOf(values), values.api, terminal, env);
  const doc = await drawnDocument(pairing.target);
  const stage = stageFor(doc, readString(values.diagram, "diagram"));
  const open = readString(values.open, "open");
  const command = parseCommand(
    {
      kind: "show",
      ...(stage === undefined ? {} : { stage }),
      focus: focusFor(doc, readList(values.focus, "focus") ?? []),
      ...(open === undefined ? {} : { open: { message: open } }),
    },
    "show",
  );
  checkLocally(doc, command);

  const tab = await send(pairing, command, terminal);
  terminal.out(`✓ moved ${pairing.target.id}${open === undefined ? "" : ` and opened ${open}`}`);
  tellTab(tab, "show", terminal);
};

/** A drawing of what is inside a component comes from the same repository, so it may borrow where the canvas came from. */
const withCanvasOrigin = (sketch: unknown, doc: GraphDoc | undefined): unknown => {
  if (typeof sketch !== "object" || sketch === null || Array.isArray(sketch) || doc === undefined) return sketch;
  return {
    schemaVersion: doc.schemaVersion,
    kind: "graph",
    provenance: doc.provenance,
    ...sketch,
  };
};

export const forkCommand = async (args: readonly string[], terminal: Terminal, env: Env): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    drawing: { type: "string" },
    api: { type: "string" },
    from: { type: "string", multiple: true },
  });
  const [path, ...more] = positionals;
  if (path === undefined || more.length > 0) throw usageError("fork takes one sketch, a graph document of what is inside");
  const from = readList(values.from, "from") ?? [];
  if (from.length === 0) throw usageError("fork needs --from <component>, the part the drawing hangs from");

  const pairing = await paired(canvasOf(values), values.api, terminal, env);
  const doc = await drawnDocument(pairing.target);

  const sketch = safeParseGraphDoc(withCanvasOrigin(await readJsonFile(path), doc));
  if (!sketch.ok)
    throw new PrLensCliError(
      "INVALID_DOCUMENT",
      `${path} is not a valid graph document [${sketch.error.code}]`,
      sketch.error.issues.map((issue) => (issue.path === "" ? issue.message : `${issue.path}: ${issue.message}`)).join("\n"),
    );

  const command = parseCommand({ kind: "fork", subject: { components: from }, sketch: sketch.value }, path);
  checkLocally(doc, command);

  const tab = await send(pairing, command, terminal);
  terminal.out(`✓ drew inside ${from.join(", ")} on ${pairing.target.id}`);
  tellTab(tab, "fork", terminal);
};

export const lookCommand = async (args: readonly string[], terminal: Terminal, env: Env): Promise<void> => {
  const { values, positionals } = parseOptions(args, {
    canvas: { type: "string" },
    drawing: { type: "string" },
    api: { type: "string" },
  });
  if (positionals.length > 0) throw usageError(`look takes no positional arguments, got ${positionals.join(" ")}`);

  const pairing = await paired(canvasOf(values), values.api, terminal, env);
  const read = await readLook(pairing.api, pairing.target.id, pairing.token, pairing.session).catch((error: unknown) =>
    forgetEnded(error, pairing, terminal),
  );

  switch (read.status) {
    case "not_open":
      terminal.out(`no tab has reported yet: open the link pr-lens canvas open printed, or run it again to get a new one`);
      return;
    case "seen":
      terminal.out(JSON.stringify(read.look, null, 2));
      return;
    default:
      return assertNever(read, "Unhandled look");
  }
};

export const LIVE_USAGE = `  pr-lens canvas open <drawing>        open a tab that follows your coding agent: name the
                                       .pr-lens/<drawing>/drawn.graph.json you pushed; its
                                       session is kept in ${REGISTRY_PATH}
    --no-browser                       print the link instead of opening it

  pr-lens canvas answer <file|->       answer on the open canvas: { question, steps } as JSON
  pr-lens canvas show                  move the open canvas
    --focus <id>                       a component, message (flow/message), edge or lane; repeat for more
    --diagram <view|flow>              the diagram to show (default the opening one)
    --open <flow/message>              open that message's payload rail
  pr-lens canvas fork <sketch.json>    draw what is inside a component, under the canvas
    --from <component>                 the part it hangs from; repeat for more
  pr-lens canvas look                  what the reader is looking at and has selected, as JSON`;

