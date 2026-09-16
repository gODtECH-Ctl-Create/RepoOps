import { createHash } from "node:crypto";

export const EVENT_SCHEMA_VERSION = 1;
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const dayCount = (value) => positiveId(value) && value <= 36500;
const oneOf = (...values) => (value) => values.includes(value);
const states = oneOf("waiting-for-ci", "waiting-for-author", "waiting-for-review", "changes-requested", "blocked", "ready-for-maintainer", "unknown");
const action = oneOf("claim", "unclaim", "block", "remind", "expire", "classify-pr");

const definitions = {
  "issue.claimed": { resource: "issue", metadata: { assigneeId: positiveId } },
  "issue.unclaimed": { resource: "issue", metadata: { assigneeId: positiveId } },
  "issue.blocked": { resource: "issue", metadata: { reasonCode: oneOf("dependency", "maintainer", "external", "other") } },
  "assignment.reminder_sent": { resource: "issue", metadata: { assigneeId: positiveId, assignmentEventId: positiveId, window: positiveId, reminderAfterDays: dayCount } },
  "assignment.expired": { resource: "issue", metadata: { assigneeId: positiveId, assignmentEventId: positiveId, expireAfterDays: dayCount } },
  "pull_request.state_changed": { resource: "pull_request", metadata: { from: states, to: states } },
  "operation.failed": { metadata: { action, reasonCode: oneOf("github-api-error", "invalid-state", "invalid-configuration", "permission-denied", "unknown") } },
  "operation.ambiguous": { metadata: { action, reasonCode: oneOf("unknown-mutation-result", "conflicting-evidence", "malformed-receipt") } },
  "github.issue.assigned": { resource: "issue", github: ["issues", "assigned"], metadata: { assigneeId: positiveId } },
  "github.issue.unassigned": { resource: "issue", github: ["issues", "unassigned"], metadata: { assigneeId: positiveId } },
  "github.issue.closed": { resource: "issue", github: ["issues", "closed"], metadata: {} },
  "github.pull_request.merged": { resource: "pull_request", github: ["pull_request", "closed"], metadata: {} }
};
export const EVENT_TYPES = Object.freeze(Object.keys(definitions));

export class EventValidationError extends Error {
  constructor(path) { super(`Invalid operational event field: ${path}`); this.name = "EventValidationError"; }
}
export class EventConflictError extends Error {
  constructor() { super("Conflicting operational events share an identity; preserve both for investigation"); this.name = "EventConflictError"; }
}

function requireField(condition, path) {
  if (!condition) throw new EventValidationError(path);
}
function record(value, keys, path) {
  requireField(value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)), path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireField(Reflect.ownKeys(descriptors).length === keys.length && keys.every((key) => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], "value") && descriptors[key].enumerable), path);
}
function timestamp(value) {
  requireField(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), "timestamp");
  const normalized = new Date(value).toISOString();
  requireField(normalized.replace(".000Z", "Z") === value.replace(".000Z", "Z"), "timestamp");
  return normalized;
}
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  return Object.freeze(value);
}
function canonical(value) {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Validate caller-supplied facts, derive identity, and return a detached immutable event. */
export function createOperationalEvent(input) {
  record(input, ["schemaVersion", "type", "timestamp", "repository", "actor", "resource", "source", "metadata"], "envelope");
  requireField(input.schemaVersion === EVENT_SCHEMA_VERSION, "schemaVersion");
  requireField(typeof input.type === "string" && Object.hasOwn(definitions, input.type), "type");
  const definition = definitions[input.type];
  record(input.repository, ["id", "fullName"], "repository");
  requireField(positiveId(input.repository.id), "repository.id");
  requireField(typeof input.repository.fullName === "string" && input.repository.fullName.length <= 256 && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(input.repository.fullName), "repository.fullName");
  record(input.actor, ["kind", "id"], "actor");
  requireField(["user", "bot", "system"].includes(input.actor.kind), "actor.kind");
  requireField(input.actor.kind === "system" ? input.actor.id === null : positiveId(input.actor.id), "actor.id");
  record(input.resource, ["type", "id", "number"], "resource");
  requireField(["issue", "pull_request"].includes(input.resource.type) && (!definition.resource || definition.resource === input.resource.type), "resource.type");
  requireField(positiveId(input.resource.id) && positiveId(input.resource.number), "resource.identity");
  if (definition.github) {
    record(input.source, ["kind", "eventName", "action", "eventId"], "source");
    requireField(input.source.kind === "github" && input.source.eventName === definition.github[0] && input.source.action === definition.github[1] && positiveId(input.source.eventId), "source.github");
  } else {
    record(input.source, ["kind", "operationKey", "occurrence"], "source");
    requireField(input.source.kind === "repoops" && positiveId(input.source.occurrence) && typeof input.source.operationKey === "string" && /^[a-f0-9]{64}$/.test(input.source.operationKey), "source.repoops");
  }
  record(input.metadata, Object.keys(definition.metadata), "metadata");
  for (const [key, validate] of Object.entries(definition.metadata)) requireField(validate(input.metadata[key]), `metadata.${key}`);
  if (input.type === "pull_request.state_changed") requireField(input.metadata.from !== input.metadata.to, "metadata.transition");
  if (input.type.startsWith("operation.")) requireField((input.metadata.action === "classify-pr") === (input.resource.type === "pull_request"), "metadata.action");
  const event = {
    schemaVersion: input.schemaVersion,
    type: input.type,
    timestamp: timestamp(input.timestamp),
    repository: { ...input.repository }, actor: { ...input.actor }, resource: { ...input.resource }, source: { ...input.source }, metadata: { ...input.metadata }
  };
  // Names, content and wall-clock retry time never supply event identity.
  const identity = [event.schemaVersion, event.type, event.repository.id, event.resource.type, event.resource.id, event.source];
  return freeze({ id: `roe1_${createHash("sha256").update(canonical(identity)).digest("hex")}`, ...event });
}

/** Validate an already serialized event, including its derived identity. */
export function validateOperationalEvent(input) {
  record(input, ["id", "schemaVersion", "type", "timestamp", "repository", "actor", "resource", "source", "metadata"], "envelope");
  const { id, ...facts } = input;
  const event = createOperationalEvent(facts);
  requireField(id === event.id, "id");
  return event;
}

/** Pure append-only projection helper, not a database or atomic store. */
export function appendOperationalEvent(history, input) {
  requireField(Array.isArray(history), "history");
  const events = [];
  const identities = new Map();
  for (const raw of [...history, input]) {
    const event = validateOperationalEvent(raw);
    const serialized = canonical(event);
    if (identities.has(event.id)) {
      if (identities.get(event.id) !== serialized) throw new EventConflictError();
      continue;
    }
    identities.set(event.id, serialized);
    events.push(event);
  }
  return Object.freeze(events);
}
