import { access, cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repoRoot, "examples/sample-set");
const dest = resolve(repoRoot, "data/study");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if (await exists(dest)) {
  console.log(`study tree already exists at ${dest} — leaving it untouched`);
} else {
  await mkdir(dirname(dest), { recursive: true });
  await cp(source, dest, { recursive: true });
  console.log(`copied sample set to ${dest}`);
}
