import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, PriceListStatus } from "@medusajs/framework/utils"
import { createPriceListsWorkflow } from "@medusajs/medusa/core-flows"
import { COST_LIST_ID, MAIN_LIST_ID } from "./helpers"

export type PriceBookList = {
  id: string
  kind: "cost" | "main" | "discount"
  title: string
  description: string | null
  /** Системный список нельзя удалить и у него нет срока действия. */
  system: boolean
  status: string | null
  starts_at: string | null
  ends_at: string | null
}

/**
 * GET /admin/price-book
 *
 * Список прайс-листов магазина: два системных и открытые скидочные.
 *
 * Системные заведены не в базе, а здесь: закупочная цена лежит в
 * прайс-книге, основная — это базовая цена вариации в ядре. Так их
 * физически нельзя удалить, и отдельной защиты от удаления не нужно.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: priceLists } = await query.graph({
    entity: "price_list",
    fields: ["id", "title", "description", "status", "starts_at", "ends_at", "created_at"],
  })

  const lists: PriceBookList[] = [
    {
      id: COST_LIST_ID,
      kind: "cost",
      title: "Закупочный",
      description: "Сколько магазин заплатил за товар поставщику. Покупателю не показывается.",
      system: true,
      status: null,
      starts_at: null,
      ends_at: null,
    },
    {
      id: MAIN_LIST_ID,
      kind: "main",
      title: "Основной",
      description: "Цена, по которой магазин продаёт товар, пока не идёт акция.",
      system: true,
      status: null,
      starts_at: null,
      ends_at: null,
    },
  ]

  for (const priceList of [...(priceLists as any[])].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at))
  )) {
    lists.push({
      id: priceList.id,
      kind: "discount",
      title: priceList.title,
      description: priceList.description ?? null,
      system: false,
      status: priceList.status ?? null,
      starts_at: priceList.starts_at ?? null,
      ends_at: priceList.ends_at ?? null,
    })
  }

  res.json({ lists })
}

/**
 * POST /admin/price-book
 *
 * Создаёт скидочный прайс-лист.
 *
 * Тип листа остаётся заводским — «sale»: при нём движок цен подставляет
 * скидочную цену как действующую, а основную оставляет как старую.
 * Именно из неё витрина рисует зачёркнутую цену; при типе «override»
 * старой цены не было бы вовсе. Сменить тип рабочий процесс создания и
 * не даёт — поле в его входных данных не объявлено.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const title = String(body.title ?? "").trim()

  if (!title) {
    res.status(400).json({ message: "Укажите название прайс-листа" })
    return
  }

  const startsAt = body.starts_at ? String(body.starts_at) : null
  const endsAt = body.ends_at ? String(body.ends_at) : null

  if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
    res.status(400).json({ message: "Начало акции позже её окончания" })
    return
  }

  const { result } = await createPriceListsWorkflow(req.scope).run({
    input: {
      price_lists_data: [
        {
          title,
          description: String(body.description ?? "") || title,
          // Новый лист заводится черновиком: цены в нём ещё не набраны,
          // а активный пустой лист выглядел бы как сломанная акция.
          status: PriceListStatus.DRAFT,
          starts_at: startsAt,
          ends_at: endsAt,
        },
      ],
    },
  })

  res.status(201).json({ price_list: result[0] })
}
