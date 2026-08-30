import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { PRICE_BOOK_MODULE } from "../../../modules/price-book"
import type PriceBookService from "../../../modules/price-book/service"
import { syncDiscountPrices } from "../../../workflows/sync-discount-prices"

/**
 * Системные прайс-листы.
 *
 * Это не записи в базе, а два взгляда на данные, которые в магазине есть
 * всегда: закупочная цена лежит в прайс-книге, основная — это базовая
 * цена вариации в ядре. Поэтому их нельзя ни удалить, ни завести заново,
 * и срока действия у них нет по построению.
 */
export const MAIN_LIST_ID = "main"
export const COST_LIST_ID = "cost"

export function isSystemList(id: string): boolean {
  return id === MAIN_LIST_ID || id === COST_LIST_ID
}

export type PriceBookRow = {
  product_id: string
  product_title: string
  thumbnail: string | null
  variant_id: string
  variant_title: string
  sku: string | null
  /** Закупочная: сколько магазин заплатил поставщику. */
  cost: number | null
  /** Основная: по ней товар продаётся, когда акции нет. */
  main: number | null
  /** Скидочная в открытом прайс-листе. null для системных списков. */
  discount: number | null
  /** Тумблер «Со скидкой» в карточке товара. */
  discount_enabled: boolean
}

/**
 * Валюта магазина.
 *
 * Регион и валюта в магазине одни, но зашивать «azn» в код нельзя: цена,
 * записанная не в той валюте, движком цен просто не будет найдена, и
 * товар молча останется без цены.
 */
export async function storeCurrency(container: MedusaContainer): Promise<string> {
  const storeModuleService = container.resolve(Modules.STORE)
  // Валюты — связанная сущность, и без явного relations модуль магазина
  // их не отдаёт: supported_currencies приходит пустым, а магазин
  // выглядит как магазин без валюты.
  const [store] = await storeModuleService.listStores(
    {},
    { relations: ["supported_currencies"] }
  )

  const currencyCode =
    store?.supported_currencies?.find((currency: any) => currency.is_default)?.currency_code ??
    store?.supported_currencies?.[0]?.currency_code

  if (!currencyCode) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "У магазина не задана валюта — без неё цену некуда записать. Проверьте настройки магазина."
    )
  }

  return currencyCode
}

/** Проверяет, что открытый прайс-лист существует. */
export async function assertPriceList(container: MedusaContainer, id: string): Promise<any> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "price_list",
    fields: ["id", "title", "description", "status", "starts_at", "ends_at"],
    filters: { id },
  })

  if (!data.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Прайс-лист ${id} не найден`)
  }

  return data[0]
}

/**
 * Цены, которые уже лежат в прайс-листе ядра.
 *
 * Нужны для листов, заведённых до появления этого раздела: черновика у
 * них нет, а цена есть — и таблица показывала бы пустую колонку там, где
 * акция на самом деле идёт. Такую цену показываем как есть; черновиком
 * она станет, только если продавец сохранит строку сам.
 */
async function appliedPrices(
  container: MedusaContainer,
  priceListId: string,
  variantIds: string[]
): Promise<Map<string, number>> {
  if (!variantIds.length) {
    return new Map()
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "price_set.id"],
    filters: { id: variantIds },
  })

  const variantByPriceSet = new Map<string, string>()

  for (const variant of variants as any[]) {
    if (variant.price_set?.id) {
      variantByPriceSet.set(variant.price_set.id, variant.id)
    }
  }

  if (!variantByPriceSet.size) {
    return new Map()
  }

  const { data: prices } = await query.graph({
    entity: "price",
    fields: ["amount", "price_set_id", "min_quantity", "max_quantity"],
    filters: { price_list_id: priceListId, price_set_id: [...variantByPriceSet.keys()] },
  })

  const result = new Map<string, number>()

  for (const price of prices as any[]) {
    const variantId = variantByPriceSet.get(price.price_set_id)

    // Цены с ограничением по количеству заводятся не здесь и колонке не
    // соответствуют: показали бы цену, которая действует не всегда.
    if (!variantId || price.min_quantity != null || price.max_quantity != null) {
      continue
    }

    result.set(variantId, Number(price.amount))
  }

  return result
}

/**
 * Страница таблицы цен.
 *
 * Строка — вариация: цены в Medusa живут на вариациях, и у разных
 * размеров одного товара закупочная цена обычно разная. Товары
 * листаются целиком, чтобы вариации одного товара не разъезжались по
 * соседним страницам.
 */
export async function loadRows(
  container: MedusaContainer,
  options: { listId: string; q?: string; limit: number; offset: number }
): Promise<{ rows: PriceBookRow[]; count: number }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModuleService = container.resolve(Modules.PRODUCT)
  const priceBook: PriceBookService = container.resolve(PRICE_BOOK_MODULE)

  const [products, count] = await productModuleService.listAndCountProducts(
    options.q ? ({ q: options.q } as any) : {},
    { take: options.limit, skip: options.offset, order: { created_at: "DESC" }, select: ["id"] }
  )

  const productIds = products.map((product) => product.id)

  if (!productIds.length) {
    return { rows: [], count }
  }

  const { data: full } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "thumbnail",
      "variants.id",
      "variants.title",
      "variants.sku",
      "variants.prices.amount",
      "variants.prices.currency_code",
      "variants.prices.price_list_id",
    ],
    filters: { id: productIds },
  })

  // listAndCountProducts задаёт порядок, query.graph его не сохраняет.
  const order = new Map(productIds.map((id, index) => [id, index]))
  const ordered = [...(full as any[])].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  )

  const variantIds: string[] = []
  for (const product of ordered) {
    for (const variant of product.variants ?? []) {
      variantIds.push(variant.id)
    }
  }

  const [cost, enabled, discount, applied] = await Promise.all([
    priceBook.costByVariant(variantIds),
    priceBook.enabledProductIds(productIds),
    isSystemList(options.listId)
      ? Promise.resolve(new Map<string, number>())
      : priceBook.discountByVariant(options.listId, variantIds),
    isSystemList(options.listId)
      ? Promise.resolve(new Map<string, number>())
      : appliedPrices(container, options.listId, variantIds),
  ])

  const rows: PriceBookRow[] = []

  for (const product of ordered) {
    for (const variant of product.variants ?? []) {
      // Базовая цена — та, что не принадлежит ни одному прайс-листу.
      const base = (variant.prices ?? []).find((price: any) => !price.price_list_id)

      rows.push({
        product_id: product.id,
        product_title: product.title,
        thumbnail: product.thumbnail ?? null,
        variant_id: variant.id,
        variant_title: variant.title ?? "",
        sku: variant.sku ?? null,
        cost: cost.get(variant.id) ?? null,
        main: base ? Number(base.amount) : null,
        discount: discount.get(variant.id) ?? applied.get(variant.id) ?? null,
        discount_enabled: enabled.has(product.id),
      })
    }
  }

  return { rows, count }
}

/** Товары, которым принадлежат вариации. */
async function productsOfVariants(
  container: MedusaContainer,
  variantIds: string[]
): Promise<string[]> {
  if (!variantIds.length) {
    return []
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["product_id"],
    filters: { id: variantIds },
  })

  return [...new Set((variants as any[]).map((variant) => variant.product_id).filter(Boolean))]
}

export type PriceEntry = { variant_id: string; amount: number | null }

/**
 * Записывает колонку цен.
 *
 * Пустое поле означает «цены нет» и стирает значение. Ноль так не
 * трактуется: ноль — допустимая цена, и товар за ноль манат должен
 * получаться только когда его ввели осознанно.
 */
export async function saveEntries(
  container: MedusaContainer,
  options: { listId: string; entries: PriceEntry[] }
): Promise<void> {
  const { listId, entries } = options

  if (!entries.length) {
    return
  }

  const currencyCode = await storeCurrency(container)
  const priceBook: PriceBookService = container.resolve(PRICE_BOOK_MODULE)

  if (listId === COST_LIST_ID) {
    await priceBook.setCostPrices(entries, currencyCode)
    return
  }

  if (listId === MAIN_LIST_ID) {
    // Пустая цена стирает базовую цену вариации: движок цен оставляет
    // такой товар без цены, а витрина показывает «Цена уточняется».
    await updateProductVariantsWorkflow(container).run({
      input: {
        product_variants: entries.map((entry) => ({
          id: entry.variant_id,
          prices:
            entry.amount === null
              ? []
              : [{ amount: entry.amount, currency_code: currencyCode }],
        })),
      },
    })

    // Скидку некуда положить, пока у вариации нет основной цены: набора
    // цен в ядре ещё не существует. Продавец при этом мог набрать скидки
    // заранее, поэтому после появления основной цены переносим их снова —
    // иначе черновик молча остался бы лежать без дела.
    await syncDiscountPrices(container, {
      productIds: await productsOfVariants(container, entries.map((entry) => entry.variant_id)),
    })
    return
  }

  await assertPriceList(container, listId)
  await priceBook.setDiscountPrices(listId, entries, currencyCode)
  await syncDiscountPrices(container, { priceListIds: [listId] })
}
