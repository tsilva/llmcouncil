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
  type ParticipantConfig,
  type RunInput,
  type RunResult,
} from "@/lib/council";
import { runCouncilWorkflow, type RunProgressEvent } from "@/lib/council-engine";

const OPENROUTER_KEY_STORAGE = "llmcouncil.openrouter.key";

type PlaybackFrame = {
  id: string;
  turnId: string;
  speakerId: string;
  speakerName: string;
  kind: CouncilTurn["kind"];
  round?: number;
  model: string;
  persona: string;
  bubbleId: string;
  bubbleContent: string;
  bubbleIndex: number;
  bubbleCount: number;
  chapterLabel: string;
  timestampMs: number;
  durationMs: number;
};

type TimelineChapter = {
  id: string;
  frameIndex: number;
  label: string;
  timestampMs: number;
};

function maskApiKey(value: string): string {
  if (value.length <= 10) {
    return "Saved";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function kindLabel(kind: CouncilTurn["kind"]): string {
  return kind.replace(/_/g, " ");
}

function chapterLabelForTurn(turn: CouncilTurn): string {
  if (turn.kind === "opening") {
    return "Opening";
  }

  if (turn.kind === "synthesis") {
    return "Synthesis";
  }

  if (turn.kind === "consensus") {
    return "Consensus";
  }

  if (turn.round) {
    return `Round ${turn.round}`;
  }

  return kindLabel(turn.kind);
}

function formatClock(valueMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function frameDuration(content: string): number {
  return Math.min(4200, Math.max(1400, 900 + content.length * 22));
}

function flattenTurns(result: RunResult | null): CouncilTurn[] {
  if (!result) {
    return [];
  }

  if (result.mode === "debate") {
    return [
      ...(result.opening ? [result.opening] : []),
      ...(result.rounds?.flatMap((round) => round.turns) ?? []),
      ...(result.synthesis ? [result.synthesis] : []),
    ];
  }

  return [...(result.councilResponses ?? []), ...(result.consensus ? [result.consensus] : [])];
}

function buildPlaybackTimeline(result: RunResult | null): {
  chapters: TimelineChapter[];
  frames: PlaybackFrame[];
  totalDurationMs: number;
} {
  const turns = flattenTurns(result);
  const chapters: TimelineChapter[] = [];
  const frames: PlaybackFrame[] = [];
  let elapsedMs = 0;

  for (const turn of turns) {
    const chapterLabel = chapterLabelForTurn(turn);
    const bubbles = turn.bubbles.length > 0 ? turn.bubbles : [{ id: `${turn.id}-fallback`, content: turn.content }];
    chapters.push({
      id: turn.id,
      frameIndex: frames.length,
      label: `${chapterLabel} · ${turn.speakerName}`,
      timestampMs: elapsedMs,
    });

    bubbles.forEach((bubble, bubbleIndex) => {
      const durationMs = frameDuration(bubble.content);
      frames.push({
        id: `${turn.id}-${bubble.id}`,
        turnId: turn.id,
        speakerId: turn.speakerId,
        speakerName: turn.speakerName,
        kind: turn.kind,
        round: turn.round,
        model: turn.model,
        persona: turn.persona,
        bubbleId: bubble.id,
        bubbleContent: bubble.content,
        bubbleIndex,
        bubbleCount: bubbles.length,
        chapterLabel,
        timestampMs: elapsedMs,
        durationMs,
      });
      elapsedMs += durationMs;
    });
  }

  return {
    chapters,
    frames,
    totalDurationMs: elapsedMs,
  };
}

function seatPosition(index: number, total: number): { left: number; top: number } {
  const angle = ((index / Math.max(total, 1)) * Math.PI * 2) - Math.PI / 2;
  const radiusX = total <= 4 ? 34 : 38;
  const radiusY = total <= 4 ? 25 : 30;

  return {
    left: 50 + Math.cos(angle) * radiusX,
    top: 50 + Math.sin(angle) * radiusY,
  };
}

function bubblePlacement(position: { left: number; top: number }): {
  className: string;
  style: React.CSSProperties;
} {
  if (position.top <= 26) {
    return {
      className: "stage-bubble-center",
      style: {
        left: "50%",
        top: "8%",
        transform: "translateX(-50%)",
      },
    };
  }

  if (position.left < 50) {
    return {
      className: "stage-bubble-left",
      style: {
        left: `${Math.min(position.left + 13, 56)}%`,
        top: `${Math.max(position.top - 15, 24)}%`,
      },
    };
  }

  return {
    className: "stage-bubble-right",
    style: {
      right: `${Math.min(100 - position.left + 13, 56)}%`,
      top: `${Math.max(position.top - 15, 24)}%`,
    },
  };
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

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 3.4h3l.5 2.2a7.8 7.8 0 0 1 1.6.9l2.1-.9 2.1 2.1-.9 2.1c.35.5.65 1.03.9 1.6l2.2.5v3l-2.2.5a7.8 7.8 0 0 1-.9 1.6l.9 2.1-2.1 2.1-2.1-.9c-.5.35-1.03.65-1.6.9l-.5 2.2h-3l-.5-2.2a7.8 7.8 0 0 1-1.6-.9l-2.1.9-2.1-2.1.9-2.1a7.8 7.8 0 0 1-.9-1.6l-2.2-.5v-3l2.2-.5c.24-.57.54-1.1.9-1.6l-.9-2.1 2.1-2.1 2.1.9a7.8 7.8 0 0 1 1.6-.9l.5-2.2Z"
      />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}

function ParticipantSettingsSheet({
  roleLabel,
  participant,
  modelListId,
  onChange,
  onClose,
  onRemove,
}: {
  roleLabel: string;
  participant: ParticipantConfig;
  modelListId: string;
  onChange: (patch: Partial<ParticipantConfig>) => void;
  onClose: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(6,9,12,0.54)] backdrop-blur-sm">
      <button type="button" className="flex-1 cursor-default" aria-label="Close member settings" onClick={onClose} />
      <aside className="settings-sheet w-full max-w-lg border-l border-[color:var(--line)] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">{roleLabel}</p>
            <h2 className="mt-2 text-2xl font-semibold text-[color:var(--foreground)]">{participant.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[color:var(--line)] px-3 py-1.5 text-sm text-[color:var(--muted)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--foreground)]"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-5">
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
            hint="Pick a suggestion or enter any OpenRouter model id."
          >
            <input
              className="field mono"
              list={modelListId}
              value={participant.model}
              onChange={(event) => onChange({ model: event.target.value })}
              placeholder="openai/gpt-5.4"
            />
          </FieldShell>

          <FieldShell label="Persona">
            <textarea
              className="field min-h-40 resize-y"
              value={participant.persona}
              onChange={(event) => onChange({ persona: event.target.value })}
              placeholder="How should this participant think and argue?"
            />
          </FieldShell>
        </div>

        {onRemove ? (
          <div className="mt-6 border-t border-[color:var(--line)] pt-5">
            <button
              type="button"
              onClick={onRemove}
              className="rounded-full border border-red-500/35 px-4 py-2 text-sm font-medium text-red-200 transition hover:border-red-400 hover:bg-red-500/10 hover:text-white"
            >
              Remove from council
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ChamberStage({
  roster,
  currentFrame,
  chapters,
  frames,
  activeFrameIndex,
  totalDurationMs,
  isRunning,
  isPlaybackActive,
  statusMessage,
  error,
  warnings,
  prompt,
  hasRun,
  onOpenParticipant,
  onSelectFrame,
  onTogglePlayback,
}: {
  roster: ParticipantConfig[];
  currentFrame?: PlaybackFrame;
  chapters: TimelineChapter[];
  frames: PlaybackFrame[];
  activeFrameIndex: number;
  totalDurationMs: number;
  isRunning: boolean;
  isPlaybackActive: boolean;
  statusMessage: string | null;
  error: string | null;
  warnings: string[];
  prompt: string;
  hasRun: boolean;
  onOpenParticipant: (id: string) => void;
  onSelectFrame: (index: number) => void;
  onTogglePlayback: () => void;
}) {
  const speakingIndex = currentFrame
    ? Math.max(
        roster.findIndex((participant) => participant.id === currentFrame.speakerId),
        0,
      )
    : 0;
  const speakingPosition = seatPosition(speakingIndex, roster.length);
  const bubble = currentFrame
    ? bubblePlacement(speakingPosition)
    : {
        className: "stage-bubble-center",
        style: {
          left: "50%",
          top: "12%",
          transform: "translateX(-50%)",
        },
      };
  const currentTimeMs = currentFrame?.timestampMs ?? 0;
  const currentChapter =
    chapters.reduce<TimelineChapter | null>((match, chapter) => {
      if (chapter.frameIndex <= activeFrameIndex) {
        return chapter;
      }

      return match;
    }, null) ?? chapters[0] ?? null;
  const playbackLabel = currentFrame
    ? `${currentFrame.chapterLabel} · ${currentFrame.speakerName}`
    : isRunning
      ? "Waiting for the first line"
      : "Ready to stage the chamber";

  return (
    <section className="chamber-shell">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[color:var(--muted)]">LLM Council</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[color:var(--foreground)] sm:text-4xl">
            The table is the whole show.
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="status-chip">{isRunning ? "Live" : hasRun ? "Replay" : "Standby"}</span>
          {statusMessage ? <span className="status-chip status-chip-muted">{statusMessage}</span> : null}
        </div>
      </div>

      <div className="stage-frame">
        <div className="stage-header">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--muted)]">Prompt</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--foreground)]">
              {prompt.trim() || "Set the prompt below, then run the council."}
            </p>
          </div>
          <div className="stage-metadata">
            <span>{playbackLabel}</span>
            {currentFrame ? (
              <span className="mono">
                {currentFrame.bubbleIndex + 1}/{currentFrame.bubbleCount}
              </span>
            ) : null}
          </div>
        </div>

        <div className="cinema-stage">
          <div className="cinema-vignette" />
          <div className="council-floor-glow" />
          <div className="hero-table-shadow" />
          <div className="hero-table">
            <div className="hero-table-inner" />
          </div>

          {roster.map((participant, index) => {
            const position = seatPosition(index, roster.length);
            const isSpeaking = participant.id === currentFrame?.speakerId;

            return (
              <div
                key={participant.id}
                className={`stage-seat ${isSpeaking ? "is-active" : ""}`}
                style={{
                  left: `${position.left}%`,
                  top: `${position.top}%`,
                }}
              >
                <button
                  type="button"
                  className="seat-config-button"
                  onClick={() => onOpenParticipant(participant.id)}
                  aria-label={`Configure ${participant.name}`}
                >
                  <SettingsGlyph />
                </button>
                <div className="stage-avatar" aria-hidden="true">
                  <span className="stage-eye stage-eye-left" />
                  <span className="stage-eye stage-eye-right" />
                  <span className="stage-mouth" />
                </div>
                <div className="stage-seat-meta">
                  <span className="stage-seat-name">{participant.name}</span>
                  <span className="stage-seat-model mono">{participant.model}</span>
                </div>
              </div>
            );
          })}

          <div className={`stage-bubble ${bubble.className}`} style={bubble.style}>
            {currentFrame ? (
              <article key={currentFrame.id} className="stage-bubble-card">
                <p className="stage-bubble-speaker">
                  {currentFrame.speakerName}
                  <span>{kindLabel(currentFrame.kind)}</span>
                </p>
                <p className="stage-bubble-copy">{currentFrame.bubbleContent}</p>
              </article>
            ) : (
              <article className="stage-bubble-card stage-bubble-card-muted">
                <p className="stage-bubble-speaker">
                  Chamber
                  <span>idle</span>
                </p>
                <p className="stage-bubble-copy">
                  {isRunning
                    ? "The room is live. The first speech bubble will land here as soon as the coordinator responds."
                    : "Seat each member, set the prompt, then run the council to watch the debate unfold in realtime."}
                </p>
              </article>
            )}
          </div>
        </div>

        <div className="subtitle-ribbon">
          <p className="subtitle-label">
            {currentFrame ? `${currentFrame.speakerName} · ${currentFrame.chapterLabel}` : "Playback"}
          </p>
          <p className="subtitle-copy">
            {currentFrame?.persona ||
              "Each speaker keeps their own persona, while the chamber timeline lets you replay the entire exchange."}
          </p>
        </div>

        <div className="timeline-shell">
          <div className="timeline-controls">
            <button
              type="button"
              onClick={() => onSelectFrame(Math.max(activeFrameIndex - 1, 0))}
              disabled={isRunning || frames.length < 2 || activeFrameIndex === 0}
              className="timeline-button"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={onTogglePlayback}
              disabled={frames.length === 0 || isRunning}
              className="timeline-button timeline-button-primary"
            >
              {isPlaybackActive ? "Pause" : activeFrameIndex >= frames.length - 1 ? "Replay" : "Play"}
            </button>
            <button
              type="button"
              onClick={() => onSelectFrame(Math.min(activeFrameIndex + 1, Math.max(frames.length - 1, 0)))}
              disabled={isRunning || frames.length < 2 || activeFrameIndex >= frames.length - 1}
              className="timeline-button"
            >
              Next
            </button>
            <div className="timeline-clock mono">
              <span>{formatClock(currentTimeMs)}</span>
              <span>/</span>
              <span>{formatClock(totalDurationMs)}</span>
            </div>
          </div>

          <div className="timeline-track-shell">
            <div className="timeline-marker-row" aria-hidden="true">
              {chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  type="button"
                  className="timeline-marker"
                  style={{
                    left:
                      totalDurationMs > 0 ? `${Math.min((chapter.timestampMs / totalDurationMs) * 100, 100)}%` : "0%",
                  }}
                  onClick={() => onSelectFrame(chapter.frameIndex)}
                  disabled={frames.length === 0 || isRunning}
                  title={chapter.label}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(frames.length - 1, 0)}
              value={Math.min(activeFrameIndex, Math.max(frames.length - 1, 0))}
              onChange={(event) => onSelectFrame(Number(event.target.value))}
              disabled={frames.length < 2 || isRunning}
              className="timeline-slider"
              aria-label="Playback timeline"
            />
          </div>

          <div className="timeline-caption">
            <span>{isRunning ? "Timeline fills live as the debate lands." : "Scrub any beat once the run is complete."}</span>
            {currentChapter ? <span>{currentChapter.label}</span> : null}
          </div>
        </div>

        {error ? <div className="notice-row notice-row-error">{error}</div> : null}
        {warnings.length ? (
          <div className="notice-row notice-row-warning">{warnings[warnings.length - 1]}</div>
        ) : null}
      </div>
    </section>
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
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [isPlaybackActive, setIsPlaybackActive] = useState(false);

  const roster = [config.coordinator, ...config.members];
  const usage = result?.usage ?? emptyUsage();
  const hasApiKey = apiKey.trim().length > 0;
  const timeline = buildPlaybackTimeline(result);
  const frames = timeline.frames;
  const chapters = timeline.chapters;
  const totalDurationMs = timeline.totalDurationMs;
  const currentFrame = frames[Math.min(activeFrameIndex, Math.max(frames.length - 1, 0))];
  const editableParticipant = roster.find((participant) => participant.id === activeEditorId) ?? null;

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

  useEffect(() => {
    if (activeEditorId && !editableParticipant) {
      setActiveEditorId(null);
    }
  }, [activeEditorId, editableParticipant]);

  useEffect(() => {
    if (frames.length === 0) {
      if (activeFrameIndex !== 0) {
        setActiveFrameIndex(0);
      }
      return;
    }

    if (activeFrameIndex > frames.length - 1) {
      setActiveFrameIndex(frames.length - 1);
    }
  }, [activeFrameIndex, frames.length]);

  useEffect(() => {
    if (!isRunning && isPlaybackActive && frames.length > 0 && activeFrameIndex >= frames.length - 1) {
      setIsPlaybackActive(false);
    }
  }, [activeFrameIndex, frames.length, isPlaybackActive, isRunning]);

  useEffect(() => {
    const shouldAdvance = isRunning || isPlaybackActive;
    if (!shouldAdvance || frames.length === 0 || activeFrameIndex >= frames.length - 1) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActiveFrameIndex((current) => Math.min(current + 1, frames.length - 1));
    }, frames[activeFrameIndex]?.durationMs ?? 1600);

    return () => window.clearTimeout(timeoutId);
  }, [activeFrameIndex, frames, isPlaybackActive, isRunning]);

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

  function openParticipantEditor(id: string) {
    setActiveEditorId(id);
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

  function selectFrame(index: number) {
    setActiveFrameIndex(index);
    if (!isRunning) {
      setIsPlaybackActive(false);
    }
  }

  function togglePlayback() {
    if (frames.length === 0) {
      return;
    }

    if (activeFrameIndex >= frames.length - 1) {
      setActiveFrameIndex(0);
      setIsPlaybackActive(true);
      return;
    }

    setIsPlaybackActive((current) => !current);
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
    setActiveFrameIndex(0);
    setIsPlaybackActive(true);
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
        onProgress: (progressEvent) => {
          applyProgressEvent(progressEvent);
        },
      });

      setResult(payload);
      setStatusMessage(config.mode === "debate" ? "Debate complete." : "Council consensus complete.");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "The council run failed.");
      setStatusMessage(null);
      setIsPlaybackActive(false);
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

  return (
    <main className="studio-page">
      <datalist id={modelListId}>
        {MODEL_SUGGESTIONS.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>

      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-8 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <ChamberStage
          roster={roster}
          currentFrame={currentFrame}
          chapters={chapters}
          frames={frames}
          activeFrameIndex={Math.min(activeFrameIndex, Math.max(frames.length - 1, 0))}
          totalDurationMs={totalDurationMs}
          isRunning={isRunning}
          isPlaybackActive={isPlaybackActive}
          statusMessage={statusMessage}
          error={error}
          warnings={result?.warnings ?? []}
          prompt={config.prompt}
          hasRun={Boolean(result)}
          onOpenParticipant={openParticipantEditor}
          onSelectFrame={selectFrame}
          onTogglePlayback={togglePlayback}
        />

        <form onSubmit={handleSubmit} className="director-dock">
          <div className="director-bar">
            <div className="director-copy">
              <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">Director Dock</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
                Keep setup lean. Tune the room only when needed.
              </h2>
            </div>

            <div className="director-actions">
              <div className="director-chip">
                <span>API key</span>
                <button type="button" onClick={() => setShowKeyPrompt(true)} className="director-chip-action mono">
                  {hasApiKey ? maskApiKey(apiKey) : "Add key"}
                </button>
              </div>
              <div className="director-chip">
                <span>Prompt tokens</span>
                <strong>{usage.promptTokens.toLocaleString()}</strong>
              </div>
              <div className="director-chip">
                <span>Total tokens</span>
                <strong>{usage.totalTokens.toLocaleString()}</strong>
              </div>
            </div>
          </div>

          <div className="director-grid">
            <section className="director-panel director-panel-main">
              <FieldShell label="Prompt" hint="This is the single question the whole room is responding to.">
                <textarea
                  className="field min-h-36 resize-y"
                  value={config.prompt}
                  onChange={(event) => setConfig((current) => ({ ...current, prompt: event.target.value }))}
                  placeholder="What should the council deliberate?"
                />
              </FieldShell>

              <div className="mt-5 flex flex-wrap gap-3">
                <div className="mode-toggle">
                  {(["debate", "council"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setConfig((current) => ({ ...current, mode }))}
                      className={`mode-toggle-button ${config.mode === mode ? "is-selected" : ""}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={isRunning || !hasLoadedKey || !hasApiKey}
                  className="action-button action-button-primary"
                >
                  {isRunning ? "Running live..." : `Run ${config.mode}`}
                </button>

                <button
                  type="button"
                  onClick={addMember}
                  className="action-button"
                >
                  Add member
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setConfig(createDefaultInput());
                    setResult(null);
                    setError(null);
                    setStatusMessage(null);
                    setActiveFrameIndex(0);
                    setIsPlaybackActive(false);
                  }}
                  className="action-button"
                >
                  Reset
                </button>
              </div>
            </section>

            <section className="director-panel">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">Seats</p>
                  <h3 className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">Open settings per member</h3>
                </div>
              </div>

              <div className="member-grid">
                {roster.map((participant, index) => (
                  <button
                    key={participant.id}
                    type="button"
                    onClick={() => openParticipantEditor(participant.id)}
                    className="member-card"
                  >
                    <div className="member-card-top">
                      <span className="member-role">{index === 0 ? "Coordinator" : `Member ${index}`}</span>
                      <span className="member-settings-inline">
                        <SettingsGlyph />
                      </span>
                    </div>
                    <strong className="member-name">{participant.name}</strong>
                    <span className="member-model mono">{participant.model}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <details className="director-panel director-details">
            <summary>Advanced run settings</summary>
            <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
              <FieldShell
                label="Shared Directive"
                hint="Prepended for every participant before their individual persona."
              >
                <textarea
                  className="field min-h-32 resize-y"
                  value={config.sharedDirective}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, sharedDirective: event.target.value }))
                  }
                />
              </FieldShell>

              <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
                <FieldShell
                  label="Rounds"
                  hint={config.mode === "debate" ? "Each round gives every member one turn." : "Used only in debate mode."}
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
          </details>
        </form>
      </div>

      {hasLoadedKey && showKeyPrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,9,12,0.6)] p-4 backdrop-blur-sm">
          <section className="settings-sheet w-full max-w-xl p-6">
            <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">OpenRouter Key</p>
            <h2 className="mt-2 text-2xl font-semibold text-[color:var(--foreground)]">Store the key in this browser</h2>
            <p className="mt-3 text-sm leading-6 text-[color:var(--ink-soft)]">
              Requests go directly from the client to OpenRouter. The key stays local to this browser and can be changed any time.
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
              <button type="button" onClick={saveApiKey} className="action-button action-button-primary">
                Save key
              </button>
              {hasApiKey ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraftApiKey(apiKey);
                    setShowKeyPrompt(false);
                  }}
                  className="action-button"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {editableParticipant ? (
        <ParticipantSettingsSheet
          roleLabel={editableParticipant.id === config.coordinator.id ? "Coordinator" : "Council member"}
          participant={editableParticipant}
          modelListId={modelListId}
          onChange={(patch) => {
            if (editableParticipant.id === config.coordinator.id) {
              updateCoordinator(patch);
              return;
            }

            updateMember(editableParticipant.id, patch);
          }}
          onClose={() => setActiveEditorId(null)}
          onRemove={
            editableParticipant.id === config.coordinator.id || config.members.length === 1
              ? undefined
              : () => {
                  removeMember(editableParticipant.id);
                  setActiveEditorId(null);
                }
          }
        />
      ) : null}
    </main>
  );
}
