/** The example paths of the page's fields, in the form of the service's machine (`EvenKeelState.platform`, BTN-634). */
export interface ExamplePaths {
  /** A project's checkout: the folder field of the wizard. */
  repo: string
  /** A checkout's old and new place: the moves table of the stats settings. */
  movedFrom: string
  movedTo: string
}

/** `win32` takes a drive, `darwin` the home under `/Users`; any other platform takes the Linux home. */
export function examplePaths(platform: string): ExamplePaths {
  const [home, projects] = platform === 'win32' ? ['D:', 'Projects'] : platform === 'darwin' ? ['/Users/john', 'Projects'] : ['/home/john', 'projects']
  return { repo: `${home}/${projects}/example`, movedFrom: `${home}/old/abc`, movedTo: `${home}/${projects}/abc` }
}
