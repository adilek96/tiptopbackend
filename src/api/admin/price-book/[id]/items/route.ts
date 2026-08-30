import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { assertPriceList, isSystemList, loadRows, saveEntries } from "../../helpers"
import type { PriceEntry } from "../../helpers"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** Число из формы: пустое поле — «цены нет», а не ноль. */
function amount(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined
  }

  return parsed
}

/**
 * GET /admin/price-book/:id/items?q=&limit=&offset=
 *
 * Таблица цен. Строки одинаковы для всех списков — колонки выбирает
 * интерфейс: закупочному нужна только своя цена, основному ещё и
 * надбавка, скидочному — основная цена рядом со скидочной.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = req.params.id

  if (!isSystemList(id)) {
    await assertPriceList(req.scope, id)
  }

  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const q = String(req.query.q ?? "").trim()

  const { rows, count } = await loadRows(req.scope, {
    listId: id,
    q: q || undefined,
    limit,
    offset,
  })

  res.json({ rows, count, limit, offset })
}

/**
 * POST /admin/price-book/:id/items
 *
 * Сохраняет колонку цен пачкой: { prices: [{ variant_id, amount }] }.
 *
 * Пачкой, а не по одной строке: продавец правит таблицу целиком, а для
 * скидочного листа каждое сохранение ещё и переносит цены в прайс-лист
 * ядра — делать это на каждое поле было бы и медленно, и заметно.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = req.params.id
  const body = (req.body ?? {}) as Record<string, unknown>
  const incoming = Array.isArray(body.prices) ? body.prices : null

  if (!incoming) {
    res.status(400).json({ message: "Ожидался список цен в поле prices" })
    return
  }

  const entries: PriceEntry[] = []

  for (const item of incoming as any[]) {
    const variantId = String(item?.variant_id ?? "").trim()

    if (!variantId) {
      res.status(400).json({ message: "В одной из строк не указана вариация" })
      return
    }

    const value = amount(item?.amount)

    if (value === undefined) {
      res.status(400).json({
        message: `Неверная цена у вариации ${variantId}: нужно неотрицательное число`,
      })
      return
    }

    entries.push({ variant_id: variantId, amount: value })
  }

  await saveEntries(req.scope, { listId: id, entries })

  res.json({ saved: entries.length })
}
