/** The models a model field offers (`useModels`): the input names it by `list`, and nothing is rendered without any. */
export function ModelOffers({ id, models }: { id: string; models: readonly string[] }) {
  if (models.length === 0) return null
  return (
    <datalist id={id}>
      {models.map((model) => (
        <option key={model} value={model} />
      ))}
    </datalist>
  )
}
