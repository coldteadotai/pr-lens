/**
 * Code points XML 1.0 has no spelling for: most control characters, the
 * surrogate halves, and the two non-characters at the end of the basic plane.
 * They are dropped rather than escaped, because there is no escape — a
 * document containing one is not merely ugly, it does not parse.
 *
 * Labels reach here from an extraction model by way of the schema, which
 * constrains their length but not their alphabet, so this is the last place
 * such a character can be stopped. Matching by code point rather than by code
 * unit is what keeps a well-formed astral character — which is a pair of
 * surrogates in memory — from being mistaken for two lone halves.
 */
const FORBIDDEN_IN_XML =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

/**
 * XML escaping for text nodes and attribute values alike. Attributes are
 * always written in double quotes, so the single quote does not need an
 * entity, but `<` and `&` do in both positions.
 */
export const escapeXml = (value: string): string =>
  value
    .replace(FORBIDDEN_IN_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export type Attributes = Readonly<Record<string, string | number | undefined>>;

const serialiseAttributes = (attributes: Attributes): string =>
  Object.entries(attributes)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`)
    .join("");

export const tag = (name: string, attributes: Attributes): string =>
  `<${name}${serialiseAttributes(attributes)}/>`;

export const wrap = (name: string, attributes: Attributes, children: string): string =>
  `<${name}${serialiseAttributes(attributes)}>${children}</${name}>`;

export const textNode = (
  attributes: Attributes,
  content: string,
): string => wrap("text", attributes, escapeXml(content));

/** Joins emitted fragments with newlines, dropping the ones that produced nothing. */
export const lines = (fragments: readonly string[]): string =>
  fragments.filter((fragment) => fragment.length > 0).join("\n");
