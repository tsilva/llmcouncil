import {
  addUsage,
  createDefaultInput,
  emptyUsage,
  type CouncilTurn,
  type ParticipantConfig,
  type RunInput,
  type RunResult,
  type UsageSummary,
} from "@/lib/council";

export interface RunExecutionOptions {
  apiKey: string;
  siteUrl?: string;
}

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
    `Coordinator: ${input.coordinator.name} (${input.coordinator.model})`,
    ...input.members.map(
      (member) => `Member: ${member.name} (${member.model}) persona: ${member.persona}`,
    ),
  ];

  return lines.join("\n");
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
      ? "You are the council coordinator. Your job is to frame the question, preserve the strongest arguments from all sides, and produce balanced synthesis rather than advocate for one side."
      : "You are a council member. You should argue from your assigned persona, engage with competing claims, and revise your stance when a stronger argument appears.";

  return [
    roleDirective,
    `Display name: ${participant.name}`,
    `Assigned persona: ${participant.persona}`,
    `Shared council directive:\n${input.sharedDirective}`,
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
        `Planned rounds: ${input.rounds}`,
        "Task:",
        "- Introduce the prompt neutrally.",
        "- Name the main tensions or decision criteria the council should explore.",
        "- Keep it concise and specific.",
      ].join("\n\n"),
    },
    ],
  );

  usage = addUsage(usage, openingResult.usage);

  const opening: CouncilTurn = {
    id: crypto.randomUUID(),
    kind: "opening",
    speakerId: input.coordinator.id,
    speakerName: input.coordinator.name,
    model: openingResult.resolvedModel,
    persona: input.coordinator.persona,
    content: openingResult.content,
  };

  const transcript: CouncilTurn[] = [opening];
  const rounds = [];

  for (let round = 1; round <= input.rounds; round += 1) {
    const turns: CouncilTurn[] = [];

    for (const member of input.members) {
      const memberResult = await callOpenRouter(input, member, "member", sessionId, execution, [
        {
          role: "user",
          content: [
            `Original user prompt:\n${input.prompt}`,
            `Council roster:\n${formatRoster(input)}`,
            `Debate transcript so far:\n${formatTurns(transcript)}`,
            `You are speaking in round ${round} of ${input.rounds}.`,
            "Task:",
            "- Contribute one substantive turn from your persona.",
            "- Engage directly with the strongest arguments raised so far.",
            "- Say what you agree with, disagree with, or refine.",
            "- Keep the answer compact but argumentative.",
          ].join("\n\n"),
        },
      ]);

      usage = addUsage(usage, memberResult.usage);

      const turn: CouncilTurn = {
        id: crypto.randomUUID(),
        kind: "member_turn",
        round,
        speakerId: member.id,
        speakerName: member.name,
        model: memberResult.resolvedModel,
        persona: member.persona,
        content: memberResult.content,
      };

      transcript.push(turn);
      turns.push(turn);
    }

    rounds.push({ round, turns });
  }

  const synthesisResult = await callOpenRouter(
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
          `Final debate transcript:\n${formatTurns(transcript)}`,
          "Task:",
          "- Summarize the strongest claims from the debate.",
          "- Produce a balanced final synthesis, not a winner-take-all verdict.",
          "- Call out unresolved uncertainty or tradeoffs when relevant.",
        ].join("\n\n"),
      },
    ],
  );

  usage = addUsage(usage, synthesisResult.usage);

  return {
    mode: "debate",
    prompt: input.prompt,
    opening,
    rounds,
    synthesis: {
      id: crypto.randomUUID(),
      kind: "synthesis",
      speakerId: input.coordinator.id,
      speakerName: input.coordinator.name,
      model: synthesisResult.resolvedModel,
      persona: input.coordinator.persona,
      content: synthesisResult.content,
    },
    usage,
    warnings,
  };
}

async function runCouncil(input: RunInput, execution: RunExecutionOptions): Promise<RunResult> {
  const sessionId = crypto.randomUUID();
  let usage = emptyUsage();
  const warnings: string[] = [];

  const memberResults = await Promise.allSettled(
    input.members.map((member) =>
      callOpenRouter(input, member, "member", sessionId, execution, [
        {
          role: "user",
          content: [
            `Original user prompt:\n${input.prompt}`,
            `Council roster:\n${formatRoster(input)}`,
            "Task:",
            "- Respond independently from your persona.",
            "- State your recommendation, reasoning, and main concerns.",
            "- Do not try to form consensus yet.",
          ].join("\n\n"),
        },
      ]),
    ),
  );

  const councilResponses: CouncilTurn[] = [];

  memberResults.forEach((result, index) => {
    const member = input.members[index];
    if (result.status === "fulfilled") {
      usage = addUsage(usage, result.value.usage);
      councilResponses.push({
        id: crypto.randomUUID(),
        kind: "council_response",
        speakerId: member.id,
        speakerName: member.name,
        model: result.value.resolvedModel,
        persona: member.persona,
        content: result.value.content,
      });
      return;
    }

    warnings.push(`${member.name} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });

  if (councilResponses.length === 0) {
    throw new Error("Every council member failed to respond.");
  }

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
          `Independent council responses:\n${formatTurns(councilResponses)}`,
          warnings.length > 0 ? `Missing responses:\n${warnings.join("\n")}` : "",
          "Task:",
          "- Produce an equitable middle-ground consensus across the available responses.",
          "- Represent the average view fairly instead of amplifying the most forceful member.",
          "- Preserve important minority concerns when they change the recommendation.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  );

  usage = addUsage(usage, consensusResult.usage);

  return {
    mode: "council",
    prompt: input.prompt,
    councilResponses,
    consensus: {
      id: crypto.randomUUID(),
      kind: "consensus",
      speakerId: input.coordinator.id,
      speakerName: input.coordinator.name,
      model: consensusResult.resolvedModel,
      persona: input.coordinator.persona,
      content: consensusResult.content,
    },
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

  if (input.mode === "council") {
    return runCouncil(input, execution);
  }

  return runDebate(input, execution);
}
