"use client";

import { useEffect, useId, useState } from "react";
import {
  MODEL_SUGGESTIONS,
  addUsage,
  createRosterSnapshot,
  createDefaultInput,
  createMember,
  emptyUsage,
  type CouncilTurn,
  type DebateRound,
  type ParticipantConfig,
  type RunInput,
  type RunResult,
} from "@/lib/council";
import { runCouncilWorkflow, type RunProgressEvent } from "@/lib/council-engine";

const OPENROUTER_KEY_STORAGE = "llmcouncil.openrouter.key";

function maskApiKey(value: string): string {
  if (value.length <= 10) {
    return "Saved";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-2 block text-sm text-[color:var(--muted)]">{hint}</span> : null}
    </label>
  );
}

function ParticipantCard({
  title,
  participant,
  modelListId,
  onChange,
  onRemove,
  removable = false,
}: {
  title: string;
  participant: ParticipantConfig;
  modelListId: string;
  onChange: (patch: Partial<ParticipantConfig>) => void;
  onRemove?: () => void;
  removable?: boolean;
}) {
  return (
    <article className="glass-panel rounded-[1.5rem] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--muted)]">
            {title}
          </p>
          <h3 className="mt-1 text-xl font-semibold text-[color:var(--foreground)]">{participant.name}</h3>
        </div>
        {removable ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-full border border-[color:var(--line)] px-3 py-1 text-sm text-[color:var(--muted)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="grid gap-4">
        <FieldShell label="Name">
          <input
            className="field"
            value={participant.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="Council member name"
          />
        </FieldShell>

        <FieldShell
          label="Model"
          hint="Type any OpenRouter model id, or start from one of the suggested examples."
        >
          <input
            className="field mono"
            list={modelListId}
            value={participant.model}
            onChange={(event) => onChange({ model: event.target.value })}
            placeholder="openai/gpt-4o-mini"
          />
        </FieldShell>

        <FieldShell label="Persona">
          <textarea
            className="field min-h-28 resize-y"
            value={participant.persona}
            onChange={(event) => onChange({ persona: event.target.value })}
            placeholder="Describe the lens this member should adopt."
          />
        </FieldShell>
      </div>
    </article>
  );
}

function UsageBadge({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="glass-panel rounded-2xl px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function kindLabel(kind: CouncilTurn["kind"]): string {
  return kind.replace(/_/g, " ");
}

function seatPosition(index: number, total: number): { left: number; top: number } {
  const angle = ((index / Math.max(total, 1)) * Math.PI * 2) - Math.PI / 2;
  const radiusX = total <= 4 ? 34 : 39;
  const radiusY = total <= 4 ? 22 : 28;

  return {
    left: 50 + Math.cos(angle) * radiusX,
    top: 50 + Math.sin(angle) * radiusY,
  };
}

function bubblePlacement(position: { left: number; top: number }): {
  className: string;
  style: React.CSSProperties;
} {
  if (position.top <= 28) {
    return {
      className: "balloon-stack-center",
      style: {
        left: "50%",
        top: "8%",
        transform: "translateX(-50%)",
      },
    };
  }

  if (position.left < 50) {
    return {
      className: "balloon-stack-left",
      style: {
        left: `${Math.min(position.left + 12, 54)}%`,
        top: `${Math.max(position.top - 12, 26)}%`,
      },
    };
  }

  return {
    className: "balloon-stack-right",
    style: {
      right: `${Math.min(100 - position.left + 12, 54)}%`,
      top: `${Math.max(position.top - 12, 26)}%`,
    },
  };
}

function TurnScene({
  turn,
  roster,
}: {
  turn: CouncilTurn;
  roster: ParticipantConfig[];
}) {
  const normalizedRoster =
    roster.length > 0
      ? roster
      : [
          {
            id: turn.speakerId,
            name: turn.speakerName,
            model: turn.model,
            persona: turn.persona,
          },
        ];
  const speakerIndex = Math.max(
    normalizedRoster.findIndex((participant) => participant.id === turn.speakerId),
    0,
  );
  const speakerPosition = seatPosition(speakerIndex, normalizedRoster.length);
  const placement = bubblePlacement(speakerPosition);
  const bubbles = turn.bubbles.length > 0 ? turn.bubbles : [{ id: `${turn.id}-fallback`, content: turn.content }];

  return (
    <article className="glass-panel rounded-[1.8rem] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted)]">{kindLabel(turn.kind)}</p>
          <h4 className="mt-1 text-lg font-semibold">{turn.speakerName}</h4>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-right text-sm text-[color:var(--muted)]">
          {turn.round ? (
            <span className="rounded-full border border-[color:var(--line)] px-3 py-1 text-xs uppercase tracking-[0.16em]">
              Round {turn.round}
            </span>
          ) : null}
          <span className="rounded-full border border-[color:var(--line)] px-3 py-1 text-xs mono">
            {turn.model}
          </span>
        </div>
      </div>

      <div className="council-scene mt-5">
        <div className="council-table-shadow" />
        <div className="council-table">
          <div className="council-table-inner" />
        </div>

        {normalizedRoster.map((participant, index) => {
          const position = seatPosition(index, normalizedRoster.length);
          const isSpeaker = participant.id === turn.speakerId;

          return (
            <div
              key={participant.id}
              className={`bot-seat ${isSpeaker ? "is-speaking" : ""}`}
              style={{
                left: `${position.left}%`,
                top: `${position.top}%`,
              }}
            >
              <div className="bot-avatar" aria-hidden="true">
                <span className="bot-eye bot-eye-left" />
                <span className="bot-eye bot-eye-right" />
                <span className="bot-mouth" />
              </div>
              <div className="bot-seat-label">
                <span>{participant.name}</span>
                {isSpeaker ? <span className="bot-seat-status">speaking</span> : null}
              </div>
            </div>
          );
        })}

        <div className={`balloon-stack ${placement.className}`} style={placement.style}>
          {bubbles.map((bubble, index) => (
            <div
              key={bubble.id}
              className={`speech-balloon ${index === bubbles.length - 1 ? "speech-balloon-last" : ""}`}
            >
              <p>{bubble.content}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-[color:var(--muted)]">{turn.persona}</p>
    </article>
  );
}

function DebateView({
  opening,
  rounds,
  synthesis,
  roster,
}: {
  opening?: CouncilTurn;
  rounds?: DebateRound[];
  synthesis?: CouncilTurn;
  roster: ParticipantConfig[];
}) {
  return (
    <div className="space-y-6">
      {opening ? (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Coordinator Opening</h3>
          <TurnScene turn={opening} roster={roster} />
        </section>
      ) : null}

      {rounds?.map((round) => (
        <section key={round.round} className="space-y-3">
          <h3 className="text-lg font-semibold">Round {round.round}</h3>
          <div className="grid gap-4">
            {round.turns.map((turn) => (
              <TurnScene key={turn.id} turn={turn} roster={roster} />
            ))}
          </div>
        </section>
      ))}

      {synthesis ? (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Final Synthesis</h3>
          <TurnScene turn={synthesis} roster={roster} />
        </section>
      ) : null}
    </div>
  );
}

function CouncilView({
  councilResponses,
  consensus,
  pendingMembers,
  roster,
}: {
  councilResponses?: CouncilTurn[];
  consensus?: CouncilTurn;
  pendingMembers?: string[];
  roster: ParticipantConfig[];
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Independent Responses</h3>
        {pendingMembers?.length ? (
          <div className="glass-panel rounded-[1.2rem] px-4 py-3 text-sm text-[color:var(--muted)]">
            Waiting for: {pendingMembers.join(", ")}
          </div>
        ) : null}
        <div className="grid gap-4">
          {councilResponses?.map((turn) => <TurnScene key={turn.id} turn={turn} roster={roster} />)}
        </div>
      </section>

      {consensus ? (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Coordinator Consensus</h3>
          <TurnScene turn={consensus} roster={roster} />
        </section>
      ) : null}
    </div>
  );
}

export function CouncilStudio() {
  const modelListId = useId();
  const [config, setConfig] = useState<RunInput>(() => createDefaultInput());
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [hasLoadedKey, setHasLoadedKey] = useState(false);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const usage = result?.usage ?? emptyUsage();
  const hasApiKey = apiKey.trim().length > 0;
  const completedCouncilMembers = new Set(result?.councilResponses?.map((turn) => turn.speakerId) ?? []);
  const pendingCouncilMembers =
    isRunning && config.mode === "council"
      ? config.members
          .filter((member) => !completedCouncilMembers.has(member.id))
          .map((member) => member.name)
      : [];

  useEffect(() => {
    const storedKey = window.localStorage.getItem(OPENROUTER_KEY_STORAGE)?.trim() ?? "";
    if (storedKey) {
      setApiKey(storedKey);
      setDraftApiKey(storedKey);
      setShowKeyPrompt(false);
    } else {
      setShowKeyPrompt(true);
    }
    setHasLoadedKey(true);
  }, []);

  function updateCoordinator(patch: Partial<ParticipantConfig>) {
    setConfig((current) => ({
      ...current,
      coordinator: { ...current.coordinator, ...patch },
    }));
  }

  function updateMember(id: string, patch: Partial<ParticipantConfig>) {
    setConfig((current) => ({
      ...current,
      members: current.members.map((member) => (member.id === id ? { ...member, ...patch } : member)),
    }));
  }

  function addMember() {
    setConfig((current) => ({
      ...current,
      members: [...current.members, createMember(current.members.length + 1)],
    }));
  }

  function removeMember(id: string) {
    setConfig((current) => ({
      ...current,
      members: current.members.filter((member) => member.id !== id),
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasApiKey) {
      setShowKeyPrompt(true);
      setError("Enter your OpenRouter API key before running the council.");
      return;
    }

    setError(null);
    setStatusMessage("Preparing council run.");
    setResult({
      mode: config.mode,
      prompt: config.prompt,
      roster: createRosterSnapshot(config),
      rounds: config.mode === "debate" ? [] : undefined,
      councilResponses: config.mode === "council" ? [] : undefined,
      usage: emptyUsage(),
      warnings: [],
    });
    setIsRunning(true);

    try {
      const payload = await runCouncilWorkflow(config, {
        apiKey,
        siteUrl: window.location.origin,
        onProgress: (event) => {
          applyProgressEvent(event);
        },
      });

      setResult(payload);
      setStatusMessage(config.mode === "debate" ? "Debate complete." : "Council consensus complete.");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "The council run failed.");
      setStatusMessage(null);
    } finally {
      setIsRunning(false);
    }
  }

  function applyProgressEvent(event: RunProgressEvent) {
    if (event.type === "status") {
      setStatusMessage(event.message);
      return;
    }

    if (event.type === "warning") {
      setResult((current) =>
        current
          ? {
              ...current,
              warnings: [...current.warnings, event.warning],
            }
          : current,
      );
      return;
    }

    setResult((current) => {
      if (!current) {
        return current;
      }

      const next = {
        ...current,
        usage: addUsage(current.usage, event.usage),
      };

      switch (event.type) {
        case "opening":
          return { ...next, opening: event.turn };
        case "member_turn": {
          const existingRounds = next.rounds ?? [];
          const index = existingRounds.findIndex((round) => round.round === event.turn.round);
          if (index >= 0) {
            const updatedRounds = existingRounds.map((round, roundIndex) =>
              roundIndex === index ? { ...round, turns: [...round.turns, event.turn] } : round,
            );
            return { ...next, rounds: updatedRounds };
          }

          return {
            ...next,
            rounds: [...existingRounds, { round: event.turn.round ?? 1, turns: [event.turn] }],
          };
        }
        case "council_response":
          return {
            ...next,
            councilResponses: [...(next.councilResponses ?? []), event.turn],
          };
        case "synthesis":
          return { ...next, synthesis: event.turn };
        case "consensus":
          return { ...next, consensus: event.turn };
      }
    });
  }

  function saveApiKey() {
    const trimmed = draftApiKey.trim();
    if (!trimmed) {
      setError("OpenRouter API key is required before running the council.");
      return;
    }

    window.localStorage.setItem(OPENROUTER_KEY_STORAGE, trimmed);
    setApiKey(trimmed);
    setDraftApiKey(trimmed);
    setShowKeyPrompt(false);
    setError(null);
  }

  return (
    <main className="px-4 py-8 sm:px-6 lg:px-10">
      <datalist id={modelListId}>
        {MODEL_SUGGESTIONS.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>

      <div className="mx-auto max-w-7xl">
        <section className="glass-panel-strong relative overflow-hidden rounded-[2rem] px-6 py-8 sm:px-8 lg:px-10">
          <div className="absolute inset-y-0 right-0 hidden w-80 bg-[radial-gradient(circle_at_center,rgba(157,77,45,0.14),transparent_68%)] lg:block" />
          <div className="relative grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.32em] text-[color:var(--muted)]">
                Vercel + OpenRouter
              </p>
              <h1 className="balance-text mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-[color:var(--foreground)] sm:text-5xl">
                Stage a room full of bots and watch the conversation unfold around the table.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[color:var(--ink-soft)] sm:text-lg">
                Configure a coordinator, pick any number of OpenRouter-backed members, assign each a persona,
                and route the same prompt through either sequential debate rounds or a parallel council pass. Each
                response is requested as conversational beats, then rendered as speech balloons in the chamber.
              </p>
            </div>

            <div className="grid gap-4">
              <div className="glass-panel rounded-2xl px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">OpenRouter Key</p>
                <p className="mono mt-2 text-sm text-[color:var(--foreground)]">
                  {hasApiKey ? maskApiKey(apiKey) : "Required"}
                </p>
                <button
                  type="button"
                  onClick={() => setShowKeyPrompt(true)}
                  className="mt-3 rounded-full border border-[color:var(--line)] px-3 py-1.5 text-sm text-[color:var(--muted)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
                >
                  {hasApiKey ? "Change key" : "Add key"}
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                <UsageBadge label="Prompt Tokens" value={usage.promptTokens} />
                <UsageBadge label="Completion Tokens" value={usage.completionTokens} />
                <UsageBadge label="Total Tokens" value={usage.totalTokens} />
              </div>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-8 xl:grid-cols-[1.05fr_0.95fr]">
          <form onSubmit={handleSubmit} className="space-y-6">
            <section className="glass-panel-strong rounded-[1.8rem] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--muted)]">
                    Run Settings
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">Council configuration</h2>
                </div>
                <div className="flex rounded-full border border-[color:var(--line)] bg-white/50 p-1">
                  {(["debate", "council"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setConfig((current) => ({ ...current, mode }))}
                      className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
                        config.mode === mode
                          ? "bg-[color:var(--accent)] text-white shadow-lg shadow-[rgba(157,77,45,0.18)]"
                          : "text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid gap-5">
                <FieldShell
                  label="Main Prompt"
                  hint="This is the question every member receives, either through a live debate or an independent council pass."
                >
                  <textarea
                    className="field min-h-36 resize-y"
                    value={config.prompt}
                    onChange={(event) => setConfig((current) => ({ ...current, prompt: event.target.value }))}
                    placeholder="What should the council deliberate?"
                  />
                </FieldShell>

                <FieldShell
                  label="Shared System Directive"
                  hint="This shared system instruction is prepended for every participant before their individual persona."
                >
                  <textarea
                    className="field min-h-32 resize-y"
                    value={config.sharedDirective}
                    onChange={(event) =>
                      setConfig((current) => ({ ...current, sharedDirective: event.target.value }))
                    }
                  />
                </FieldShell>

                <div className="grid gap-5 md:grid-cols-3">
                  <FieldShell
                    label="Rounds"
                    hint={config.mode === "debate" ? "Each round lets every member speak once." : "Used only in debate mode."}
                  >
                    <input
                      className="field"
                      type="number"
                      min={1}
                      max={6}
                      value={config.rounds}
                      onChange={(event) =>
                        setConfig((current) => ({ ...current, rounds: Number(event.target.value) || 1 }))
                      }
                    />
                  </FieldShell>

                  <FieldShell label="Temperature">
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={config.temperature}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          temperature: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </FieldShell>

                  <FieldShell label="Max Completion Tokens">
                    <input
                      className="field"
                      type="number"
                      min={200}
                      max={4000}
                      step={50}
                      value={config.maxCompletionTokens}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          maxCompletionTokens: Number(event.target.value) || 200,
                        }))
                      }
                    />
                  </FieldShell>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <ParticipantCard
                title="Coordinator"
                participant={config.coordinator}
                modelListId={modelListId}
                onChange={updateCoordinator}
              />
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 px-1">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--muted)]">
                    Council Members
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">Active roster</h2>
                </div>
                <button
                  type="button"
                  onClick={addMember}
                  className="rounded-full bg-[color:var(--accent-strong)] px-4 py-2 text-sm font-medium text-white transition hover:translate-y-[-1px] hover:bg-[color:var(--accent)]"
                >
                  Add member
                </button>
              </div>

              <div className="grid gap-4">
                {config.members.map((member) => (
                  <ParticipantCard
                    key={member.id}
                    title="Council member"
                    participant={member}
                    modelListId={modelListId}
                    onChange={(patch) => updateMember(member.id, patch)}
                    onRemove={() => removeMember(member.id)}
                    removable={config.members.length > 1}
                  />
                ))}
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isRunning || !hasLoadedKey || !hasApiKey}
                className="rounded-full bg-[color:var(--accent-strong)] px-5 py-3 text-sm font-medium text-white transition hover:translate-y-[-1px] hover:bg-[color:var(--accent)] disabled:cursor-wait disabled:opacity-60"
              >
                {isRunning ? "Running council..." : hasApiKey ? `Run ${config.mode}` : "Add OpenRouter key"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfig(createDefaultInput());
                  setResult(null);
                  setError(null);
                }}
                className="rounded-full border border-[color:var(--line)] px-5 py-3 text-sm font-medium text-[color:var(--muted)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
              >
                Reset defaults
              </button>
            </div>
          </form>

          <aside className="space-y-6">
            <section className="glass-panel-strong rounded-[1.8rem] p-6">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--muted)]">
                Result
              </p>
              <h2 className="mt-1 text-2xl font-semibold">Council output</h2>
              <p className="mt-3 text-sm leading-6 text-[color:var(--ink-soft)]">
                Debate mode runs a coordinator opening, sequential member turns, and a final synthesis. Council
                mode collects independent responses in parallel and asks the coordinator for a consensus, all in
                short spoken beats that are split into balloons with a hidden delimiter.
              </p>
            </section>

            {statusMessage ? (
              <section className="glass-panel rounded-[1.6rem] p-5">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--muted)]">
                  Live Status
                </p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--ink-soft)]">{statusMessage}</p>
              </section>
            ) : null}

            {error ? (
              <section className="rounded-[1.6rem] border border-red-300/70 bg-red-50/90 p-5 text-red-900">
                <p className="text-sm font-medium uppercase tracking-[0.2em]">Run Error</p>
                <p className="mt-2 text-sm leading-6">{error}</p>
              </section>
            ) : null}

            {result?.warnings.length ? (
              <section className="rounded-[1.6rem] border border-amber-300/70 bg-amber-50/90 p-5 text-amber-950">
                <p className="text-sm font-medium uppercase tracking-[0.2em]">Warnings</p>
                <div className="mt-3 space-y-2 text-sm leading-6">
                  {result.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              </section>
            ) : null}

            {result ? (
              result.mode === "debate" ? (
                <DebateView
                  opening={result.opening}
                  rounds={result.rounds}
                  synthesis={result.synthesis}
                  roster={result.roster}
                />
              ) : (
                <CouncilView
                  councilResponses={result.councilResponses}
                  consensus={result.consensus}
                  pendingMembers={pendingCouncilMembers}
                  roster={result.roster}
                />
              )
            ) : (
              <section className="glass-panel rounded-[1.8rem] p-6">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--muted)]">
                  Awaiting run
                </p>
                <p className="mt-3 text-sm leading-6 text-[color:var(--ink-soft)]">
                  Add your prompt, choose the coordinator and member models, set each persona, and run the
                  workflow. You will see the chamber populate with bot seats and speech balloons here.
                </p>
              </section>
            )}
          </aside>
        </div>
      </div>

      {hasLoadedKey && showKeyPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,28,26,0.42)] p-4 backdrop-blur-sm">
          <section className="glass-panel-strong w-full max-w-xl rounded-[1.8rem] p-6">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-[color:var(--muted)]">
              OpenRouter Key Required
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Add your API key to start using the council</h2>
            <p className="mt-3 text-sm leading-6 text-[color:var(--ink-soft)]">
              The key is stored in this browser only and used for direct OpenRouter requests from the client. You
              can change it later from the top panel.
            </p>

            <div className="mt-5">
              <FieldShell label="OpenRouter API Key">
                <input
                  className="field mono"
                  type="password"
                  autoFocus
                  value={draftApiKey}
                  onChange={(event) => setDraftApiKey(event.target.value)}
                  placeholder="sk-or-v1-..."
                />
              </FieldShell>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveApiKey}
                className="rounded-full bg-[color:var(--accent-strong)] px-5 py-3 text-sm font-medium text-white transition hover:translate-y-[-1px] hover:bg-[color:var(--accent)]"
              >
                Save key
              </button>
              {hasApiKey ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraftApiKey(apiKey);
                    setShowKeyPrompt(false);
                  }}
                  className="rounded-full border border-[color:var(--line)] px-5 py-3 text-sm font-medium text-[color:var(--muted)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
