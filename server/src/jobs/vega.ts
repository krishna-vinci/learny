import { parseInlineChart } from "@studium/shared/media";
import { parse, View } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { compile, type TopLevelSpec } from "vega-lite";

const reject = async (): Promise<never> => {
  throw new Error("External chart resources are forbidden");
};
export async function chartToSvg(json: string): Promise<string> {
  const spec = parseInlineChart(json);
  const compiled = compile({
    ...spec,
    width: 480,
    config: {
      ...((spec.config as object) ?? {}),
      background: "#ffffff",
      axis: { labelColor: "#292524", titleColor: "#292524" },
      legend: { labelColor: "#292524", titleColor: "#292524" },
      title: { color: "#292524" },
      mark: { color: "#2b4a6f" },
    },
  } as TopLevelSpec).spec;
  const view = new View(parse(compiled, undefined, { ast: true }), {
    expr: expressionInterpreter,
    renderer: "none",
    loader: { load: reject, sanitize: reject, http: reject, file: reject },
  });
  try {
    return await view.toSVG();
  } finally {
    view.finalize();
  }
}
