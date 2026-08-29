import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules, ProductStatus } from "@medusajs/framework/utils"
import { MEILISEARCH_MODULE } from "../modules/meilisearch"
import type MeilisearchModuleService from "../modules/meilisearch/service"

/** Событие приходит либо с одним id, либо с массивом. */
function toIds(data: { id: string } | { id: string }[] | undefined): string[] {
  if (!data) {
    return []
  }
  return (Array.isArray(data) ? data : [data]).map((item) => item.id).filter(Boolean)
}

/**
 * Держит индекс Meilisearch в согласии с каталогом.
 *
 * В индекс попадают только опубликованные товары: снятый с публикации
 * или удалённый товар из индекса убирается, иначе он продолжал бы
 * находиться поиском на витрине.
 */
export default async function productChangedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string } | { id: string }[]>) {
  const search: MeilisearchModuleService = container.resolve(MEILISEARCH_MODULE)

  if (!search.isEnabled()) {
    return
  }

  const ids = toIds(event.data)
  if (!ids.length) {
    return
  }

  if (event.name === "product.deleted") {
    await search.deleteProducts(ids)
    return
  }

  const productModuleService = container.resolve(Modules.PRODUCT)

  const products = await productModuleService.listProducts(
    { id: ids },
    { relations: ["variants", "tags", "categories", "collection"] }
  )

  const published = products.filter((p) => p.status === ProductStatus.PUBLISHED)
  const unpublished = products
    .filter((p) => p.status !== ProductStatus.PUBLISHED)
    .map((p) => p.id)

  // Товар мог быть удалён между событием и этим запросом — тогда его
  // просто нет в выборке, и из индекса он тоже должен исчезнуть.
  const missing = ids.filter((id) => !products.some((p) => p.id === id))

  await search.upsertProducts(published)
  await search.deleteProducts([...unpublished, ...missing])
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated", "product.deleted"],
}
