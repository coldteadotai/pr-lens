import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExamples, buildJsonSchemas } from "./artifacts.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const writeAll = async (dir: string, files: Map<string, string>): Promise<void> => {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [file, contents] of files) {
    await writeFile(join(dir, file), contents, "utf8");
  }
};

const jsonSchemaDir = join(packageRoot, "json-schema");
const examplesDir = join(packageRoot, "examples");

await writeAll(jsonSchemaDir, buildJsonSchemas());
await writeAll(examplesDir, buildExamples());

const emitted = [
  ...(await readdir(jsonSchemaDir)).map((file) => `json-schema/${file}`),
  ...(await readdir(examplesDir)).map((file) => `examples/${file}`),
];
console.log(emitted.map((file) => `  ${file}`).join("\n"));
