interface Item {
  id: string
  open: boolean
}

export function focusAfterClose(before: Item[], after: Item[], focus: string): string | null {
  if (before.find((block) => block.id === focus)?.open !== true) return null
  const index = after.findIndex((block) => block.id === focus)
  if (index < 0 || after[index]!.open) return null
  return after.slice(index + 1).find((block) => block.open)?.id ?? null
}
