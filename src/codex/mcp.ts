import { gatewayName, type SessionMcp } from '../agent/contract.js'

/**
 * The gateway's servers for a Codex turn, as `-c mcp_servers.<name>.url=…` overrides: Codex's own `config.toml` is
 * never written, and the turn holds no credentials — the gateway adds them. A JSON string is a valid TOML basic string.
 */
export function mcpArgs(servers: readonly SessionMcp[]): string[] {
  return servers.flatMap((server) => ['-c', `mcp_servers.${gatewayName(server)}.url=${JSON.stringify(server.url)}`])
}
