import { PARTICIPANT_PERSONA_PRESETS } from "@/lib/persona-presets";

export type CouncilMode = "debate" | "council";

export type TurnKind =
  | "opening"
  | "member_turn"
  | "council_response"
  | "synthesis"
  | "consensus";

export interface TurnBubble {
  id: string;
  content: string;
}

export interface ParticipantConfig {
  id: string;
  name: string;
  model: string;
  persona: string;
  avatarUrl?: string;
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
  bubbles: TurnBubble[];
}

export interface DebateRound {
  round: number;
  turns: CouncilTurn[];
}

export interface RunResult {
  mode: CouncilMode;
  prompt: string;
  roster: ParticipantConfig[];
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

export const DEFAULT_PRESET_MODEL = "x-ai/grok-4.1-fast";

export const BALLOON_DELIMITER = "<<<BALLOON>>>";

export const DEFAULT_SHARED_DIRECTIVE = `You are participating in an LLM council. Stay faithful to the assigned persona, reason explicitly, and be willing to update your view when another member makes a stronger point. Keep answers concrete, balanced, focused on the user's prompt, and phrased like natural spoken conversation instead of an essay.`;

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createCoordinator(): ParticipantConfig {
  return {
    id: makeId("coordinator"),
    name: "José Rodrigues dos Santos",
    model: "openai/gpt-5.4",
    persona:
      "Emulate José Rodrigues dos Santos as a veteran Portuguese television journalist moderating a high-stakes political debate. Speak primarily in European Portuguese unless the user clearly asks for another language. Your role is not to advocate a partisan position but to frame the issue sharply, surface the strongest disagreements, press for clarity, and keep the exchange legible to an informed public audience. Temperament: composed, authoritative, fast on synthesis, comfortable interrupting vagueness, but never chaotic. Debate habits: sharpen the central question, identify what is rhetoric versus what is evidence, force each participant to answer the strongest competing point, and close with a balanced summary of what the audience should retain. Speech pattern: concise broadcast-ready sentences, clean transitions, little slang, high informational density. Sound like a prime-time Portuguese anchor who knows how to control a studio and extract clear positions from political guests.",
    avatarUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e8/Jos%C3%A9RodriguesDosSantos.png",
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
  const defaultMemberPresetIds = ["luis-montenegro", "mariana-mortagua", "andre-ventura"] as const;
  const presetMap = new Map(PARTICIPANT_PERSONA_PRESETS.map((preset) => [preset.id, preset]));

  return {
    mode: "debate",
    prompt: "",
    sharedDirective: DEFAULT_SHARED_DIRECTIVE,
    rounds: 2,
    temperature: 0.7,
    maxCompletionTokens: 700,
    coordinator: createCoordinator(),
    members: defaultMemberPresetIds.map((presetId, index) => {
      const preset = presetMap.get(presetId);

      if (!preset) {
        return createMember(index + 1);
      }

      return {
        id: makeId(`member-${index + 1}`),
        name: preset.name,
        model: DEFAULT_PRESET_MODEL,
        persona: preset.persona,
        avatarUrl: preset.avatarUrl,
      };
    }),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeParticipant(value: unknown, fallbackName: string): ParticipantConfig {
  const raw = (value ?? {}) as Record<string, unknown>;

  return {
    id: normalizeText(raw.id, makeId(fallbackName.toLowerCase().replace(/\s+/g, "-"))),
    name: normalizeText(raw.name, fallbackName),
    model: normalizeText(raw.model),
    persona: normalizeText(raw.persona),
    avatarUrl: normalizeOptionalText(raw.avatarUrl),
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

export function createRosterSnapshot(input: RunInput): ParticipantConfig[] {
  return [input.coordinator, ...input.members].map((participant) => ({ ...participant }));
}

export function parseTurnBubbles(content: string): TurnBubble[] {
  const normalized = content.trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(new RegExp(`\\s*${BALLOON_DELIMITER}\\s*`, "g"))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => ({
      id: makeId(`bubble-${index + 1}`),
      content: part,
    }));
}

export function createTurn({
  kind,
  round,
  participant,
  model,
  content,
}: {
  kind: TurnKind;
  round?: number;
  participant: ParticipantConfig;
  model: string;
  content: string;
}): CouncilTurn {
  const normalized = content.trim();

  return {
    id: makeId("turn"),
    kind,
    round,
    speakerId: participant.id,
    speakerName: participant.name,
    model,
    persona: participant.persona,
    content: normalized,
    bubbles: parseTurnBubbles(normalized),
  };
}
