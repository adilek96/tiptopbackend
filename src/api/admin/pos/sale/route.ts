import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
  QueryContext,
} from "@medusajs/framework/utils"
import {
  createOrdersWorkflow,
  createOrderPaymentCollectionWorkflow,
  markPaymentCollectionAsPaid,
  createOrderFulfillmentWorkflow,
} from "@medusajs/medusa/core-flows"

const PAYMENT_METHODS = ["cash", "card", "transfer"] as const
type PaymentMethod = (typeof PAYMENT_METHODS)[number]

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
}

type SaleItem = {
  variant_id: string
  quantity: number
  /** Скидка на позицию в деньгах, за всю позицию целиком. */
  discount?: number
}

type SaleBody = {
  items?: SaleItem[]
  /** Скидка на весь чек в деньгах. */
  order_discount?: number
  payment_method?: PaymentMethod
  customer?: { name?: string; phone?: string }
  note?: string
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * POST /admin/pos/sale
 *
 * Продажа за прилавком. Создаёт настоящий заказ Medusa, отмечает его
 * оплаченным и сразу отгружает — товар покупатель уносит с собой, поэтому
 * отгрузка списывает остатки со склада тем же действием.
 *
 * Цены берутся из базы по region_id магазина. Браузер кассира присылает
 * только идентификаторы вариантов, количество и скидку: подставить
 * произвольную цену через запрос нельзя.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const body = (req.body ?? {}) as SaleBody
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (item) => item?.variant_id && Number(item.quantity) > 0
  )

  if (!items.length) {
    res.status(400).json({ message: "В чеке нет позиций" })
    return
  }

  const paymentMethod: PaymentMethod = PAYMENT_METHODS.includes(
    body.payment_method as PaymentMethod
  )
    ? (body.payment_method as PaymentMethod)
    : "cash"

  // --- Контекст магазина ----------------------------------------------------

  const storeModuleService = req.scope.resolve(Modules.STORE)
  const salesChannelModuleService = req.scope.resolve(Modules.SALES_CHANNEL)
  const stockLocationModuleService = req.scope.resolve(Modules.STOCK_LOCATION)

  const [store] = await storeModuleService.listStores()
  const regionId = store?.default_region_id
  const currencyCode =
    store?.supported_currencies?.find((c: any) => c.is_default)?.currency_code ??
    store?.supported_currencies?.[0]?.currency_code

  if (!regionId || !currencyCode) {
    res.status(400).json({
      message: "У магазина не заданы регион и валюта по умолчанию",
    })
    return
  }

  const salesChannelId =
    store?.default_sales_channel_id ??
    (await salesChannelModuleService.listSalesChannels({}, { take: 1 }))[0]?.id

  // --- Цены берём из базы, а не из запроса ----------------------------------

  const variantIds = [...new Set(items.map((item) => item.variant_id))]

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "title",
      "sku",
      "barcode",
      "product.id",
      "product.title",
      "product.thumbnail",
      "calculated_price.calculated_amount",
    ],
    filters: { id: variantIds },
    context: {
      calculated_price: QueryContext({
        region_id: regionId,
        currency_code: currencyCode,
      }),
    },
  })

  const variantById = new Map(variants.map((v: any) => [v.id, v]))

  const missing = variantIds.filter((id) => !variantById.has(id))
  if (missing.length) {
    res.status(400).json({
      message: `Не найдены варианты товара: ${missing.join(", ")}`,
    })
    return
  }

  const withoutPrice = variantIds.filter(
    (id) => variantById.get(id)?.calculated_price?.calculated_amount == null
  )
  if (withoutPrice.length) {
    res.status(400).json({
      message:
        "У некоторых позиций не задана цена для региона магазина. Проставьте цены в карточке товара.",
    })
    return
  }

  // --- Собираем позиции чека ------------------------------------------------

  const lines = items.map((item) => {
    const variant: any = variantById.get(item.variant_id)
    const quantity = Math.floor(Number(item.quantity))
    const unitPrice = Number(variant.calculated_price.calculated_amount)
    const lineTotal = round(unitPrice * quantity)

    // Скидка не может превышать стоимость позиции и уходить в минус.
    const discount = Math.min(
      Math.max(round(Number(item.discount) || 0), 0),
      lineTotal
    )

    return { item, variant, quantity, unitPrice, lineTotal, discount }
  })

  const subtotal = round(lines.reduce((sum, line) => sum + line.lineTotal, 0))
  const lineDiscounts = round(lines.reduce((sum, line) => sum + line.discount, 0))

  // Скидка на чек не может увести сумму ниже нуля с учётом уже данных скидок.
  const orderDiscount = Math.min(
    Math.max(round(Number(body.order_discount) || 0), 0),
    round(subtotal - lineDiscounts)
  )

  const total = round(subtotal - lineDiscounts - orderDiscount)

  // Скидку на чек размазываем по позициям пропорционально их стоимости:
  // в Medusa скидки живут на позициях, отдельной строки заказа для них нет.
  const discountBase = round(subtotal - lineDiscounts)

  let distributed = 0
  // Итоговая скидка по каждой позиции: своя плюс доля от скидки на чек.
  // Считается один раз и используется и в заказе, и в чеке — иначе
  // напечатанный чек мог бы разойтись с тем, что записано в базу.
  const perLineDiscount = lines.map((line, index) => {
    const share =
      discountBase > 0
        ? round(((line.lineTotal - line.discount) / discountBase) * orderDiscount)
        : 0

    // Последней позиции отдаём остаток, чтобы копейки не потерялись при округлении.
    const orderShare =
      index === lines.length - 1 ? round(orderDiscount - distributed) : share
    distributed = round(distributed + orderShare)

    return round(line.discount + orderShare)
  })

  const orderItems = lines.map((line, index) => {
    const adjustmentAmount = perLineDiscount[index]

    return {
      title: line.variant.product?.title ?? "Товар",
      subtitle: line.variant.title ?? undefined,
      thumbnail: line.variant.product?.thumbnail ?? undefined,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      variant_id: line.variant.id,
      product_id: line.variant.product?.id,
      variant_title: line.variant.title ?? undefined,
      variant_sku: line.variant.sku ?? undefined,
      variant_barcode: line.variant.barcode ?? undefined,
      ...(adjustmentAmount > 0
        ? {
            adjustments: [
              {
                amount: adjustmentAmount,
                description: "Скидка на кассе",
              },
            ],
          }
        : {}),
    }
  })

  // --- Заказ ----------------------------------------------------------------

  const customerName = String(body.customer?.name ?? "").trim()
  const customerPhone = String(body.customer?.phone ?? "").trim()

  const { result: order } = await createOrdersWorkflow(req.scope).run({
    input: {
      region_id: regionId,
      currency_code: currencyCode,
      sales_channel_id: salesChannelId,
      status: "completed",
      items: orderItems,
      no_notification: true,
      metadata: {
        channel: "pos",
        payment_method: paymentMethod,
        payment_method_label: PAYMENT_LABELS[paymentMethod],
        cashier_id: req.auth_context?.actor_id ?? null,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        note: String(body.note ?? "").trim() || null,
        subtotal,
        discount_total: round(lineDiscounts + orderDiscount),
        total,
      },
    } as any,
  })

  // --- Оплата: деньги приняты мимо системы, фиксируем факт -------------------

  let paymentRecorded = false
  try {
    const { result: collections } = await createOrderPaymentCollectionWorkflow(
      req.scope
    ).run({
      input: { order_id: order.id, amount: total },
    })

    const collectionId = collections?.[0]?.id
    if (collectionId) {
      await markPaymentCollectionAsPaid(req.scope).run({
        input: {
          order_id: order.id,
          payment_collection_id: collectionId,
          captured_by: req.auth_context?.actor_id,
        },
      })
      paymentRecorded = true
    }
  } catch (error) {
    // Заказ уже создан — не откатываем его из-за проблемы с отметкой оплаты,
    // иначе касса «съест» продажу. Отметить оплату можно вручную в админке.
    logger.error(
      `POS: заказ ${order.id} создан, но не удалось отметить оплату: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  // --- Отгрузка: товар уходит сразу, списываем остатки ----------------------

  let stockDeducted = false
  try {
    const [location] = await stockLocationModuleService.listStockLocations(
      {},
      { take: 1 }
    )

    const { data: freshOrder } = await query.graph({
      entity: "order",
      fields: ["id", "items.id", "items.quantity"],
      filters: { id: order.id },
    })

    const orderLineItems = freshOrder?.[0]?.items ?? []

    if (orderLineItems.length) {
      await createOrderFulfillmentWorkflow(req.scope).run({
        input: {
          order_id: order.id,
          location_id: location?.id,
          no_notification: true,
          requires_shipping: false,
          items: orderLineItems.map((item: any) => ({
            id: item.id,
            quantity: item.quantity,
          })),
        },
      })
      stockDeducted = true
    }
  } catch (error) {
    logger.error(
      `POS: заказ ${order.id} создан, но не удалось списать остатки: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  logger.info(
    `POS: продажа ${order.id} на ${total} ${currencyCode}, ${PAYMENT_LABELS[paymentMethod]}, ` +
      `оплата ${paymentRecorded ? "отмечена" : "НЕ отмечена"}, остатки ${
        stockDeducted ? "списаны" : "НЕ списаны"
      }`
  )

  res.json({
    order: {
      id: order.id,
      display_id: (order as any).display_id ?? null,
      created_at: (order as any).created_at ?? new Date().toISOString(),
    },
    receipt: {
      items: lines.map((line, index) => ({
        title: line.variant.product?.title ?? "Товар",
        variant_title: line.variant.title ?? "",
        quantity: line.quantity,
        unit_price: line.unitPrice,
        line_total: line.lineTotal,
        discount: perLineDiscount[index],
      })),
      subtotal,
      discount_total: round(lineDiscounts + orderDiscount),
      total,
      currency_code: currencyCode,
      payment_method: PAYMENT_LABELS[paymentMethod],
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
    },
    payment_recorded: paymentRecorded,
    stock_deducted: stockDeducted,
  })
}
