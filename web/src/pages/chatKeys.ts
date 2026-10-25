type ReplyKey = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'keyCode'>

/** Enter confirms IME input or inserts a line on touch devices; only a desktop reply uses it to send. */
export function sendsReply(event: ReplyKey, coarsePointer: boolean): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !coarsePointer
}
