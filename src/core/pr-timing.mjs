const MAINTAINER_WAITING_STATES = new Set(["waiting-for-review", "ready-for-maintainer"]);
const AUTHOR_WAITING_STATES = new Set(["waiting-for-author", "changes-requested"]);
const KNOWN_STATES = new Set([
  "waiting-for-ci",
  "waiting-for-author",
  "waiting-for-review",
  "changes-requested",
  "blocked",
  "ready-for-maintainer",
  "unknown"
]);

function parseTimestamp(value) {
  if (typeof value !== "string") return null;

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/
  );
  if (!match) return null;

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    timezone
  ] = match;

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (
    month < 1 || month > 12
    || day < 1
    || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    return null;
  }

  if (timezone !== "Z") {
    const offsetHours = Number(timezone.slice(1, 3));
    const offsetMinutes = Number(timezone.slice(4, 6));

    if (offsetHours > 23 || offsetMinutes > 59) return null;
  }

  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;

  return timestamp.toISOString();
}

function validEvent(event) {
  return event !== null
    && typeof event === "object"
    && typeof event.state === "string"
    && KNOWN_STATES.has(event.state)
    && parseTimestamp(event.timestamp) !== null;
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter(validEvent)
    .map((event, index) => ({
      state: event.state,
      timestamp: parseTimestamp(event.timestamp),
      index
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.index - b.index);
}

function duration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null;
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}

function response(startedAt, endedAt) {
  const milliseconds = duration(startedAt, endedAt);
  if (milliseconds === null) return null;
  return { milliseconds, startedAt, endedAt };
}

function safeUnknown(now) {
  return {
    currentState: "unknown",
    currentStateSince: null,
    reviewAge: null,
    authorWaitAge: null,
    responseLatency: { maintainer: null, author: null },
    invalidNow: true
  };
}

/**
 * Calculate current PR waiting ages and the most recent author/maintainer response latencies.
 *
 * `events` must be normalized state transitions derived from explicit GitHub timestamps/events.
 * The helper intentionally performs no network access and ignores malformed events.
 */
export function calculatePullRequestTiming({ now, events = [] } = {}) {
  const normalizedNow = parseTimestamp(now);
  if (!normalizedNow) return safeUnknown(now);

  const history = normalizeEvents(events).filter((event) => event.timestamp <= normalizedNow);
  if (!history.length) {
    return {
      currentState: "unknown",
      currentStateSince: null,
      reviewAge: null,
      authorWaitAge: null,
      responseLatency: { maintainer: null, author: null },
      invalidNow: false
    };
  }

  const latest = history.at(-1);
  let maintainerWaitStartedAt = null;
  let authorWaitStartedAt = null;
  let latestMaintainerResponse = null;
  let latestAuthorResponse = null;

  for (const event of history) {
    if (MAINTAINER_WAITING_STATES.has(event.state)) {
      if (authorWaitStartedAt) {
        latestAuthorResponse = response(authorWaitStartedAt, event.timestamp);
      }
      authorWaitStartedAt = null;
      maintainerWaitStartedAt = event.timestamp;
      continue;
    }

    if (AUTHOR_WAITING_STATES.has(event.state)) {
      if (maintainerWaitStartedAt) {
        latestMaintainerResponse = response(maintainerWaitStartedAt, event.timestamp);
      }
      maintainerWaitStartedAt = null;
      authorWaitStartedAt = event.timestamp;
      continue;
    }

    if (event.state === "unknown" || event.state === "waiting-for-ci" || event.state === "blocked") {
      maintainerWaitStartedAt = null;
      authorWaitStartedAt = null;
    }
  }

  return {
    currentState: latest.state,
    currentStateSince: latest.timestamp,
    reviewAge: maintainerWaitStartedAt ? duration(maintainerWaitStartedAt, normalizedNow) : null,
    authorWaitAge: authorWaitStartedAt ? duration(authorWaitStartedAt, normalizedNow) : null,
    responseLatency: {
      maintainer: latestMaintainerResponse,
      author: latestAuthorResponse
    },
    invalidNow: false
  };
}
