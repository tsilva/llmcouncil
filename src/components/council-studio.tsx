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

function bubbleRevealIncrement(content: string): number {
  return Math.max(2, Math.ceil(content.length / 42));
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
  const leftStart = total <= 4 ? 18 : 12;
  const leftEnd = total <= 4 ? 82 : 88;
  const progress = total <= 1 ? 0.5 : index / (total - 1);

  return {
    left: leftStart + (leftEnd - leftStart) * progress,
    top: total <= 4 ? 30 : 28,
  };
}

function bubblePlacement(position: { left: number; top: number }, total: number): {
  className: string;
  style: React.CSSProperties;
} {
  const bubbleTop = Math.min(position.top + (total <= 4 ? 18 : 16), 72);

  return {
    className: "stage-bubble-track",
    style: {
      left: `${position.left}%`,
      top: `${bubbleTop}%`,
      transform: "translate(-50%, 0)",
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

function StudioSettingsModal({
  hasApiKey,
  apiKey,
  draftApiKey,
  config,
  onDraftApiKeyChange,
  onSaveApiKey,
  onClose,
  onConfigChange,
}: {
  hasApiKey: boolean;
  apiKey: string;
  draftApiKey: string;
  config: RunInput;
  onDraftApiKeyChange: (value: string) => void;
  onSaveApiKey: () => void;
  onClose: () => void;
  onConfigChange: (patch: Partial<RunInput>) => void;
}) {
  return (
    <div className="settings-modal-backdrop">
      {hasApiKey ? (
        <button type="button" className="settings-modal-dismiss" aria-label="Close settings" onClick={onClose} />
      ) : (
        <div className="settings-modal-dismiss" aria-hidden="true" />
      )}

      <section className="settings-sheet settings-modal-panel w-full max-w-3xl p-6 sm:p-7">
        <div className="settings-modal-header">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--muted)]">Council Settings</p>
            <h2 className="mt-2 text-2xl font-semibold text-[color:var(--foreground)]">Room controls and run options</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--ink-soft)]">
              Manage the local OpenRouter key and adjust the council-wide run settings from one place.
            </p>
          </div>

          {hasApiKey ? (
            <button type="button" onClick={onClose} className="action-button">
              Close
            </button>
          ) : null}
        </div>

        <div className="settings-stat-grid">
          <div className="settings-stat-card">
            <span>API key</span>
            <strong className="mono">{hasApiKey ? maskApiKey(apiKey) : "Missing"}</strong>
          </div>
        </div>

        <div className="settings-modal-grid">
          <div className="settings-modal-stack">
            <FieldShell
              label="OpenRouter API Key"
              hint="Stored locally in this browser. Requests go directly from the client to OpenRouter."
            >
              <input
                className="field mono"
                type="password"
                autoFocus={!hasApiKey}
                value={draftApiKey}
                onChange={(event) => onDraftApiKeyChange(event.target.value)}
                placeholder="sk-or-v1-..."
              />
            </FieldShell>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={onSaveApiKey} className="action-button action-button-primary">
                Save key
              </button>
              {hasApiKey ? (
                <button type="button" onClick={onClose} className="action-button">
                  Done
                </button>
              ) : null}
            </div>
          </div>

          <div className="settings-modal-stack">
            <FieldShell
              label="Shared Directive"
              hint="Prepended for every participant before their individual persona."
            >
              <textarea
                className="field min-h-32 resize-y"
                value={config.sharedDirective}
                onChange={(event) => onConfigChange({ sharedDirective: event.target.value })}
              />
            </FieldShell>

            <div className="settings-number-grid">
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
                  onChange={(event) => onConfigChange({ rounds: Number(event.target.value) || 1 })}
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
                  onChange={(event) => onConfigChange({ temperature: Number(event.target.value) || 0 })}
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
                  onChange={(event) => onConfigChange({ maxCompletionTokens: Number(event.target.value) || 200 })}
                />
              </FieldShell>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ChamberStage({
  roster,
  currentFrame,
  displayedBubbleContent,
  chapters,
  frames,
  activeFrameIndex,
  totalDurationMs,
  isRunning,
  isBubbleStreaming,
  error,
  warnings,
  mode,
  prompt,
  hasLoadedKey,
  hasApiKey,
  onOpenSettings,
  onModeChange,
  onPromptChange,
  onAddMember,
  onOpenParticipant,
  onSelectFrame,
}: {
  roster: ParticipantConfig[];
  currentFrame?: PlaybackFrame;
  displayedBubbleContent: string;
  chapters: TimelineChapter[];
  frames: PlaybackFrame[];
  activeFrameIndex: number;
  totalDurationMs: number;
  isRunning: boolean;
  isBubbleStreaming: boolean;
  error: string | null;
  warnings: string[];
  mode: RunInput["mode"];
  prompt: string;
  hasLoadedKey: boolean;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  onModeChange: (mode: RunInput["mode"]) => void;
  onPromptChange: (value: string) => void;
  onAddMember: () => void;
  onOpenParticipant: (id: string) => void;
  onSelectFrame: (index: number) => void;
}) {
  const seatPositions = roster.map((_, index) => seatPosition(index, roster.length));
  const activeSpeakerIndex = currentFrame
    ? Math.max(
        0,
        roster.findIndex((participant) => participant.id === currentFrame.speakerId),
      )
    : 0;
  const bubbleAnchor = seatPositions[activeSpeakerIndex] ?? { left: 50, top: 24 };
  const bubble = bubblePlacement(bubbleAnchor, roster.length);
  const currentTimeMs = currentFrame?.timestampMs ?? 0;
  const bubbleHintLabel = currentFrame
    ? isBubbleStreaming
      ? "to finish"
      : activeFrameIndex < frames.length - 1 || isRunning
        ? "to continue"
        : null
    : isRunning
      ? "to continue"
      : null;

  return (
    <section className="chamber-shell">
      <button
        type="button"
        onClick={onOpenSettings}
        className="stage-settings-button stage-settings-button-floating"
        aria-label="Open settings"
        title="Settings"
      >
        <SettingsGlyph />
      </button>

      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.28em] text-[color:var(--muted)]">LLM Council</p>
      </div>

      <div className="chamber-control-bar">
        <label className="chamber-prompt-shell" htmlFor="council-prompt">
          <input
            id="council-prompt"
            className="field chamber-prompt-input"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="What should the council deliberate?"
          />
        </label>

        <div className="chamber-control-actions">
          <div className="mode-toggle mode-toggle-compact">
            {(["debate", "council"] as const).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                onClick={() => onModeChange(nextMode)}
                className={`mode-toggle-button mode-toggle-button-compact ${mode === nextMode ? "is-selected" : ""}`}
              >
                {nextMode}
              </button>
            ))}
          </div>

          <button
            type="submit"
            disabled={isRunning || !hasLoadedKey || !hasApiKey}
            className="action-button action-button-primary action-button-compact"
          >
            {isRunning ? "Running..." : `Run ${mode}`}
          </button>

          <button type="button" onClick={onAddMember} className="action-button action-button-compact">
            Add member
          </button>
        </div>
      </div>

      <div className="stage-frame">
        <div className="timeline-shell">
          <div className="timeline-controls">
            <div className="timeline-meta">
              <div className="timeline-clock mono">
                <span>{formatClock(currentTimeMs)}</span>
                <span>/</span>
                <span>{formatClock(totalDurationMs)}</span>
              </div>
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
                  disabled={frames.length === 0}
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
              disabled={frames.length < 2}
              className="timeline-slider"
              aria-label="Playback timeline"
            />
          </div>
        </div>

        <div className="cinema-stage">
          <div className="cinema-vignette" />
          <div className="council-floor-glow" />

          {roster.map((participant, index) => {
            const position = seatPositions[index] ?? { left: 50, top: 24 };
            const isSpeaking = participant.id === currentFrame?.speakerId;

            return (
              <div
                key={participant.id}
                className={`stage-seat ${index === 0 ? "is-coordinator" : ""} ${isSpeaking ? "is-active" : ""}`}
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
                <p className={`stage-bubble-copy ${isBubbleStreaming ? "is-streaming" : ""}`}>
                  {displayedBubbleContent || "\u00a0"}
                </p>
                {bubbleHintLabel ? (
                  <div className="stage-bubble-footer">
                    <span className="stage-bubble-hint">
                      Hit <span className="stage-bubble-key">Space</span> {bubbleHintLabel}
                    </span>
                  </div>
                ) : null}
              </article>
            ) : isRunning ? (
              <article className="stage-bubble-card stage-bubble-card-muted">
                <p className="stage-bubble-speaker">
                  Chamber
                  <span>idle</span>
                </p>
                <p className="stage-bubble-copy">
                  The room is live. The first speech bubble will land here as soon as the coordinator responds.
                </p>
                {bubbleHintLabel ? (
                  <div className="stage-bubble-footer">
                    <span className="stage-bubble-hint">
                      Hit <span className="stage-bubble-key">Space</span> {bubbleHintLabel}
                    </span>
                  </div>
                ) : null}
              </article>
            ) : null}
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
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeEditorId, setActiveEditorId] = useState<string | null>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [completedBubbleIds, setCompletedBubbleIds] = useState<Record<string, true>>({});
  const [revealedBubbleId, setRevealedBubbleId] = useState<string | null>(null);
  const [revealedBubbleChars, setRevealedBubbleChars] = useState(0);
  const [queuedFrameIndex, setQueuedFrameIndex] = useState<number | null>(null);

  const roster = [config.coordinator, ...config.members];
  const hasApiKey = apiKey.trim().length > 0;
  const timeline = buildPlaybackTimeline(result);
  const frames = timeline.frames;
  const chapters = timeline.chapters;
  const totalDurationMs = timeline.totalDurationMs;
  const currentFrame = frames[Math.min(activeFrameIndex, Math.max(frames.length - 1, 0))];
  const editableParticipant = roster.find((participant) => participant.id === activeEditorId) ?? null;
  const isBubbleStreaming =
    Boolean(currentFrame) && revealedBubbleChars < (currentFrame?.bubbleContent.length ?? 0);
  const displayedBubbleContent = currentFrame
    ? currentFrame.bubbleContent.slice(0, Math.min(revealedBubbleChars, currentFrame.bubbleContent.length))
    : "";

  useEffect(() => {
    const storedKey = window.localStorage.getItem(OPENROUTER_KEY_STORAGE)?.trim() ?? "";
    if (storedKey) {
      setApiKey(storedKey);
      setDraftApiKey(storedKey);
      setShowSettingsModal(false);
    } else {
      setShowSettingsModal(true);
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
      if (queuedFrameIndex !== null) {
        setQueuedFrameIndex(null);
      }
      return;
    }

    if (activeFrameIndex > frames.length - 1) {
      setActiveFrameIndex(frames.length - 1);
    }
  }, [activeFrameIndex, frames.length, queuedFrameIndex]);

  useEffect(() => {
    if (!currentFrame) {
      if (revealedBubbleId !== null || revealedBubbleChars !== 0) {
        setRevealedBubbleId(null);
        setRevealedBubbleChars(0);
      }
      return;
    }

    if (revealedBubbleId !== currentFrame.id) {
      setRevealedBubbleId(currentFrame.id);
      setRevealedBubbleChars(completedBubbleIds[currentFrame.id] ? currentFrame.bubbleContent.length : 0);
    }
  }, [completedBubbleIds, currentFrame, revealedBubbleChars, revealedBubbleId]);

  useEffect(() => {
    if (!currentFrame || revealedBubbleChars < currentFrame.bubbleContent.length || completedBubbleIds[currentFrame.id]) {
      return;
    }

    setCompletedBubbleIds((current) => ({ ...current, [currentFrame.id]: true }));
  }, [completedBubbleIds, currentFrame, revealedBubbleChars]);

  useEffect(() => {
    if (!currentFrame || revealedBubbleId !== currentFrame.id) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRevealedBubbleChars((current) =>
        Math.min(current + bubbleRevealIncrement(currentFrame.bubbleContent), currentFrame.bubbleContent.length),
      );
    }, 18);

    return () => window.clearTimeout(timeoutId);
  }, [currentFrame, revealedBubbleChars, revealedBubbleId]);

  useEffect(() => {
    if (queuedFrameIndex === null || queuedFrameIndex >= frames.length) {
      return;
    }

    setActiveFrameIndex(queuedFrameIndex);
    setQueuedFrameIndex(null);
  }, [frames.length, queuedFrameIndex]);

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
    setShowSettingsModal(false);
    setError(null);
  }

  function selectFrame(index: number) {
    setActiveFrameIndex(index);
    setQueuedFrameIndex(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasApiKey) {
      setShowSettingsModal(true);
      setError("Enter your OpenRouter API key before running the council.");
      return;
    }

    setError(null);
    setActiveFrameIndex(0);
    setCompletedBubbleIds({});
    setQueuedFrameIndex(null);
    setRevealedBubbleId(null);
    setRevealedBubbleChars(0);
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
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "The council run failed.");
    } finally {
      setIsRunning(false);
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.key === " " || event.code === "Space" || event.key === "ArrowRight") {
        event.preventDefault();

        if (currentFrame && revealedBubbleChars < currentFrame.bubbleContent.length) {
          setRevealedBubbleId(currentFrame.id);
          setRevealedBubbleChars(currentFrame.bubbleContent.length);
          setCompletedBubbleIds((current) => ({ ...current, [currentFrame.id]: true }));
          return;
        }

        if (frames.length === 0) {
          if (isRunning) {
            setQueuedFrameIndex(0);
          }
          return;
        }

        const nextIndex = activeFrameIndex + 1;
        if (nextIndex < frames.length) {
          setQueuedFrameIndex(null);
          setActiveFrameIndex(nextIndex);
          return;
        }

        if (isRunning) {
          setQueuedFrameIndex(nextIndex);
        }
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (activeFrameIndex === 0) {
          return;
        }

        setQueuedFrameIndex(null);
        setActiveFrameIndex((current) => Math.max(current - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFrameIndex, currentFrame, frames.length, isRunning, revealedBubbleChars]);

  function applyProgressEvent(event: RunProgressEvent) {
    if (event.type === "status") {
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

      <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-[90rem] flex-col gap-5 px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
        <ChamberStage
          roster={roster}
          currentFrame={currentFrame}
          displayedBubbleContent={displayedBubbleContent}
          chapters={chapters}
          frames={frames}
          activeFrameIndex={Math.min(activeFrameIndex, Math.max(frames.length - 1, 0))}
          totalDurationMs={totalDurationMs}
          isRunning={isRunning}
          isBubbleStreaming={isBubbleStreaming}
          error={error}
          warnings={result?.warnings ?? []}
          mode={config.mode}
          prompt={config.prompt}
          hasLoadedKey={hasLoadedKey}
          hasApiKey={hasApiKey}
          onOpenSettings={() => setShowSettingsModal(true)}
          onModeChange={(mode) => setConfig((current) => ({ ...current, mode }))}
          onPromptChange={(prompt) => setConfig((current) => ({ ...current, prompt }))}
          onAddMember={addMember}
          onOpenParticipant={openParticipantEditor}
          onSelectFrame={selectFrame}
        />
      </form>

      {hasLoadedKey && showSettingsModal ? (
        <StudioSettingsModal
          hasApiKey={hasApiKey}
          apiKey={apiKey}
          draftApiKey={draftApiKey}
          config={config}
          onDraftApiKeyChange={setDraftApiKey}
          onSaveApiKey={saveApiKey}
          onClose={() => {
            setDraftApiKey(apiKey);
            setShowSettingsModal(false);
          }}
          onConfigChange={(patch) => setConfig((current) => ({ ...current, ...patch }))}
        />
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
