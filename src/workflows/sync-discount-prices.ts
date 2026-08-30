import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { batchPriceListPricesWorkflow } from "@medusajs/medusa/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { PRICE_BOOK_MODULE } from "../modules/price-book"
import type PriceBookService from "../modules/price-book/service"

/**
 * Что синхронизируем: конкретные прайс-листы, конкретные товары или
 * всё сразу. Пустой объект — полный пересчёт.
 */
export type SyncScope = {
  priceListIds?: string[]
  productIds?: string[]
}

/** Набранная продавцом скидочная цена. */
export type DraftPrice = {
  variant_id: string
  amount: number
  currency_code: string
}

/** Цена, которая уже лежит в прайс-листе Medusa. */
export type ExistingPrice = DraftPrice & { id: string }

export type PriceListPlan = {
  create: DraftPrice[]
  update: ExistingPrice[]
  delete: string[]
}

/** Ключ цены: одна вариация может иметь цены в разных валютах. */
function key(variantId: string, currencyCode: string): string {
  return `${variantId}:${currencyCode.toLowerCase()}`
}

/**
 * Считает, что добавить, поправить и убрать в одном прайс-листе.
 *
 * Правило одно: цена лежит в прайс-листе, пока у товара включён тумблер
 * «Со скидкой». Выключили — цена уходит из прайс-листа, но черновик
 * остаётся, и включить обратно можно не набирая заново.
 *
 * Чужие цены не трогаются: в `existing` попадают только те, что стоят
 * напротив известного нам черновика. Прайс-листы, заведённые до перехода
 * на прайс-книгу, продолжают работать как работали.
 */
export function planPriceListChanges(input: {
  drafts: DraftPrice[]
  existing: ExistingPrice[]
  isEnabled: (variantId: string) => boolean
}): PriceListPlan {
  const desired = new Map<string, DraftPrice>()

  for (const draft of input.drafts) {
    if (input.isEnabled(draft.variant_id)) {
      desired.set(key(draft.variant_id, draft.currency_code), draft)
    }
  }

  const existing = new Map<string, ExistingPrice>()

  for (const price of input.existing) {
    existing.set(key(price.variant_id, price.currency_code), price)
  }

  const plan: PriceListPlan = { create: [], update: [], delete: [] }

  for (const [priceKey, wanted] of desired) {
    const current = existing.get(priceKey)

    if (!current) {
      plan.create.push(wanted)
      continue
    }

    if (current.amount !== wanted.amount) {
      plan.update.push({ ...wanted, id: current.id })
    }
  }

  for (const [priceKey, current] of existing) {
    if (!desired.has(priceKey)) {
      plan.delete.push(current.id)
    }
  }

  return plan
}

/**
 * Переносит черновики скидок в прайс-листы Medusa.
 *
 * Скидочная цена набирается в нашей таблице, а действовать начинает
 * только после того, как её положат в прайс-лист ядра: считает цены
 * движок Medusa, и только его результат видят и корзина, и касса, и
 * витрина. Подменять цену на чтении нельзя — покупатель увидел бы одну
 * сумму, а заплатил другую.
 *
 * Даты и статус прайс-листа здесь не проверяются намеренно: истёкший или
 * черновой лист движок цен и так не применяет, а если проверять это ещё
 * и тут, наступление даты начала акции пришлось бы ловить отдельным
 * заданием.
 */
export async function syncDiscountPrices(
  container: MedusaContainer,
  scope: SyncScope = {}
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const priceBook: PriceBookService = container.resolve(PRICE_BOOK_MODULE)

  const filters: Record<string, unknown> = {}

  if (scope.priceListIds) {
    if (!scope.priceListIds.length) {
      return
    }
    filters.price_list_id = scope.priceListIds
  }

  if (scope.productIds) {
    if (!scope.productIds.length) {
      return
    }

    const { data: scopedVariants } = await query.graph({
      entity: "variant",
      fields: ["id"],
      filters: { product_id: scope.productIds },
    })

    if (!scopedVariants.length) {
      return
    }

    filters.variant_id = scopedVariants.map((variant: any) => variant.id)
  }

  const drafts = await priceBook.listDiscountPrices(filters, { take: null })

  if (!drafts.length) {
    return
  }

  // --- Вариации: чей товар и где лежат их цены ------------------------------

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "product_id", "price_set.id"],
    filters: { id: [...new Set(drafts.map((draft) => draft.variant_id))] },
  })

  const productByVariant = new Map<string, string>()
  const priceSetByVariant = new Map<string, string>()
  const variantByPriceSet = new Map<string, string>()

  for (const variant of variants as any[]) {
    productByVariant.set(variant.id, variant.product_id)

    if (variant.price_set?.id) {
      priceSetByVariant.set(variant.id, variant.price_set.id)
      variantByPriceSet.set(variant.price_set.id, variant.id)
    }
  }

  const enabled = await priceBook.enabledProductIds([...new Set(productByVariant.values())])

  // --- По одному прайс-листу за раз -----------------------------------------

  const byList = new Map<string, DraftPrice[]>()

  for (const draft of drafts) {
    // Вариация без набора цен ещё ни разу не имела цены вообще: класть
    // скидку некуда, пока не заведена основная.
    if (!priceSetByVariant.has(draft.variant_id)) {
      continue
    }

    const list = byList.get(draft.price_list_id) ?? []

    list.push({
      variant_id: draft.variant_id,
      amount: Number(draft.amount),
      currency_code: draft.currency_code,
    })

    byList.set(draft.price_list_id, list)
  }

  for (const [priceListId, listDrafts] of byList) {
    const priceSetIds = [
      ...new Set(listDrafts.map((draft) => priceSetByVariant.get(draft.variant_id)!)),
    ]

    // Цены с ограничением по количеству заведены не нами — оставляем как есть.
    const { data: prices } = await query.graph({
      entity: "price",
      fields: ["id", "amount", "currency_code", "price_set_id", "min_quantity", "max_quantity"],
      filters: { price_list_id: priceListId, price_set_id: priceSetIds },
    })

    const existing: ExistingPrice[] = []

    for (const price of prices as any[]) {
      const variantId = variantByPriceSet.get(price.price_set_id)

      if (!variantId || price.min_quantity != null || price.max_quantity != null) {
        continue
      }

      existing.push({
        id: price.id,
        variant_id: variantId,
        amount: Number(price.amount),
        currency_code: price.currency_code,
      })
    }

    const plan = planPriceListChanges({
      drafts: listDrafts,
      existing,
      isEnabled: (variantId) => {
        const productId = productByVariant.get(variantId)
        return Boolean(productId && enabled.has(productId))
      },
    })

    if (!plan.create.length && !plan.update.length && !plan.delete.length) {
      continue
    }

    await batchPriceListPricesWorkflow(container).run({
      input: {
        data: {
          id: priceListId,
          create: plan.create,
          update: plan.update,
          delete: plan.delete,
        },
      },
    })
  }
}
