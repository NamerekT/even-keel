export interface RemoteProtection {
  remote: string
  branch: string
  status: 'protected' | 'unprotected' | 'unknown'
  bypass: boolean
  url: string
}
