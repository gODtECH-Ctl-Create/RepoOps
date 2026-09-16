export function parseCommand(body = "") {
  const trimmed = body.trim();
  if (!trimmed.startsWith("/")) return null;

  const [name, ...args] = trimmed.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args
  };
}

export function commandEnabled(config, commandName) {
  const key = commandName.replace(/^\//, "");
  return config?.commands?.[key] !== false;
}

export function routeCommand(body, config) {
  const command = parseCommand(body);
  if (!command) return { type: "ignore", reason: "not-command" };

  if (!["/claim", "/unclaim"].includes(command.name)) {
    return { type: "ignore", reason: "unknown-command", command: command.name };
  }

  if (!commandEnabled(config, command.name)) {
    return { type: "ignore", reason: "command-disabled", command: command.name };
  }

  return { type: "command", command };
}
