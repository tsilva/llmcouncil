export type CouncilMode = "debate" | "council";

export type TurnKind =
  | "opening"
  | "member_turn"
  | "council_response"
  | "synthesis"
  | "consensus";

export interface ParticipantConfig {
  id: string;
  name: string;
  model: string;
  persona: string;
}

export interface RunInput {
  mode: CouncilMode;
  prompt: string;
  sharedDirective: string;
  rounds: number;
  temperature: number;
  maxCompletionTokens: number;
  coordinator: ParticipantConfig;
  members: ParticipantConfig[];
}

export interface UsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CouncilTurn {
  id: string;
  kind: TurnKind;
  round?: number;
  speakerId: string;
  speakerName: string;
  model: string;
  persona: string;
  content: string;
}

export interface DebateRound {
  round: number;
  turns: CouncilTurn[];
}

export interface RunResult {
  mode: CouncilMode;
  prompt: string;
  opening?: CouncilTurn;
  rounds?: DebateRound[];
  councilResponses?: CouncilTurn[];
  synthesis?: CouncilTurn;
  consensus?: CouncilTurn;
  usage: UsageSummary;
  warnings: string[];
}

export const MODEL_SUGGESTIONS = [
  "google/gemini-3.1-flash-lite-preview",
  "x-ai/grok-4.1-fast",
  "openai/gpt-5.4",
  "qwen/qwen3.5-35b-a3b",
] as const;

export const DEFAULT_SHARED_DIRECTIVE = `You are participating in an LLM council. Stay faithful to the assigned persona, reason explicitly, and be willing to update your view when another member makes a stronger point. Keep answers concrete, balanced, and focused on the user's prompt.`;

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createCoordinator(): ParticipantConfig {
  return {
    id: makeId("coordinator"),
    name: "Coordinator",
    model: "openai/gpt-5.4",
    persona:
      "A measured facilitator who clarifies the question, tracks disagreement honestly, and synthesizes balanced conclusions.",
  };
}

export function createMember(index: number): ParticipantConfig {
  return {
    id: makeId(`member-${index}`),
    name: `Member ${index}`,
    model: MODEL_SUGGESTIONS[(index - 1) % MODEL_SUGGESTIONS.length] ?? "openai/gpt-5.4",
    persona:
      index % 2 === 0
        ? "An analytical pragmatist who optimizes for tradeoffs, evidence, and practical execution."
        : "A skeptical strategist who stress-tests assumptions, risks, and second-order effects.",
  };
}

export function createDefaultInput(): RunInput {
  return {
    mode: "debate",
    prompt: "",
    sharedDirective: DEFAULT_SHARED_DIRECTIVE,
    rounds: 2,
    temperature: 0.7,
    maxCompletionTokens: 700,
    coordinator: createCoordinator(),
    members: [createMember(1), createMember(2), createMember(3)],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeParticipant(value: unknown, fallbackName: string): ParticipantConfig {
  const raw = (value ?? {}) as Record<string, unknown>;

  return {
    id: normalizeText(raw.id, makeId(fallbackName.toLowerCase().replace(/\s+/g, "-"))),
    name: normalizeText(raw.name, fallbackName),
    model: normalizeText(raw.model),
    persona: normalizeText(raw.persona),
  };
}

export function normalizeRunInput(value: unknown): RunInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  const members = Array.isArray(raw.members)
    ? raw.members.map((member, index) => normalizeParticipant(member, `Member ${index + 1}`))
    : [];

  const input: RunInput = {
    mode: raw.mode === "council" ? "council" : "debate",
    prompt: normalizeText(raw.prompt),
    sharedDirective: normalizeText(raw.sharedDirective, DEFAULT_SHARED_DIRECTIVE),
    rounds: clamp(Number(raw.rounds) || 2, 1, 6),
    temperature: clamp(Number(raw.temperature) || 0.7, 0, 2),
    maxCompletionTokens: clamp(Number(raw.maxCompletionTokens) || 700, 200, 4000),
    coordinator: normalizeParticipant(raw.coordinator, "Coordinator"),
    members,
  };

  if (!input.prompt) {
    throw new Error("Main prompt is required.");
  }

  if (!input.coordinator.model) {
    throw new Error("Coordinator model is required.");
  }

  if (!input.coordinator.persona) {
    throw new Error("Coordinator persona is required.");
  }

  if (input.members.length === 0) {
    throw new Error("At least one council member is required.");
  }

  for (const member of input.members) {
    if (!member.model) {
      throw new Error(`Model is required for ${member.name || "a council member"}.`);
    }

    if (!member.persona) {
      throw new Error(`Persona is required for ${member.name || "a council member"}.`);
    }
  }

  return input;
}

export function emptyUsage(): UsageSummary {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

export function addUsage(target: UsageSummary, delta?: Partial<UsageSummary> | null): UsageSummary {
  if (!delta) {
    return target;
  }

  return {
    promptTokens: target.promptTokens + (delta.promptTokens ?? 0),
    completionTokens: target.completionTokens + (delta.completionTokens ?? 0),
    totalTokens: target.totalTokens + (delta.totalTokens ?? 0),
  };
}
