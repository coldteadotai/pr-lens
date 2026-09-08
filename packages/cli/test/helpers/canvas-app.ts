import { beforeEach } from "vitest";

import { assertNever } from "@coldtea/pr-lens-schema";

import { API, setupCanvasTest } from "./canvas.js";

export const FIRST = "1".padStart(22, "0");
export const TOKEN1 = "token-1-a".padEnd(22, "a");

type Stored = { token: string; rev: number; document: unknown };
type Seen = { method: string; path: string; headers: Headers; body: unknown };

type Route =
  | { type: "mint" }
  | { type: "read"; id: string; canvas: Stored }
  | { type: "push"; id: string; canvas: Stored }
  | { type: "rotate"; id: string; canvas: Stored }
  | { type: "unknown" };

const resolveRoute = (
  method: string,
  path: string,
  canvases: ReadonlyMap<string, Stored>,
): Route => {
  if (method === "POST" && path === "/api/canvas") return { type: "mint" };

  const [, , , id, action] = path.split("/");
  const canvas = id === undefined ? undefined : canvases.get(id);
  if (id === undefined || canvas === undefined) return { type: "unknown" };

  switch (method) {
    case "GET":
      return action === undefined
        ? { type: "read", id, canvas }
        : { type: "unknown" };
    case "PUT":
      return action === undefined
        ? { type: "push", id, canvas }
        : { type: "unknown" };
    case "POST":
      return action === "rotate"
        ? { type: "rotate", id, canvas }
        : { type: "unknown" };
    default:
      return { type: "unknown" };
  }
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const refuse = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) => json(status, { error: { code, message, ...extra } });

const links = (id: string, token?: string) => ({
  viewUrl: `${API}/c/${id}`,
  embedUrl: `${API}/c/${id}.svg`,
  ...(token === undefined ? {} : { editUrl: `${API}/c/${id}#w=${token}` }),
});

const tile = (id: string) => ({
  id,
  title: id,
  lens: "architecture",
  crumbs: ["overview"],
  hero: id === "view:overview",
  width: 800,
  height: 600,
  renders: { light: `${id}-light.svg`, dark: `${id}-dark.svg` },
  images: {
    light: `${API}/i/${id}-light.svg`,
    dark: `${API}/i/${id}-dark.svg`,
  },
});

const TILES = [tile("view:overview"), tile("view:new-batch-path")];

const bearer = (headers: Headers): string | undefined =>
  headers.get("authorization")?.replace(/^Bearer /, "");

export const setupCanvasAppTest = () => {
  const context = setupCanvasTest();
  const app = {
    canvases: new Map<string, Stored>(),
    seen: new Array<Seen>(),
    minted: 0,
    loseNextAnswer: false,
  };

  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    app.seen.push({ method, path: url.pathname, headers, body });

    const route = resolveRoute(method, url.pathname, app.canvases);
    switch (route.type) {
      case "mint": {
        app.minted += 1;
        const id = String(app.minted).padStart(22, "0");
        const token = `token-${app.minted}-a`.padEnd(22, "a");
        app.canvases.set(id, { token, rev: 0, document: undefined });
        return json(201, {
          id,
          writeToken: token,
          rev: 0,
          ...links(id, token),
        });
      }
      case "read": {
        const { id, canvas } = route;
        if (canvas.document === undefined)
          return refuse(404, "NOT_FOUND", "There is no canvas here");
        return json(200, {
          id,
          rev: canvas.rev,
          ...links(id),
          document: canvas.document,
          tiles: TILES,
        });
      }
      case "rotate": {
        const { id, canvas } = route;
        const next =
          typeof body === "object" && body !== null && "writeToken" in body
            ? body.writeToken
            : undefined;
        if (typeof next !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(next))
          return refuse(
            400,
            "INVALID_REQUEST",
            "The body must carry the new writeToken",
          );
        if (bearer(headers) === canvas.token) canvas.token = next;
        else if (next !== canvas.token)
          return refuse(404, "NOT_FOUND", "There is no canvas here");
        if (app.loseNextAnswer) {
          app.loseNextAnswer = false;
          throw new TypeError("fetch failed");
        }
        return json(200, { id, editUrl: `${API}/c/${id}#w=${canvas.token}` });
      }
      case "push": {
        const { id, canvas } = route;
        if (bearer(headers) !== canvas.token)
          return refuse(404, "NOT_FOUND", "There is no canvas here");

        if (headers.get("if-match") !== String(canvas.rev))
          return refuse(
            409,
            "REVISION_MOVED",
            "The canvas has moved on since you pulled it",
            { rev: canvas.rev },
          );
        if (typeof body !== "object" || body === null || !("lanes" in body))
          return refuse(
            422,
            "INVALID_DOCUMENT",
            "The document does not match the PR Lens contract",
            {
              issues: [
                {
                  code: "INVALID_DOCUMENT",
                  path: "lanes",
                  message: "expected array, received undefined",
                },
              ],
            },
          );
        if ("title" in body && body.title === "Nothing to draw")
          return refuse(
            422,
            "CANNOT_DRAW",
            "The document has nothing the canvas can draw",
          );
        canvas.rev += 1;
        canvas.document = body;
        return json(200, {
          id,
          rev: canvas.rev,
          ...links(id, canvas.token),
          tiles: TILES,
        });
      }
      case "unknown":
        return refuse(404, "NOT_FOUND", "There is no canvas here");
      default:
        return assertNever(route);
    }
  };

  beforeEach(() => {
    app.canvases.clear();
    app.seen = [];
    app.minted = 0;
    app.loseNextAnswer = false;
    context.fetchMock.mockImplementation(fakeFetch);
  });

  return { ...context, app, fakeFetch };
};
