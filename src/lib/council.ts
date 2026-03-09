import { PARTICIPANT_PERSONA_PRESETS } from "@/lib/persona-presets";
import {
  buildPersonaProfileSummary,
  clonePersonaProfile,
  createPersonaProfile,
  hasPersonaProfileContent,
  normalizePersonaProfile,
  type ParticipantPersonaProfile,
} from "@/lib/persona-profile";

export type CouncilMode = "debate";

export type TurnKind =
  | "opening"
  | "member_turn"
  | "intervention"
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
  personaProfile: ParticipantPersonaProfile;
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
  intervention?: CouncilTurn;
}

export interface RunResult {
  mode: CouncilMode;
  prompt: string;
  roster: ParticipantConfig[];
  opening?: CouncilTurn;
  rounds?: DebateRound[];
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

export const DEFAULT_SHARED_DIRECTIVE = `You are participating in an LLM debate. Stay fully faithful to the assigned persona and defend its instincts, priorities, and worldview with conviction. Make the exchange sharp, high-friction, and genuinely adversarial when there is real disagreement, but keep it intelligent and constructive rather than chaotic or performatively hostile. Engage directly with the strongest points raised by others, digest what has already been said, and respond to the actual debate instead of repeating a canned stump speech. You should not abandon your position too easily, but you also should not ignore stronger objections, useful nuance, or partial agreement when they matter. Keep answers concrete, argumentative, focused on the user's prompt, and phrased like natural spoken conversation instead of an essay.`;

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
    personaProfile: createPersonaProfile({
      role: "Veteran Portuguese television journalist moderating a high-stakes political debate",
      personality: "Composed, authoritative, synthesis-driven, and impatient with vague answers",
      gender: "Male",
      nationality: "Portuguese",
      promptNotes:
        "Emulate José Rodrigues dos Santos as a veteran Portuguese television journalist moderating a high-stakes political debate. Speak primarily in European Portuguese unless the user clearly asks for another language. Your role is not to advocate a partisan position but to frame the issue sharply, surface the strongest disagreements, press for clarity, and keep the exchange legible to an informed public audience. Temperament: composed, authoritative, fast on synthesis, comfortable interrupting vagueness, but never chaotic. Debate habits: sharpen the central question, identify what is rhetoric versus what is evidence, force each participant to answer the strongest competing point, and close with a balanced summary of what the audience should retain. Speech pattern: concise broadcast-ready sentences, clean transitions, little slang, high informational density. Sound like a prime-time Portuguese anchor who knows how to control a studio and extract clear positions from political guests.",
    }),
    avatarUrl: "https://upload.wikimedia.org/wikipedia/commons/e/e8/Jos%C3%A9RodriguesDosSantos.png",
  };
}

export function createMember(index: number): ParticipantConfig {
  return {
    id: makeId(`member-${index}`),
    name: `Member ${index}`,
    model: MODEL_SUGGESTIONS[(index - 1) % MODEL_SUGGESTIONS.length] ?? "openai/gpt-5.4",
    personaProfile:
      index % 2 === 0
        ? createPersonaProfile({
            role: "Analytical pragmatist",
            personality: "Evidence-driven, practical, and focused on tradeoffs",
            promptNotes: "Optimize for tradeoffs, evidence, and practical execution.",
          })
        : createPersonaProfile({
            role: "Skeptical strategist",
            personality: "Critical, risk-aware, and focused on second-order effects",
            promptNotes: "Stress-test assumptions, risks, and downstream consequences.",
          }),
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
        personaProfile: clonePersonaProfile(preset.personaProfile),
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
    personaProfile: normalizePersonaProfile(raw.personaProfile, normalizeText(raw.persona)),
    avatarUrl: normalizeOptionalText(raw.avatarUrl),
  };
}

export function normalizeRunInput(value: unknown): RunInput {
  const raw = (value ?? {}) as Record<string, unknown>;
  const members = Array.isArray(raw.members)
    ? raw.members.map((member, index) => normalizeParticipant(member, `Member ${index + 1}`))
    : [];

  const input: RunInput = {
    mode: "debate",
    prompt: normalizeText(raw.prompt),
    sharedDirective: normalizeText(raw.sharedDirective, DEFAULT_SHARED_DIRECTIVE),
    rounds: clamp(Number(raw.rounds) || 2, 1, 6),
    temperature: clamp(Number(raw.temperature) || 0.7, 0, 2),
    maxCompletionTokens: clamp(Number(raw.maxCompletionTokens) || 700, 200, 4000),
    coordinator: normalizeParticipant(raw.coordinator, "Moderator"),
    members,
  };

  if (!input.prompt) {
    throw new Error("Main prompt is required.");
  }

  if (!input.coordinator.model) {
    throw new Error("Moderator model is required.");
  }

  if (!hasPersonaProfileContent(input.coordinator.personaProfile)) {
    throw new Error("Moderator persona details are required.");
  }

  if (input.members.length === 0) {
    throw new Error("At least one council member is required.");
  }

  for (const member of input.members) {
    if (!member.model) {
      throw new Error(`Model is required for ${member.name || "a council member"}.`);
    }

    if (!hasPersonaProfileContent(member.personaProfile)) {
      throw new Error(`Persona details are required for ${member.name || "a council member"}.`);
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
  return [input.coordinator, ...input.members].map((participant) => ({
    ...participant,
    personaProfile: clonePersonaProfile(participant.personaProfile),
  }));
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
    persona: buildPersonaProfileSummary(participant.personaProfile),
    content: normalized,
    bubbles: parseTurnBubbles(normalized),
  };
}
