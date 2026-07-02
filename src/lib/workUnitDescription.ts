/**
 * Splits a work-unit / JIRA description that embeds "Acceptance Criteria:" and
 * "Verification:" sections into structured parts, so those live in dedicated
 * fields rather than being duplicated inside the description text.
 *
 * Recognizes the two headings case-insensitively at the start of a line. When
 * neither heading is present the description is returned unchanged with null
 * structured fields (safe no-op for plain descriptions).
 */
export interface ParsedWorkUnitDescription {
  description: string | null;
  acceptanceCriteria: string | null;
  verification: string | null;
}

// Matches the "Acceptance Criteria:" / "Verification:" headings anywhere
// (case-insensitive), whether followed by text on the same line or below.
const AC_INLINE = /acceptance criteria\s*:/i;
const VER_INLINE = /verification\s*:/i;

function nullIfBlank(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export function parseWorkUnitDescription(
  raw: string | null | undefined
): ParsedWorkUnitDescription {
  if (!raw || raw.trim().length === 0) {
    return { description: null, acceptanceCriteria: null, verification: null };
  }

  const acMatch = raw.match(AC_INLINE);
  const verMatch = raw.match(VER_INLINE);

  // No AC/Verification headings at all -> leave the description untouched.
  if (!acMatch && !verMatch) {
    return {
      description: nullIfBlank(raw),
      acceptanceCriteria: null,
      verification: null,
    };
  }

  const acStart = acMatch?.index ?? -1;
  const verStart = verMatch?.index ?? -1;

  // The lead text (before the first heading) becomes the description.
  const firstHeading = [acStart, verStart].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const description = nullIfBlank(raw.slice(0, firstHeading));

  const sliceSection = (
    start: number,
    marker: RegExpMatchArray | null,
    nextStart: number
  ): string | null => {
    if (start < 0 || !marker) return null;
    const afterMarker = start + marker[0].length;
    const end = nextStart > start ? nextStart : raw.length;
    return nullIfBlank(raw.slice(afterMarker, end));
  };

  // Determine section boundaries based on heading order (usually AC then Verification).
  let acceptanceCriteria: string | null = null;
  let verification: string | null = null;

  if (acStart >= 0 && verStart >= 0) {
    if (acStart < verStart) {
      acceptanceCriteria = sliceSection(acStart, acMatch, verStart);
      verification = sliceSection(verStart, verMatch, -1);
    } else {
      verification = sliceSection(verStart, verMatch, acStart);
      acceptanceCriteria = sliceSection(acStart, acMatch, -1);
    }
  } else if (acStart >= 0) {
    acceptanceCriteria = sliceSection(acStart, acMatch, -1);
  } else if (verStart >= 0) {
    verification = sliceSection(verStart, verMatch, -1);
  }

  return { description, acceptanceCriteria, verification };
}

/** True when a description embeds AC/Verification worth extracting. */
export function hasEmbeddedAcOrVerification(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return AC_INLINE.test(raw) || VER_INLINE.test(raw);
}
