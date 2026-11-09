/** A retry marker in Markdown: hidden when rendered, visible in the source and counted in its revision. */
export const markerComment = (marker: string): string => `<!-- even-keel:${marker} -->`

export function withMarker(description: string, marker: string | undefined): string {
  if (marker === undefined) return description
  return description.length === 0 ? markerComment(marker) : `${description}\n\n${markerComment(marker)}`
}
