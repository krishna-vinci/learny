import { parseInlineChart } from "@studium/shared/media";
import { parse, View } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { compile, type TopLevelSpec } from "vega-lite";

const reject = async (): Promise<never> => {
  throw new Error("External chart resources are forbidden");
};
export function createChartView(
  json: string,
  width: number,
  colors: { foreground: string; background: string; accent: string; border: string },
  container: HTMLElement,
) {
  const spec = parseInlineChart(json);
  const compiled = compile({
    ...spec,
    width: Math.max(100, width - 60),
    config: {
      ...((spec.config as object) ?? {}),
      background: colors.background,
      axis: {
        labelColor: colors.foreground,
        titleColor: colors.foreground,
        gridColor: colors.border,
        domainColor: colors.border,
        tickColor: colors.border,
      },
      legend: { labelColor: colors.foreground, titleColor: colors.foreground },
      title: { color: colors.foreground },
      mark: { color: colors.accent },
      view: { stroke: colors.border },
      range: { category: [colors.accent, colors.foreground, colors.border] },
    },
  } as TopLevelSpec).spec;
  return new View(parse(compiled, undefined, { ast: true }), {
    expr: expressionInterpreter,
    renderer: "svg",
    loader: { load: reject, sanitize: reject, http: reject, file: reject },
    container,
    hover: true,
  });
}
