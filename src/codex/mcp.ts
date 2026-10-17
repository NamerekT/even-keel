/**
 * The tracker's MCP server for a Codex session, as `-c mcp_servers.<name>.…` overrides of the turn: Codex's own
 * `config.toml` is never written. The server is the one of the tracker's Claude Code plugin (`plugins/<name>/.mcp.json`);
 * the credentials stay out of the command line — a stdio server gets them by name (`env_vars`) from the turn's
 * environment, an HTTP one through `bearer_token_env_var`.
 */
export function mcpArgs(name: string, server: unknown, variables: readonly string[]): string[] {
  if (typeof server !== 'object' || server === null) return []
  const { command, args, env, url, headers } = server as Record<string, unknown>
  const set = (key: string, value: string) => ['-c', `mcp_servers.${name}.${key}=${value}`]
  if (typeof command === 'string') {
    return [
      ...set('command', JSON.stringify(command)),
      ...(Array.isArray(args) ? set('args', JSON.stringify(args.map(String))) : []),
      ...(isStrings(env) && Object.keys(env).length > 0 ? set('env', table(env)) : []),
      ...(variables.length > 0 ? set('env_vars', JSON.stringify(variables)) : []),
    ]
  }
  if (typeof url !== 'string') return []
  const plain: Record<string, string> = {}
  let bearer: string | undefined
  for (const [header, value] of Object.entries(isStrings(headers) ? headers : {})) {
    const variable = /^Bearer \$\{(\w+)\}$/.exec(value)?.[1]
    if (header.toLowerCase() === 'authorization' && variable !== undefined) bearer = variable
    else plain[header] = value
  }
  return [
    ...set('url', JSON.stringify(url)),
    ...(bearer === undefined ? [] : set('bearer_token_env_var', JSON.stringify(bearer))),
    ...(Object.keys(plain).length > 0 ? set('http_headers', table(plain)) : []),
  ]
}

/** A TOML inline table; a JSON string is a valid TOML basic string. */
function table(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`)
    .join(',')}}`
}

function isStrings(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && Object.values(value).every((each) => typeof each === 'string')
}
