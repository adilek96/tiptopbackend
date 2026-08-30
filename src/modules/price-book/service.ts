import { MedusaService } from "@medusajs/framework/utils"
import CostPrice from "./models/cost-price"
import DiscountPrice from "./models/discount-price"
import DiscountOptIn from "./models/discount-opt-in"

/**
 * Хранилище прайс-книги: закупочные цены, черновики скидок и тумблеры
 * участия товара в акциях.
 *
 * Расчётом цен модуль не занимается — этим ведает движок цен Medusa.
 * Здесь лежит только то, чего в ядре нет: себестоимость и намерение
 * продавца, а действующие цены живут в базовых ценах вариаций и в
 * прайс-листах ядра.
 */
class PriceBookService extends MedusaService({
  CostPrice,
  DiscountPrice,
  DiscountOptIn,
}) {
  /** Себестоимость по вариациям: variant_id -> сумма. */
  async costByVariant(variantIds: string[]): Promise<Map<string, number>> {
    if (!variantIds.length) {
      return new Map()
    }

    const rows = await this.listCostPrices({ variant_id: variantIds }, { take: null })
    return new Map(rows.map((row) => [row.variant_id, Number(row.amount)]))
  }

  /** Черновики скидок одного прайс-листа: variant_id -> сумма. */
  async discountByVariant(
    priceListId: string,
    variantIds?: string[]
  ): Promise<Map<string, number>> {
    const filters: Record<string, unknown> = { price_list_id: priceListId }
    if (variantIds) {
      if (!variantIds.length) {
        return new Map()
      }
      filters.variant_id = variantIds
    }

    const rows = await this.listDiscountPrices(filters, { take: null })
    return new Map(rows.map((row) => [row.variant_id, Number(row.amount)]))
  }

  /** Товары с включённым тумблером «Со скидкой». */
  async enabledProductIds(productIds?: string[]): Promise<Set<string>> {
    const filters: Record<string, unknown> = { enabled: true }
    if (productIds) {
      if (!productIds.length) {
        return new Set()
      }
      filters.product_id = productIds
    }

    const rows = await this.listDiscountOptIns(filters, { take: null })
    return new Set(rows.map((row) => row.product_id))
  }

  /**
   * Переключает участие товара в акциях.
   *
   * Пересчёт самих цен делает syncDiscountPrices: модуль изолирован и до
   * прайс-листов ядра дотянуться не может.
   */
  async setDiscountEnabled(productId: string, enabled: boolean): Promise<void> {
    const [existing] = await this.listDiscountOptIns({ product_id: productId })

    if (existing) {
      await this.updateDiscountOptIns({ id: existing.id, enabled })
      return
    }

    await this.createDiscountOptIns({ product_id: productId, enabled })
  }

  /**
   * Записывает цены пачкой: сумма — сохранить, null — стереть.
   *
   * Пустое поле в таблице означает «цены нет», а не «ноль»: ноль движок
   * цен считает нормальной ценой, и товар ушёл бы в продажу бесплатно.
   */
  async setCostPrices(
    entries: { variant_id: string; amount: number | null }[],
    currencyCode: string
  ): Promise<void> {
    const variantIds = entries.map((entry) => entry.variant_id)
    const existing = await this.listCostPrices({ variant_id: variantIds }, { take: null })
    const byVariant = new Map(existing.map((row) => [row.variant_id, row]))

    const toCreate: any[] = []
    const toUpdate: any[] = []
    const toDelete: string[] = []

    for (const entry of entries) {
      const row = byVariant.get(entry.variant_id)

      if (entry.amount === null) {
        if (row) {
          toDelete.push(row.id)
        }
        continue
      }

      if (row) {
        toUpdate.push({ id: row.id, amount: entry.amount, currency_code: currencyCode })
      } else {
        toCreate.push({
          variant_id: entry.variant_id,
          amount: entry.amount,
          currency_code: currencyCode,
        })
      }
    }

    if (toCreate.length) {
      await this.createCostPrices(toCreate)
    }
    if (toUpdate.length) {
      await this.updateCostPrices(toUpdate)
    }
    if (toDelete.length) {
      await this.deleteCostPrices(toDelete)
    }
  }

  /** То же для черновиков скидок одного прайс-листа. */
  async setDiscountPrices(
    priceListId: string,
    entries: { variant_id: string; amount: number | null }[],
    currencyCode: string
  ): Promise<void> {
    const variantIds = entries.map((entry) => entry.variant_id)
    const existing = await this.listDiscountPrices(
      { price_list_id: priceListId, variant_id: variantIds },
      { take: null }
    )
    const byVariant = new Map(existing.map((row) => [row.variant_id, row]))

    const toCreate: any[] = []
    const toUpdate: any[] = []
    const toDelete: string[] = []

    for (const entry of entries) {
      const row = byVariant.get(entry.variant_id)

      if (entry.amount === null) {
        if (row) {
          toDelete.push(row.id)
        }
        continue
      }

      if (row) {
        toUpdate.push({ id: row.id, amount: entry.amount, currency_code: currencyCode })
      } else {
        toCreate.push({
          price_list_id: priceListId,
          variant_id: entry.variant_id,
          amount: entry.amount,
          currency_code: currencyCode,
        })
      }
    }

    if (toCreate.length) {
      await this.createDiscountPrices(toCreate)
    }
    if (toUpdate.length) {
      await this.updateDiscountPrices(toUpdate)
    }
    if (toDelete.length) {
      await this.deleteDiscountPrices(toDelete)
    }
  }

  /** Убирает черновики удалённого прайс-листа. */
  async forgetPriceList(priceListId: string): Promise<void> {
    const rows = await this.listDiscountPrices({ price_list_id: priceListId }, { take: null })
    if (rows.length) {
      await this.deleteDiscountPrices(rows.map((row) => row.id))
    }
  }
}

export default PriceBookService
