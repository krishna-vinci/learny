import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ConfigYaml } from "@studium/shared";

export async function createModelRuntime(): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  return ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
  });
}

export function resolveRoleModel(runtime: ModelRuntime, config: ConfigYaml, role: "tutor"): Model<Api> {
  const configured = config.models.roles[role] ?? config.models.default;
  const slash = configured.indexOf("/");
  if (slash <= 0 || slash === configured.length - 1) {
    throw new Error(`Unknown model: ${configured}`);
  }

  const provider = configured.slice(0, slash);
  const id = configured.slice(slash + 1);
  const model = runtime.getModel(provider, id);
  if (model === undefined) {
    throw new Error(`Unknown model: ${configured}`);
  }
  return model;
}
