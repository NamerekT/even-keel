/**
 * The MCP servers of the tracker adapters (`mcpServer`): Even Keel's plugin of a tracker is named for its server. Kept
 * apart with no imports, so the server's test holds it to `ADAPTERS` (`src/tracker/trackerServers.test.ts`).
 */
export const TRACKER_SERVERS = ['huly', 'github', 'linear', 'gitlab', 'jira', 'forgejo', 'tasks'] as const
