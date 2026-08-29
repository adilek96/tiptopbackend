import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
  QueryContext,
} from "@medusajs/framework/utils"
import { MEILISEARCH_MODULE } from "../../../../modules/meilisearch"
import type MeilisearchModuleService from "../../../../modules/meilisearch/service"

const LIMIT = 20

export type PosVariant = {
  variant_id: string
  product_id: string
  product_title: string
  variant_title: string
  sku: string | null
  barcode: string | null
  thumbnail: string | null
  unit_price: number | null
  currency_code: string | null
}

/**
 * GET /admin/pos/search?q=...
 *
 * Поиск товара для кассы. Сканер штрихкодов работает как клавиатура: он
 * вводит код и жмёт Enter, поэтому отдельного режима не нужно — сначала
 * пробуем найти точное совпадение по артикулу или штрихкоду, и только
 * если не нашли, ищем по названию через Meilisearch.
 *
 * Цены считает сервер по региону магазина: то, что пришло из браузера
 * кассира, для расчёта суммы не используется нигде.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const term = String(req.query.q ?? "").trim()

  if (!term) {
    res.json({ variants: [] })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const productModuleService = req.scope.resolve(Modules.PRODUCT)
  const storeModuleService = req.scope.resolve(Modules.STORE)

  const [store] = await storeModuleService.listStores()
  const regionId = store?.default_region_id
  const currencyCode =
    store?.supported_currencies?.find((c: any) => c.is_default)?.currency_code ??
    store?.supported_currencies?.[0]?.currency_code

  if (!regionId) {
    res.status(400).json({
      message:
        "У магазина не задан регион по умолчанию — без него не посчитать цены. Проверьте настройки магазина.",
    })
    return
  }

  // --- Сначала точное совпадение: артикул или штрихкод -----------------------

  let productIds: string[] = []
  let exactVariantIds: string[] = []

  const byCode = await productModuleService.listProductVariants(
    { $or: [{ sku: term }, { barcode: term }, { ean: term }, { upc: term }] } as any,
    { take: LIMIT, select: ["id", "product_id"] }
  )

  if (byCode.length) {
    exactVariantIds = byCode.map((v) => v.id)
    productIds = [...new Set(byCode.map((v) => v.product_id!).filter(Boolean))]
  } else {
    const search: MeilisearchModuleService = req.scope.resolve(MEILISEARCH_MODULE)
    const { hits } = await search.search(term, { limit: LIMIT })
    productIds = hits.map((hit) => hit.id)
  }

  if (!productIds.length) {
    res.json({ variants: [] })
    return
  }

  // --- Достаём варианты вместе с рассчитанной ценой -------------------------

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "thumbnail",
      "status",
      "variants.id",
      "variants.title",
      "variants.sku",
      "variants.barcode",
      "variants.calculated_price.calculated_amount",
      "variants.calculated_price.currency_code",
    ],
    filters: { id: productIds },
    context: {
      variants: {
        calculated_price: QueryContext({
          region_id: regionId,
          currency_code: currencyCode,
        }),
      },
    },
  })

  const variants: PosVariant[] = []

  for (const product of products) {
    // Черновики на кассе не продаём: у них может не быть цены.
    if (product.status !== ProductStatus.PUBLISHED) {
      continue
    }

    // query.graph отдаёт calculated_price по контексту цен, но в типе
    // ProductVariant этого поля нет — оно приходит только с QueryContext.
    for (const variant of (product.variants ?? []) as any[]) {
      if (exactVariantIds.length && !exactVariantIds.includes(variant.id)) {
        continue
      }

      variants.push({
        variant_id: variant.id,
        product_id: product.id,
        product_title: product.title,
        variant_title: variant.title ?? "",
        sku: variant.sku ?? null,
        barcode: variant.barcode ?? null,
        thumbnail: product.thumbnail ?? null,
        unit_price: variant.calculated_price?.calculated_amount ?? null,
        currency_code: variant.calculated_price?.currency_code ?? currencyCode ?? null,
      })
    }
  }

  res.json({ variants: variants.slice(0, LIMIT) })
}
