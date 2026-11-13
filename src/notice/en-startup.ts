export const STARTUP_NOTICES = {
  'config.notJson': (p: { file: string }) => `config: ${p.file} is not JSON`,
  'config.port': (p: { value: string }) => `config: EVEN_KEEL_PORT must be an integer in 1..65535, got ${p.value}`,
  'server.rebindFailed': (p: { address: string; current: string }) => `server: cannot listen on ${p.address} from .env, staying on ${p.current}`,
  'config.mcpPort': (p: { value: string }) => `config: EVEN_KEEL_MCP_PORT must be an integer in 1..65535, got ${p.value}`,
  'config.branch': (p: { where: string; value: string }) => `config: ${p.where} must be a branch name, got ${p.value}`,
  'config.changelogPath': (p: { where: string; value: string }) =>
    `config: ${p.where} must be a file path inside the repository, got ${p.value}`,
  'config.projects': () => 'config: projects must be a list of project records',
  'config.projectEntry': (p: { where: string }) => `config: ${p.where} must be an object with the project's id, key and repo`,
  'config.projectKey': (p: { where: string; value: string }) =>
    `config: ${p.where} must be a project key (a capital letter, then up to 4 capitals, digits or _), not ${p.value}`,
  'config.projectId': (p: { where: string }) => `config: ${p.where} must be the project's id; Even Keel writes one into an entry that has none`,
  'config.projectTwice': (p: { field: string; value: string; first: string; second: string }) =>
    `config: the ${p.field} ${p.value} is given twice, at ${p.first} and at ${p.second}`,
  'config.version': (p: { value: string }) => `config: version must be a whole number, not ${p.value}`,
  'storage.newer': (p: { file: string; version: number; known: number }) =>
    `storage: ${p.file} is from a newer version of Even Keel (schema ${p.version}, this one knows up to ${p.known}); ` +
    'put back its *.bak copy or update Even Keel',
  'storage.held': (p: { pid: number; file: string }) => `storage: process ${p.pid} holds the database in ${p.file}; wait for it to finish or close the other Even Keel instance`,
  'storage.damaged': (p: { file: string }) => `storage: ${p.file} cannot be read, so nothing was migrated`,
  'storage.unknownProject': (p: { file: string; project: string }) =>
    `storage: ${p.file} names the project ${p.project}, which the config does not have, so nothing was migrated`,
  'storage.writeFailed': (p: { file: string }) => `storage: could not write ${p.file}; the files written before it are put back from their copies`,
  'storage.newerDatabase': (p: { file: string; version: number; known: number }) =>
    `storage: the database ${p.file} is from a newer version of Even Keel (schema ${p.version}, this one knows up to ${p.known}); update Even Keel`,
  'storage.importFailed': (p: { file: string }) => `storage: could not move the state files into ${p.file}; no database was made and the files are as they were`,
}
