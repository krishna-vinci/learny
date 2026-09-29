import { promises as fs } from "node:fs";
import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { defineTool, type ModelRuntime, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type ChatStreamEvent, ConfigYaml, PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { Type } from "typebox";
import { parse as parseYaml } from "yaml";
import { resolveRoleModel } from "../agent/models.js";
import { readText } from "../tree/edit.js";
import { resolveInRoot } from "../tree/paths.js";
import { type MakeCardsInput, parseMakeCardsInput } from "./cards-job.js";
import { classifyBilling } from "./runner.js";

const PROPOSAL_TTL_MS = 30 * 60 * 1000;
const CHARS_PER_TOKEN = 4;

export interface DraftChapterInput {
  set: string;
  title: string;
  brief?: string;
  sources?: string[];
}

export type JobProposalEvent = Extract<ChatStreamEvent, { kind: "job_proposal" }>;

type ProposalInput = DraftChapterInput | MakeCardsInput;

interface StoredProposal {
  input: ProposalInput;
  expiresAt: number;
}

function cloneInput(input: ProposalInput): ProposalInput {
  if ("note" in input) return { ...input };
  return {
    ...input,
    ...(input.sources === undefined ? {} : { sources: [...input.sources] }),
  };
}

export class ProposalStore {
  readonly #items = new Map<string, StoredProposal>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  create(input: DraftChapterInput, estimate: JobProposalEvent["estimate"]): JobProposalEvent {
    return this.#create("draft-chapter", input.title, input, estimate);
  }

  createCards(input: MakeCardsInput, estimate: JobProposalEvent["estimate"]): JobProposalEvent {
    return this.#create("make-cards", `Cards for ${input.note}`, input, estimate);
  }

  #create(
    jobKind: "draft-chapter" | "make-cards",
    title: string,
    input: ProposalInput,
    estimate: JobProposalEvent["estimate"],
  ): JobProposalEvent {
    this.#prune();
    const proposalId = crypto.randomUUID();
    this.#items.set(proposalId, {
      input: cloneInput(input),
      expiresAt: this.#now() + PROPOSAL_TTL_MS,
    });
    return { kind: "job_proposal", proposalId, jobKind, title, estimate };
  }

  take(proposalId: string): ProposalInput | null {
    this.#prune();
    const stored = this.#items.get(proposalId);
    if (stored === undefined) return null;
    this.#items.delete(proposalId);
    return cloneInput(stored.input);
  }

  #prune(): void {
    const now = this.#now();
    for (const [id, proposal] of this.#items) {
      if (proposal.expiresAt <= now) this.#items.delete(id);
    }
  }
}

export const jobProposals = new ProposalStore();

async function optionalText(root: string, rel: string): Promise<string> {
  try {
    return await readText(root, rel);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return "";
    throw error;
  }
}

async function sourceText(root: string, id: string): Promise<string> {
  const directory = resolveInRoot(root, `library/${id}`);
  const texts = [await readText(root, `library/${id}/source.md`), await optionalText(root, `library/${id}/parsed.md`)];
  try {
    const entries = await fs.readdir(path.join(directory, "parsed"), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        texts.push(await optionalText(root, `library/${id}/parsed/${entry.name}`));
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return texts.join("\n");
}

function configuredSources(plan: string): string[] {
  const parsed = PlanFrontmatter.safeParse(parseFrontmatter(plan).frontmatter);
  if (!parsed.success) throw new Error("PLAN.md frontmatter is invalid");
  return parsed.data.sources ?? [];
}

function costFor(model: Model<Api>, inputTokens: number, outputTokens: number): number {
  const tier = [...(model.cost.tiers ?? [])]
    .filter((candidate) => inputTokens > candidate.inputTokensAbove)
    .sort((a, b) => b.inputTokensAbove - a.inputTokensAbove)[0];
  const rates = tier ?? model.cost;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

/** Provider id (model-string prefix) used for billing classification. */
function providerOf(modelString: string): string {
  const slash = modelString.indexOf("/");
  return slash > 0 ? modelString.slice(0, slash) : modelString;
}

export async function estimateDraftJob(
  root: string,
  input: DraftChapterInput,
  runtime: ModelRuntime,
): Promise<JobProposalEvent["estimate"]> {
  const [plan, curriculum, configText] = await Promise.all([
    readText(root, `${input.set}/PLAN.md`),
    optionalText(root, `${input.set}/curriculum.md`),
    readText(root, "_global/config.yaml"),
  ]);
  const sources = input.sources ?? configuredSources(plan);
  const sourceTexts = await Promise.all(sources.map((id) => sourceText(root, id)));
  const chars =
    plan.length + curriculum.length + input.title.length + (input.brief?.length ?? 0) + sourceTexts.join("").length;
  const baseInput = Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
  const draftOutput = 2_000;
  const checkOutput = 1_000;
  // Budget for the normal draft/check pair and the single allowed revision/check pair.
  const tokens = baseInput * 4 + draftOutput * 2 + checkOutput * 2;
  const config = ConfigYaml.parse(parseYaml(configText));
  const drafter = resolveRoleModel(runtime, config, "drafter");
  const checker = resolveRoleModel(runtime, config, "checker");
  const costUsd =
    costFor(drafter, baseInput, draftOutput) * 2 + costFor(checker, baseInput + draftOutput, checkOutput) * 2;
  const billing = classifyBilling(
    [
      providerOf(config.models.roles.drafter ?? config.models.default),
      providerOf(config.models.roles.checker ?? config.models.default),
    ],
    config.billing?.subscription ?? [],
  );
  return { tokens, costUsd: costUsd === 0 ? null : costUsd, billing };
}

export async function estimateCardsJob(
  root: string,
  input: MakeCardsInput,
  runtime: ModelRuntime,
): Promise<JobProposalEvent["estimate"]> {
  const cardPath = input.note.replace(/^notes\//, "cards/");
  const [note, cards, configText] = await Promise.all([
    readText(root, `${input.set}/${input.note}`),
    optionalText(root, `${input.set}/${cardPath}`),
    readText(root, "_global/config.yaml"),
  ]);
  const baseInput = Math.max(1, Math.ceil((note.length + cards.length) / CHARS_PER_TOKEN));
  const cardOutput = Math.max(400, input.count * 120);
  const criticOutput = Math.max(400, (input.count === 0 ? 12 : input.count) * 80);
  const config = ConfigYaml.parse(parseYaml(configText));
  const critic = resolveRoleModel(runtime, config, "critic");
  const cardsmithRuns = input.count === 0 ? 0 : 2;
  const criticRuns = input.count === 0 ? 1 : 2;
  const cardsmith = cardsmithRuns === 0 ? null : resolveRoleModel(runtime, config, "cardsmith");
  const tokens = baseInput * (cardsmithRuns + criticRuns) + cardOutput * cardsmithRuns + criticOutput * criticRuns;
  const costUsd =
    (cardsmith === null ? 0 : costFor(cardsmith, baseInput, cardOutput) * cardsmithRuns) +
    costFor(critic, baseInput + cardOutput, criticOutput) * criticRuns;
  const billing = classifyBilling(
    [
      ...(cardsmithRuns === 0 ? [] : [providerOf(config.models.roles.cardsmith ?? config.models.default)]),
      providerOf(config.models.roles.critic ?? config.models.default),
    ],
    config.billing?.subscription ?? [],
  );
  return { tokens, costUsd: costUsd === 0 ? null : costUsd, billing };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { isError: true, summary: message },
  };
}

export function startJobTool(opts: {
  root: string;
  set: string;
  runtime: ModelRuntime;
  store?: ProposalStore;
}): ToolDefinition {
  return defineTool({
    name: "start_job",
    label: "Propose a background job",
    description: "Propose a chapter-drafting or card-making job for learner confirmation. This does not start the job.",
    parameters: Type.Union([
      Type.Object({
        kind: Type.Literal("draft-chapter"),
        title: Type.String({ minLength: 1 }),
        brief: Type.Optional(Type.String()),
        sources: Type.Optional(Type.Array(Type.String({ pattern: "^lib-[a-z0-9][a-z0-9-]*$" }))),
      }),
      Type.Object({
        kind: Type.Literal("make-cards"),
        note: Type.String({ pattern: "^notes/[0-9]{2,}-[a-z0-9][a-z0-9-]*\\.md$" }),
        count: Type.Optional(Type.Integer({ minimum: 0, maximum: 40 })),
      }),
    ]),
    async execute(_toolCallId, params) {
      try {
        if (params.kind === "make-cards") {
          const input = parseMakeCardsInput({ ...params, set: opts.set });
          const estimate = await estimateCardsJob(opts.root, input, opts.runtime);
          const proposal = (opts.store ?? jobProposals).createCards(input, estimate);
          const summary = "awaiting learner confirmation";
          return {
            content: [{ type: "text" as const, text: summary }],
            details: { isError: false, summary, proposal },
          };
        }
        const input: DraftChapterInput = {
          set: opts.set,
          title: params.title.trim(),
          ...(params.brief === undefined ? {} : { brief: params.brief }),
          ...(params.sources === undefined ? {} : { sources: [...params.sources] }),
        };
        if (input.title === "") throw new Error("title is required");
        const estimate = await estimateDraftJob(opts.root, input, opts.runtime);
        const proposal = (opts.store ?? jobProposals).create(input, estimate);
        const summary = "awaiting learner confirmation";
        return {
          content: [{ type: "text" as const, text: summary }],
          details: { isError: false, summary, proposal },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  });
}

export function proposalFromToolResult(result: unknown): JobProposalEvent | null {
  if (typeof result !== "object" || result === null || !("details" in result)) return null;
  const details = result.details;
  if (typeof details !== "object" || details === null || !("proposal" in details)) return null;
  const proposal = details.proposal;
  if (typeof proposal !== "object" || proposal === null) return null;
  if (
    !("kind" in proposal) ||
    proposal.kind !== "job_proposal" ||
    !("proposalId" in proposal) ||
    typeof proposal.proposalId !== "string" ||
    !("jobKind" in proposal) ||
    (proposal.jobKind !== "draft-chapter" && proposal.jobKind !== "make-cards") ||
    !("title" in proposal) ||
    typeof proposal.title !== "string" ||
    !("estimate" in proposal) ||
    typeof proposal.estimate !== "object" ||
    proposal.estimate === null
  ) {
    return null;
  }
  const estimate = proposal.estimate;
  if (
    !("tokens" in estimate) ||
    typeof estimate.tokens !== "number" ||
    !("costUsd" in estimate) ||
    (estimate.costUsd !== null && typeof estimate.costUsd !== "number")
  ) {
    return null;
  }
  return proposal as JobProposalEvent;
}
