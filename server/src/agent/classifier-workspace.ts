import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ConfigYaml } from "@studium/shared";
import { parse as parseYaml } from "yaml";
import type { JobContext } from "../jobs/runner.js";
import { readText } from "../tree/edit.js";
import { Classifier } from "./classifier.js";

export async function workspaceClassifier(
  root: string,
  runtime: ModelRuntime,
  signal?: AbortSignal,
  ctx?: JobContext,
): Promise<Classifier> {
  const config = ConfigYaml.parse(parseYaml(await readText(root, "_global/config.yaml")));
  return new Classifier({
    root,
    runtime,
    config,
    ...(signal ? { signal } : {}),
    ...(ctx ? { onUsage: (u) => ctx.addUsage(u), onProvider: (p) => ctx.useProvider?.(p) } : {}),
  });
}
