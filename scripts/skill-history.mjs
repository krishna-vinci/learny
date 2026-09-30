import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const git = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const skills = path.join(root, "skills");
const manifest = path.join(skills, ".defaults-history.json");
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--from-ref")) {
  throw new Error("Usage: node scripts/skill-history.mjs [--from-ref main]");
}

let history = {};
try {
  history = JSON.parse(await readFile(manifest, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

function append(file, content) {
  if (file === ".defaults-history.json") return;
  const hash = createHash("sha256").update(content).digest("hex");
  const hashes = history[file] ?? [];
  if (!hashes.includes(hash)) hashes.push(hash);
  history[file] = hashes;
}

async function visit(directory = "") {
  for (const entry of await readdir(path.join(skills, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.isFile() && file !== ".defaults-history.json") {
      append(file, await readFile(path.join(skills, file)));
    }
  }
}

if (args[0] === "--from-ref") {
  const ref = args[1];
  const { stdout } = await git("git", ["ls-tree", "-r", "-z", "--name-only", ref, "--", "skills"], { cwd: root });
  for (const file of stdout.split("\0").filter(Boolean)) {
    if (file === "skills/.defaults-history.json") continue;
    const { stdout: content } = await git("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "buffer" });
    append(file.slice("skills/".length), content);
  }
} else {
  // Run before committing skill edits so both earlier and current defaults remain recognizable.
  await visit();
}

await writeFile(manifest, `${JSON.stringify(Object.fromEntries(Object.entries(history).sort()), null, 2)}\n`);
