import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "vite";

const web = path.resolve(import.meta.dirname, "..");
const out = path.join(web, "public/visual-runtime");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "studium-runtime-"));
const manifest = {};
try {
  await fs.mkdir(out, { recursive: true });
  for (const name of ["p5", "d3", "three", "studium-runtime"]) {
    const entry =
      name === "studium-runtime" ? path.join(web, "src/visual-runtime/runtime.js") : path.join(temp, `${name}.js`);
    if (name !== "studium-runtime")
      await fs.writeFile(
        entry,
        `import ${name === "p5" ? "library" : "* as library"} from ${JSON.stringify(path.join(web, "node_modules", name))}; window.${name === "three" ? "THREE" : name}=library;`,
      );
    const result =
      name === "p5"
        ? null
        : await build({
            configFile: false,
            root: web,
            publicDir: false,
            logLevel: "error",
            build: {
              write: false,
              minify: true,
              lib: { entry, formats: ["iife"], name: "StudiumLibrary" },
              rolldownOptions: { output: {} },
            },
          });
    const code =
      name === "p5"
        ? await fs.readFile(path.join(web, "node_modules/p5/lib/p5.min.js"), "utf8")
        : (Array.isArray(result) ? result[0] : result).output.find((asset) => asset.type === "chunk").code;
    const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
    const file = `${name}.${hash}.js`;
    await fs.writeFile(path.join(out, file), code);
    manifest[name] = file;
    console.log(`${file}: ${Buffer.byteLength(code)} bytes`);
  }
  await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
