/**
 * XML escaping for text nodes and attribute values alike. Attributes are
 * always written in double quotes, so the single quote does not need an
 * entity, but `<` and `&` do in both positions.
 */
export const escapeXml = (value: string): string =>
  value
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
