import { Parser } from "expr-eval-fork";

const functions = {
  sin: Math.sin,
  cos: Math.cos,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
};
export const variableName = /^[a-zA-Z][a-zA-Z0-9]*$/;
export function compileExpression(source: string, variables: string[]) {
  if (
    source.length > 500 ||
    !variables.every(
      (n) => variableName.test(n) && !["constructor", "prototype", "__proto__"].includes(n) && !(n in functions),
    )
  )
    throw new Error("Invalid expression variables");
  // Lex before parsing: no strings, property/index access, definitions, assignment or logical operators.
  const tokens = source.match(/(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z][A-Za-z0-9]*|[+\-*/%^(),])/gi) ?? [];
  if (tokens.join("") !== source.replace(/\s/g, "")) throw new Error("Only arithmetic expressions are allowed");
  for (const token of tokens)
    if (/^[A-Za-z]/.test(token) && !Object.hasOwn(functions, token) && !variables.includes(token))
      throw new Error(`Undeclared variable: ${token}`);
  const parser = new Parser({
    allowMemberAccess: false,
    operators: {
      assignment: false,
      fndef: false,
      logical: false,
      comparison: false,
      conditional: false,
      in: false,
      factorial: false,
      concatenate: false,
    },
  });
  parser.unaryOps = Object.assign(Object.create(null), { "+": (n: number) => n, "-": (n: number) => -n });
  for (let i = 0; i < tokens.length; i++)
    if (/^[A-Za-z]/.test(tokens[i] ?? "") && tokens[i + 1] === "(" && !Object.hasOwn(functions, tokens[i] ?? ""))
      throw new Error("Only whitelisted function calls are allowed");
  parser.functions = Object.assign(Object.create(null), functions);
  parser.consts = Object.create(null);
  const expression = parser.parse(source);
  return (values: Record<string, number>): number => {
    const numeric: Record<string, number> = Object.create(null);
    for (const key of variables) {
      const value = values[key];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected finite ${key}`);
      numeric[key] = value;
    }
    const result: unknown = expression.evaluate(numeric);
    return typeof result === "number" && Number.isFinite(result) ? result : NaN;
  };
}
