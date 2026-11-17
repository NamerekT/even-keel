export interface RemoteProtection {
  remote: string
  branch: string
  /** `unavailable`: the server's plan gives this repository no branch protection at all (EKR-121). */
  status: 'protected' | 'unprotected' | 'unknown' | 'unavailable'
  bypass: boolean
  url: string
}
