import { constants, readdirSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

export interface TemplateFiles {
  dir: string
  directories: string[]
  files: string[]
}

/** Scan a closed, immutable cluster once, rather than stat every file on every copy. */
export function templateFiles(dir: string): TemplateFiles {
  const directories = ['']
  const files: string[] = []
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const path = relative(dir, join(entry.parentPath, entry.name))
    if (entry.isDirectory()) directories.push(path)
    else if (entry.isFile()) files.push(path)
    else throw new Error(`test template: expected a regular file or directory: ${path}`)
  }
  return { dir, directories, files }
}

export async function copyTemplate(template: TemplateFiles, destination: string): Promise<void> {
  await Promise.all(template.directories.map((path) => mkdir(join(destination, path), { recursive: true })))
  await Promise.all(template.files.map((path) => copyFile(join(template.dir, path), join(destination, path), constants.COPYFILE_FICLONE)))
}
