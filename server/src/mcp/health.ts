// TODO(T3 merge): import from @studium/shared
export interface ServiceHealth {
  name: string;
  kind: "mcp" | "http";
  ok: boolean;
  detail: string;
  tools?: number;
}
