import './secret.css'

export interface SecretInputProps {
  type: 'text' | 'password'
  autoComplete?: 'off'
  spellCheck?: false
  'data-secret'?: ''
  'data-1p-ignore'?: ''
  'data-lpignore'?: 'true'
  'data-bwignore'?: ''
}

function masksText(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('-webkit-text-security', 'disc')
}

/**
 * The attributes of a key, token or password field (BTN-633). Chrome and Edge offer to save any `type="password"` field
 * once its form is sent or it leaves the page, `autocomplete="off"` notwithstanding; so where the browser can draw the dots
 * itself (`-webkit-text-security`, `secret.css`) the field is text, and only where it cannot does it stay a password.
 * The `data-*ignore` attributes keep 1Password, LastPass and Bitwarden away too.
 */
export function secretInput(secret = true, masks = masksText()): SecretInputProps {
  if (!secret) return { type: 'text' }
  const shared = { autoComplete: 'off', spellCheck: false, 'data-1p-ignore': '', 'data-lpignore': 'true', 'data-bwignore': '' } as const
  return masks ? { type: 'text', 'data-secret': '', ...shared } : { type: 'password', ...shared }
}
