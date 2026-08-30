import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PriceListStatus } from "@medusajs/framework/utils"
import { deletePriceListsWorkflow, updatePriceListsWorkflow } from "@medusajs/medusa/core-flows"
import { PRICE_BOOK_MODULE } from "../../../../modules/price-book"
import type PriceBookService from "../../../../modules/price-book/service"
import { assertPriceList, isSystemList } from "../helpers"

/**
 * GET /admin/price-book/:id
 *
 * Карточка скидочного прайс-листа: название, статус и срок действия.
 * Для системных списков возвращает 400 — у них нет ни того, ни другого.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = req.params.id

  if (isSystemList(id)) {
    res.status(400).json({ message: "У системного прайс-листа нет настроек" })
    return
  }

  res.json({ price_list: await assertPriceList(req.scope, id) })
}

/**
 * POST /admin/price-book/:id
 *
 * Меняет название, статус и срок действия скидочного прайс-листа.
 *
 * Проверять срок при выдаче цен не нужно: движок цен сам не применяет
 * лист вне дат и в статусе «черновик».
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = req.params.id

  if (isSystemList(id)) {
    res.status(400).json({
      message: "Основной и закупочный прайс-листы нельзя изменить: у них нет срока и статуса",
    })
    return
  }

  const current = await assertPriceList(req.scope, id)

  const body = (req.body ?? {}) as Record<string, unknown>
  const update: Record<string, unknown> = { id }

  if (body.title !== undefined) {
    const title = String(body.title).trim()

    if (!title) {
      res.status(400).json({ message: "Укажите название прайс-листа" })
      return
    }

    update.title = title
  }

  if (body.description !== undefined) {
    update.description = String(body.description ?? "")
  }

  if (body.starts_at !== undefined) {
    update.starts_at = body.starts_at ? String(body.starts_at) : null
  }

  if (body.ends_at !== undefined) {
    update.ends_at = body.ends_at ? String(body.ends_at) : null
  }

  if (body.status !== undefined) {
    const status = String(body.status)

    if (status !== PriceListStatus.ACTIVE && status !== PriceListStatus.DRAFT) {
      res.status(400).json({ message: "Статус может быть только «active» или «draft»" })
      return
    }

    update.status = status
  }

  const startsAt = update.starts_at ?? current.starts_at
  const endsAt = update.ends_at ?? current.ends_at

  if (startsAt && endsAt && new Date(String(startsAt)) > new Date(String(endsAt))) {
    res.status(400).json({ message: "Начало акции позже её окончания" })
    return
  }

  const { result } = await updatePriceListsWorkflow(req.scope).run({
    input: { price_lists_data: [update as any] },
  })

  res.json({ price_list: (result as any[])[0] })
}

/**
 * DELETE /admin/price-book/:id
 *
 * Удаляет скидочный прайс-лист вместе с набранными в нём ценами.
 * Системные списки не удаляются — удалять там нечего.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = req.params.id

  if (isSystemList(id)) {
    res.status(400).json({
      message: "Основной и закупочный прайс-листы удалить нельзя",
    })
    return
  }

  await assertPriceList(req.scope, id)

  const priceBook: PriceBookService = req.scope.resolve(PRICE_BOOK_MODULE)

  await deletePriceListsWorkflow(req.scope).run({ input: { ids: [id] } })
  await priceBook.forgetPriceList(id)

  res.json({ id, object: "price_list", deleted: true })
}
