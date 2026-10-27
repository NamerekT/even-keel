import { fail } from '../notice/notice.js'
import type { ProfilesControl } from './routes.js'
import type { Profiles } from './service.js'

/** Profile commands of the page; project locking stays with the service. */
export function profilesControl(profiles: Profiles, checkLink: (project: string) => void): ProfilesControl {
  return {
    check: (draft) => profiles.check(draft),
    save: async (draft) => {
      const id = await profiles.save(draft)
      console.log(`page: the profile ${profiles.current().profiles.find((profile) => profile.id === id)?.name} is saved`)
      return id
    },
    remove: (id) => {
      const name = profiles.current().profiles.find((profile) => profile.id === id)?.name
      profiles.remove(id)
      console.log(`page: the profile ${name} is removed`)
    },
    setDefault: (id) => profiles.setDefault(id),
    setRules: (id, rules) => {
      profiles.setRules(id, rules)
      console.log(`page: the chain rules of the profile ${profiles.current().profiles.find((profile) => profile.id === id)?.name} are saved`)
    },
    link: (project, profile) => {
      checkLink(project)
      profiles.link(project, profile)
    },
    projects: (id, query) => profiles.projects(id, query),
  }
}
