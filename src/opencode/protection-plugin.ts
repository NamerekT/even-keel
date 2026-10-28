type Action = 'allow' | 'ask' | 'deny'
type PermissionMap = Record<string, Action | Record<string, Action>>
type Permission = Action | PermissionMap
interface Config {
  permission?: Permission
  agent?: Record<string, { permission?: Permission }>
}
interface Rules { bash: string[]; tools: string[] }

/** OpenCode loads this module inside its process. Only the plugin factory may be exported. */
export const server = async (_input: unknown, rules: Rules) => ({
  async config(config: Config): Promise<void> {
    const overlay = (permission: Permission = {}) => {
      const result: PermissionMap = typeof permission === 'string' ? { '*': permission } : { ...permission }
      if (rules.bash.length > 0) {
        const bash = result.bash
        const commands: Record<string, Action> = typeof bash === 'string' ? { '*': bash } : { ...bash }
        for (const pattern of rules.bash) {
          delete commands[pattern]
          commands[pattern] = 'deny'
        }
        // A pre-existing '*' tool rule or bash allow must come before these command denies.
        delete result.bash
        result.bash = commands
      }
      for (const tool of rules.tools) {
        delete result[tool]
        result[tool] = 'deny'
      }
      return result
    }
    config.permission = overlay(config.permission)
    for (const agent of Object.values(config.agent ?? {})) agent.permission = overlay(agent.permission)
  },
})
