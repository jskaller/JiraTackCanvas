/**
 * Pure helpers for moving a pin and superseding its screenshot (D33).
 *
 * Shared by the web trigger (attachment name, comment text, version bump), the
 * issue panel (which screenshot is newest) and the unit suite. No I/O and no
 * Forge imports, so both the Node tests and the UI resolver can use it.
 */

/** A pointer that travelled no further than this did not really move (D33). */
export const MOVE_COMMENT_THRESHOLD_PX = 4;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function movedBeyondThreshold(pixels) {
  const value = Number(pixels);
  return Number.isFinite(value) && value > MOVE_COMMENT_THRESHOLD_PX;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function partsIn(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });
  const parts = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
  });
  return parts;
}

function utcParts(date) {
  // Intl is present on every runtime we ship, but a comment must never fail to
  // render because a runtime is stripped down.
  return {
    day: String(date.getUTCDate()),
    month: MONTHS[date.getUTCMonth()],
    year: String(date.getUTCFullYear()),
    hour: pad2(date.getUTCHours()),
    minute: pad2(date.getUTCMinutes()),
    timeZoneName: 'UTC',
  };
}

/**
 * ICU only names some zones. Where the short name is a numeric offset
 * ("GMT-5"), a named abbreviation usually exists in the other English locale
 * ("EST"), which is what a reviewer expects to read. Zones with no English
 * abbreviation anywhere (India, Japan) keep the exact offset.
 */
function resolveZoneName(date, timeZone, name) {
  if (!/^GMT[+-]/.test(name)) return name;
  try {
    const alt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName');
    if (alt && /^[A-Za-z]{2,6}$/.test(alt.value)) return alt.value;
  } catch (e) {
    // keep the numeric offset
  }
  return name;
}

function assemble(parts, date, timeZone) {
  const zoneName = resolveZoneName(date, timeZone, parts.timeZoneName);
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${zoneName}`;
}

/**
 * "2 Nov 2026, 17:42 GMT" in the reviewer's zone.
 *
 * `fallback` is true when the zone was missing or not an IANA id and UTC was
 * used instead; the rendered text then says UTC, so the comment never implies a
 * precision it does not have.
 */
export function formatMoveTime(at, timeZone) {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) {
    return { text: '', timeZone: 'UTC', fallback: true };
  }

  const requested = typeof timeZone === 'string' && timeZone.trim().length > 0
    ? timeZone.trim()
    : null;

  if (requested) {
    try {
      return {
        text: assemble(partsIn(date, requested), date, requested),
        timeZone: requested,
        fallback: false,
      };
    } catch (e) {
      // Not an IANA zone (or no ICU data): fall through to UTC below.
    }
  }

  try {
    return {
      text: assemble(partsIn(date, 'UTC'), date, 'UTC'),
      timeZone: 'UTC',
      fallback: true,
    };
  } catch (e) {
    return { text: assemble(utcParts(date), date, 'UTC'), timeZone: 'UTC', fallback: true };
  }
}

/**
 * The comment the app posts after a move. Web triggers have no user identity,
 * so the mover's name lives in the text rather than in the comment author.
 */
export function buildPinMoveComment({ displayName, at, timeZone }) {
  const name = typeof displayName === 'string' && displayName.trim().length > 0
    ? displayName.trim()
    : 'a reviewer';
  const when = formatMoveTime(at, timeZone);
  if (!when.text) return `Pin moved and screenshot updated by ${name}.`;
  return `Pin moved and screenshot updated by ${name} on ${when.text}`;
}

function sanitiseKey(issueKey) {
  return String(issueKey || 'issue').replace(/[^A-Za-z0-9_-]/g, '_');
}

/** `jiratack-<key>-<timestamp>.png` (D33). Timestamp is epoch milliseconds. */
export function screenshotFilename(issueKey, timestamp) {
  const millis = Number(timestamp);
  const stamp = Number.isFinite(millis) && millis > 0 ? Math.floor(millis) : Date.now();
  return `jiratack-${sanitiseKey(issueKey)}-${stamp}.png`;
}

/**
 * The epoch milliseconds encoded in a superseding screenshot filename, or null
 * for an original `jiratack-<key>.<ext>` attachment or any other file.
 */
export function screenshotTimestamp(filename, issueKey) {
  if (typeof filename !== 'string' || filename.length === 0) return null;
  if (typeof issueKey !== 'string' || issueKey.length === 0) return null;
  const key = sanitiseKey(issueKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^jiratack-${key}-(\\d{10,16})\\.[a-z0-9]+$`, 'i').exec(filename);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Counts superseding screenshots. Absent on tickets created before D33. */
export function nextScreenshotVersion(value) {
  const current = Number.isInteger(value) && value > 0 ? value : 0;
  return current + 1;
}
