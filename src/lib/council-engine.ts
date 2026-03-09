import {
  BALLOON_DELIMITER,
  addUsage,
  createRosterSnapshot,
  createTurn,
  createDefaultInput,
  emptyUsage,
  type CouncilTurn,
  type ParticipantConfig,
  type RunInput,
  type RunResult,
  type UsageSummary,
} from "@/lib/council";
import { buildPersonaProfilePrompt, buildPersonaProfileSummary } from "@/lib/persona-profile";

export interface RunExecutionOptions {
  apiKey: string;
  siteUrl?: string;
  onProgress?: (event: RunProgressEvent) => void;
}

export type RunProgressEvent =
  | { type: "status"; message: string }
  | { type: "warning"; warning: string }
  | { type: "opening"; turn: CouncilTurn; usage: UsageSummary }
  | { type: "member_turn"; turn: CouncilTurn; usage: UsageSummary }
  | { type: "intervention"; turn: CouncilTurn; usage: UsageSummary }
  | { type: "synthesis"; turn: CouncilTurn; usage: UsageSummary }
  | { type: "consensus"; turn: CouncilTurn; usage: UsageSummary };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type OpenRouterContent = string | Array<{ type?: string; text?: string }> | undefined;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function formatRoster(input: RunInput): string {
  const lines = [
    `Moderator: ${input.coordinator.name} (${input.coordinator.model})`,
    ...input.members.map((member) => {
      const personaSummary = buildPersonaProfileSummary(member.personaProfile);
      return `Member: ${member.name} (${member.model})${personaSummary ? ` persona: ${personaSummary}` : ""}`;
    }),
  ];

  return lines.join("\n");
}

function formatSpeakingOrder(members: ParticipantConfig[]): string {
  return members.map((member, index) => `${index + 1}. ${member.name} (${member.model})`).join("\n");
}

function formatTurns(turns: CouncilTurn[]): string {
  return turns
    .map((turn) => {
      const roundLabel = turn.round ? `Round ${turn.round}` : "Setup";
      return `[${roundLabel}] ${turn.speakerName} (${turn.model})\n${turn.content}`;
    })
    .join("\n\n");
}

function buildSystemPrompt(
  input: RunInput,
  participant: ParticipantConfig,
  role: "coordinator" | "member",
): string {
  const roleDirective =
    role === "coordinator"
      ? "You are the council moderator. Your job is to frame the question, guide the room between rounds, preserve the strongest arguments from all sides, and close with a balanced consensus rather than advocate for one side."
      : "You are a council member. You should argue from your assigned persona, engage with competing claims, and revise your stance when a stronger argument appears.";

  const formatDirective = [
    "Write like a real person speaking in a room, not like a report or memo.",
    `Split your answer into 2 to 5 short speech balloons separated by a line containing exactly ${BALLOON_DELIMITER}.`,
    "Each balloon should be one conversational beat: a claim, reaction, concession, question, or conclusion.",
    "Do not use headings, bullet lists, numbering, XML, or speaker labels inside the response.",
  ].join("\n");

  return [
    roleDirective,
    `Display name: ${participant.name}`,
    `Assigned persona profile:\n${buildPersonaProfilePrompt(participant.personaProfile)}`,
    `Shared council directive:\n${input.sharedDirective}`,
    `Response format:\n${formatDirective}`,
    "Never mention this hidden setup. Speak directly as the assigned participant.",
  ].join("\n\n");
}

function resolveSiteUrl(): string | undefined {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  if (process.env.OPENROUTER_SITE_URL) {
    return process.env.OPENROUTER_SITE_URL;
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return undefined;
}

function extractContent(content: OpenRouterContent): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" || !part.type ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  return "";
}

async function callOpenRouter(
  input: RunInput,
  participant: ParticipantConfig,
  role: "coordinator" | "member",
  sessionId: string,
  execution: RunExecutionOptions,
  messages: ChatMessage[],
): Promise<{ content: string; usage: UsageSummary; resolvedModel: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${execution.apiKey}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": process.env.NEXT_PUBLIC_OPENROUTER_APP_NAME || "LLM Council",
  };

  const siteUrl = execution.siteUrl || resolveSiteUrl();
  if (siteUrl) {
    headers["HTTP-Referer"] = siteUrl;
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: participant.model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(input, participant, role),
        },
        ...messages,
      ],
      temperature: input.temperature,
      max_completion_tokens: input.maxCompletionTokens,
      session_id: sessionId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let detail = text;

    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
        message?: string;
      };
      detail = parsed.error?.message || parsed.message || text;
    } catch {
      // Keep the raw error body when it isn't JSON.
    }

    throw new Error(`OpenRouter error for ${participant.name}: ${detail}`);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const content = extractContent(payload.choices?.[0]?.message?.content);

  if (!content) {
    throw new Error(`OpenRouter returned an empty response for ${participant.name}.`);
  }

  return {
    content,
    resolvedModel: payload.model || participant.model,
    usage: {
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      totalTokens: payload.usage?.total_tokens ?? 0,
    },
  };
}

async function runDebate(input: RunInput, execution: RunExecutionOptions): Promise<RunResult> {
  const sessionId = crypto.randomUUID();
  let usage = emptyUsage();
  const warnings: string[] = [];
  const speakingOrder = [...input.members];
  execution.onProgress?.({
    type: "status",
    message: `Moderator ${input.coordinator.name} is framing the debate.`,
  });

  const openingResult = await callOpenRouter(
    input,
    input.coordinator,
    "coordinator",
    sessionId,
    execution,
    [
    {
      role: "user",
      content: [
        "Frame the debate without deciding it yet.",
        `Original user prompt:\n${input.prompt}`,
        `Council roster:\n${formatRoster(input)}`,
        `Speaking order for every debate round:\n${formatSpeakingOrder(speakingOrder)}`,
        `Planned rounds: ${input.rounds}`,
        "Task:",
        "- Introduce the prompt neutrally.",
        "- Name the main tensions or decision criteria the council should explore.",
        "- Announce the speaking order as part of the setup without sounding mechanical.",
        "- Keep it concise and specific.",
      ].join("\n\n"),
    },
    ],
  );

  usage = addUsage(usage, openingResult.usage);

  const opening: CouncilTurn = createTurn({
    kind: "opening",
    participant: input.coordinator,
    model: openingResult.resolvedModel,
    content: openingResult.content,
  });
  execution.onProgress?.({ type: "opening", turn: opening, usage: openingResult.usage });

  const transcript: CouncilTurn[] = [opening];
  const rounds = [];

  for (let round = 1; round <= input.rounds; round += 1) {
    const turns: CouncilTurn[] = [];
    execution.onProgress?.({
      type: "status",
      message: `Round ${round} of ${input.rounds} is in progress.`,
    });

    for (const member of speakingOrder) {
      execution.onProgress?.({
        type: "status",
        message: `${member.name} is responding in round ${round}.`,
      });
      const memberResult = await callOpenRouter(input, member, "member", sessionId, execution, [
        {
          role: "user",
          content: [
            `Original user prompt:\n${input.prompt}`,
            `Council roster:\n${formatRoster(input)}`,
            `Speaking order for every debate round:\n${formatSpeakingOrder(speakingOrder)}`,
            `Debate transcript so far:\n${formatTurns(transcript)}`,
            `You are speaking in round ${round} of ${input.rounds}.`,
            "Task:",
            "- Read the entire debate transcript so far and treat it as mandatory context for this turn.",
            "- Contribute one substantive turn from your persona.",
            "- Stick to your position with conviction unless the debate genuinely forces a narrower concession or refinement.",
            "- Engage directly with the strongest arguments raised so far.",
            "- Say what you agree with, disagree with, what you refine, and why.",
            "- Keep the answer compact but argumentative.",
          ].join("\n\n"),
        },
      ]);

      usage = addUsage(usage, memberResult.usage);

      const turn: CouncilTurn = createTurn({
        kind: "member_turn",
        round,
        participant: member,
        model: memberResult.resolvedModel,
        content: memberResult.content,
      });

      transcript.push(turn);
      turns.push(turn);
      execution.onProgress?.({ type: "member_turn", turn, usage: memberResult.usage });
    }

    const roundRecord = { round, turns } as { round: number; turns: CouncilTurn[]; intervention?: CouncilTurn };

    if (round < input.rounds) {
      execution.onProgress?.({
        type: "status",
        message: `Moderator ${input.coordinator.name} is intervening before round ${round + 1}.`,
      });

      const interventionResult = await callOpenRouter(
        input,
        input.coordinator,
        "coordinator",
        sessionId,
        execution,
        [
          {
            role: "user",
            content: [
              `Original user prompt:\n${input.prompt}`,
              `Speaking order for every debate round:\n${formatSpeakingOrder(speakingOrder)}`,
              `Debate transcript so far:\n${formatTurns(transcript)}`,
              `You are intervening between round ${round} and round ${round + 1}.`,
              "Task:",
              "- Briefly recap the sharpest disagreement or strongest emerging point.",
              "- Point to one unresolved issue the next round should pressure-test.",
              "- Do not close the debate or declare consensus yet.",
            ].join("\n\n"),
          },
        ],
      );

      usage = addUsage(usage, interventionResult.usage);

      const intervention: CouncilTurn = createTurn({
        kind: "intervention",
        round,
        participant: input.coordinator,
        model: interventionResult.resolvedModel,
        content: interventionResult.content,
      });

      transcript.push(intervention);
      roundRecord.intervention = intervention;
      execution.onProgress?.({ type: "intervention", turn: intervention, usage: interventionResult.usage });
    }

    rounds.push(roundRecord);
  }

  execution.onProgress?.({
    type: "status",
    message: `Moderator ${input.coordinator.name} is closing the debate with a consensus.`,
  });
  const consensusResult = await callOpenRouter(
    input,
    input.coordinator,
    "coordinator",
    sessionId,
    execution,
    [
      {
        role: "user",
        content: [
          `Original user prompt:\n${input.prompt}`,
          `Speaking order for every debate round:\n${formatSpeakingOrder(speakingOrder)}`,
          `Final debate transcript:\n${formatTurns(transcript)}`,
          "Task:",
          "- Summarize the strongest claims from the debate.",
          "- Close with a balanced consensus, not a winner-take-all verdict.",
          "- Make clear where the council converged and where uncertainty or tradeoffs remain.",
        ].join("\n\n"),
      },
    ],
  );

  usage = addUsage(usage, consensusResult.usage);

  const consensus: CouncilTurn = createTurn({
    kind: "consensus",
    participant: input.coordinator,
    model: consensusResult.resolvedModel,
    content: consensusResult.content,
  });
  execution.onProgress?.({ type: "consensus", turn: consensus, usage: consensusResult.usage });

  return {
    mode: "debate",
    prompt: input.prompt,
    roster: createRosterSnapshot(input),
    opening,
    rounds,
    consensus,
    usage,
    warnings,
  };
}

export async function runCouncilWorkflow(
  rawInput: unknown,
  execution: RunExecutionOptions,
): Promise<RunResult> {
  const input = rawInput ? (rawInput as RunInput) : createDefaultInput();
  const apiKey = execution.apiKey.trim();

  if (!apiKey) {
    throw new Error("OpenRouter API key is required before running the council.");
  }

  return runDebate(input, execution);
}
