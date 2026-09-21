import { z } from "zod";
import { assertNever } from "./utils.js";

/**
 * The forges PR Lens can address. The set is closed on purpose: every
 * consumer switches over it exhaustively, so adding a provider fails to
 * compile at each seam that has not decided what to do with it, instead of
 * silently rendering a GitHub-shaped comment somewhere it cannot be read.
 */
export const Provider = z
  .enum(["github", "gitlab", "bitbucket"])
  .describe("Forge hosting the repository and its pull requests.");
export type Provider = z.infer<typeof Provider>;

export const PROVIDERS = Provider.options;

/**
 * One repository, addressed the same way on every forge. `repoId` is a
 * string because the forges disagree on what an id is — GitHub and GitLab
 * use numbers, Bitbucket a `{uuid}` in curly braces — and nothing PR Lens
 * does with an id is arithmetic. `owner` may contain `/`: a GitLab project
 * can live under nested subgroups, and collapsing that would point at the
 * wrong repository.
 */
export const RepoRef = z
  .strictObject({
    provider: Provider,
    host: z
      .string()
      .min(1)
      .max(255)
      .describe("Hostname the repository lives on, e.g. gitlab.com or a self-managed instance."),
    owner: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/]+(?:\/[^/]+)*$/, "must be slash-separated non-empty segments")
      .describe("Namespace owning the repository. GitLab subgroups keep their slashes."),
    repo: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/]+$/, "must be a single path segment")
      .describe("Repository name, without the owner."),
    repoId: z
      .string()
      .min(1)
      .max(64)
      .describe("The forge's own id for the repository, as a string."),
  })
  .describe("A repository on a specific forge.");
export type RepoRef = z.infer<typeof RepoRef>;

/** Which markdown rules a comment body is read under, and so which escaping applies. */
export type MarkdownDialect = "gfm" | "glfm" | "python-markdown";

/**
 * What a provider's comment renderer can be trusted with. Composition code
 * branches on these fields, never on the provider name, so the reason for
 * every degradation is recorded here once instead of being re-derived at
 * each call site.
 */
export type CommentSurface = {
  /** Raw HTML survives sanitization. Bitbucket renders none. */
  html: boolean;
  /**
   * Which render a comment should carry.
   *
   * `pair` ships both halves in a `<picture>` and lets the client choose.
   * `neutral` ships the one self-contained render, for a surface that shows a
   * single image — GitLab strips `picture`/`source`, and Bitbucket renders no
   * HTML at all. Handing such a surface a half of the pair means one of the
   * two themes reads badly, which for a product whose entire output is the
   * image is not a small thing.
   */
  themeStrategy: "pair" | "neutral";
  /** `<details>` renders as a collapsible section. */
  collapsibles: boolean;
  /** Task-list boxes are toggleable AND the toggle reaches a webhook. */
  checkboxes: boolean;
  dialect: MarkdownDialect;
  /** Longest body the provider accepts; the composer's budget. */
  maxChars: number;
};

/**
 * The verified capability profile per provider. Sources: the evidence
 * ledger in the multi-provider spec (docs-verified twice). GitLab's
 * `checkboxes` stays false until the live spike proves the toggle-to-webhook
 * loop end to end; Bitbucket's `maxChars` is a conservative stand-in for a
 * limit Atlassian does not document.
 */
export const surfaceFor = (provider: Provider): CommentSurface => {
  switch (provider) {
    case "github":
      return {
        html: true,
        themeStrategy: "pair",
        collapsibles: true,
        checkboxes: true,
        dialect: "gfm",
        maxChars: 65_536,
      };
    case "gitlab":
      return {
        html: true,
        themeStrategy: "neutral",
        collapsibles: true,
        checkboxes: false,
        dialect: "glfm",
        maxChars: 1_000_000,
      };
    case "bitbucket":
      return {
        html: false,
        themeStrategy: "neutral",
        collapsibles: false,
        checkboxes: false,
        dialect: "python-markdown",
        maxChars: 32_768,
      };
    default:
      return assertNever(provider, "Unhandled provider");
  }
};
