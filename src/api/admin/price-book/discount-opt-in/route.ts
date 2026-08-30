import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRICE_BOOK_MODULE } from "../../../../modules/price-book"
import type PriceBookService from "../../../../modules/price-book/service"
import { syncDiscountPrices } from "../../../../workflows/sync-discount-prices"

/**
 * GET /admin/price-book/discount-opt-in?product_id=...
 *
 * Состояние тумблера «Со скидкой» для карточки товара.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const productId = String(req.query.product_id ?? "").trim()

  if (!productId) {
    res.status(400).json({ message: "Не указан товар" })
    return
  }

  const priceBook: PriceBookService = req.scope.resolve(PRICE_BOOK_MODULE)
  const enabled = await priceBook.enabledProductIds([productId])

  res.json({ product_id: productId, enabled: enabled.has(productId) })
}

/**
 * POST /admin/price-book/discount-opt-in
 *
 * Включает и выключает участие товара в акциях.
 *
 * Сразу после переключения цены переносятся в прайс-листы ядра: тумблер
 * должен срабатывать на витрине немедленно, а не по расписанию.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const productId = String(body.product_id ?? "").trim()

  if (!productId) {
    res.status(400).json({ message: "Не указан товар" })
    return
  }

  if (typeof body.enabled !== "boolean") {
    res.status(400).json({ message: "Поле enabled должно быть true или false" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: productId },
  })

  if (!products.length) {
    res.status(404).json({ message: `Товар ${productId} не найден` })
    return
  }

  const priceBook: PriceBookService = req.scope.resolve(PRICE_BOOK_MODULE)

  await priceBook.setDiscountEnabled(productId, body.enabled)
  await syncDiscountPrices(req.scope, { productIds: [productId] })

  res.json({ product_id: productId, enabled: body.enabled })
}
