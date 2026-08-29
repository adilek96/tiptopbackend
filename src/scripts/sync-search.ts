import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { MEILISEARCH_MODULE } from "../modules/meilisearch"
import type MeilisearchModuleService from "../modules/meilisearch/service"

const BATCH_SIZE = 200

/**
 * Полная переиндексация каталога.
 *
 *   npx medusa exec ./src/scripts/sync-search.ts
 *
 * Нужна при первом запуске, после массовой загрузки товаров и после
 * изменения настроек индекса.
 */
export default async function syncSearch({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const search: MeilisearchModuleService = container.resolve(MEILISEARCH_MODULE)

  if (!search.isEnabled()) {
    logger.error("Meilisearch не настроен — переиндексация невозможна")
    return
  }

  await search.ensureIndex()

  const productModuleService = container.resolve(Modules.PRODUCT)

  let offset = 0
  let indexed = 0

  for (;;) {
    const products = await productModuleService.listProducts(
      { status: ProductStatus.PUBLISHED },
      {
        relations: ["variants", "tags", "categories", "collection"],
        skip: offset,
        take: BATCH_SIZE,
        order: { id: "ASC" },
      }
    )

    if (!products.length) {
      break
    }

    await search.upsertProducts(products)
    indexed += products.length
    offset += products.length

    logger.info(`Проиндексировано товаров: ${indexed}`)

    if (products.length < BATCH_SIZE) {
      break
    }
  }

  logger.info(`Готово. Всего в индексе опубликованных товаров: ${indexed}`)
}
