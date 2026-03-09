export interface ParticipantPersonaProfile {
  role: string;
  personality: string;
  gender: string;
  nationality: string;
  birthDate: string;
  promptNotes: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createPersonaProfile(
  overrides: Partial<ParticipantPersonaProfile> = {},
): ParticipantPersonaProfile {
  return {
    role: "",
    personality: "",
    gender: "",
    nationality: "",
    birthDate: "",
    promptNotes: "",
    ...overrides,
  };
}

export function clonePersonaProfile(profile: ParticipantPersonaProfile): ParticipantPersonaProfile {
  return { ...profile };
}

export function normalizePersonaProfile(
  value: unknown,
  fallbackPromptNotes = "",
): ParticipantPersonaProfile {
  const raw = (value ?? {}) as Record<string, unknown>;

  return createPersonaProfile({
    role: normalizeText(raw.role),
    personality: normalizeText(raw.personality),
    gender: normalizeText(raw.gender),
    nationality: normalizeText(raw.nationality),
    birthDate: normalizeText(raw.birthDate),
    promptNotes: normalizeText(raw.promptNotes) || fallbackPromptNotes,
  });
}

export function hasPersonaProfileContent(profile: ParticipantPersonaProfile): boolean {
  return Object.values(profile).some((value) => value.trim().length > 0);
}

export function buildPersonaProfilePrompt(profile: ParticipantPersonaProfile): string {
  const lines = [
    profile.role ? `Role: ${profile.role}` : "",
    profile.personality ? `Personality: ${profile.personality}` : "",
    profile.gender ? `Gender: ${profile.gender}` : "",
    profile.nationality ? `Nationality: ${profile.nationality}` : "",
    profile.birthDate ? `Birth date: ${profile.birthDate}` : "",
    profile.promptNotes ? `Additional guidance: ${profile.promptNotes}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

export function buildPersonaProfileSummary(profile: ParticipantPersonaProfile): string {
  const parts = [
    profile.role,
    profile.personality,
    profile.gender,
    profile.nationality,
    profile.birthDate ? `Born ${profile.birthDate}` : "",
    profile.promptNotes,
  ].filter(Boolean);

  return parts.join(" • ");
}

export function buildPersonaProfilePreview(profile: ParticipantPersonaProfile): string {
  const parts = [
    profile.role,
    profile.personality,
    profile.gender,
    profile.nationality,
    profile.birthDate ? `Born ${profile.birthDate}` : "",
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" • ");
  }

  return profile.promptNotes;
}
