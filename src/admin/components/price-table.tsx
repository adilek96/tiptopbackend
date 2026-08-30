import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge, Button, Input, Table, Text, toast } from "@medusajs/ui"
import { errorText, sdk } from "../lib/sdk"
import {
  discountPercent,
  formatAmount,
  formatPercent,
  margin,
  parseAmount,
  toInput,
} from "../lib/money"

export type PriceRow = {
  product_id: string
  product_title: string
  thumbnail: string | null
  variant_id: string
  variant_title: string
  sku: string | null
  cost: number | null
  main: number | null
  discount: number | null
  discount_enabled: boolean
}

export type PriceTableKind = "cost" | "main" | "discount"

type Props = {
  listId: string
  kind: PriceTableKind
}

const LIMIT = 50

/**
 * colSpan для ячейки таблицы.
 *
 * В типах @medusajs/ui у Table.Cell объявлены атрибуты обычного div, а не
 * ячейки, поэтому colSpan приходится передавать в обход типа. В разметку
 * он попадает как есть.
 */
function span(columns: number): Record<string, unknown> {
  return { colSpan: columns }
}

/** Колонка, которую правит этот прайс-лист. */
function editedValue(row: PriceRow, kind: PriceTableKind): number | null {
  if (kind === "cost") {
    return row.cost
  }

  return kind === "main" ? row.main : row.discount
}

/**
 * Таблица цен прайс-листа.
 *
 * Правится колонка целиком, а сохраняется одной кнопкой: продавец
 * проходит список сверху вниз, и запрос на каждое поле означал бы сотню
 * запросов на одну переоценку.
 *
 * Строка — вариация: цены в Medusa живут на вариациях, и у разных
 * размеров одного товара закупочная цена обычно разная. Чтобы это не
 * превращалось в ручной труд, у каждого товара есть поле «проставить
 * всем вариациям».
 */
export function PriceTable({ listId, kind }: Props) {
  const [rows, setRows] = useState<PriceRow[]>([])
  const [count, setCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [term, setTerm] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [bulk, setBulk] = useState<Record<string, string>>({})

  // Поиск ждёт, пока продавец допечатает: запрос на каждую букву успевал
  // бы вернуться уже неактуальным.
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0)
      setTerm(search.trim())
    }, 300)

    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)

    try {
      const response = await sdk.client.fetch<{ rows: PriceRow[]; count: number }>(
        `/admin/price-book/${listId}/items`,
        { query: { limit: LIMIT, offset, ...(term ? { q: term } : {}) } }
      )

      setRows(response.rows)
      setCount(response.count)
      setDraft({})
      setBulk({})
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [listId, offset, term])

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => {
    const result: { product_id: string; title: string; rows: PriceRow[] }[] = []

    for (const row of rows) {
      const last = result[result.length - 1]

      if (last && last.product_id === row.product_id) {
        last.rows.push(row)
        continue
      }

      result.push({ product_id: row.product_id, title: row.product_title, rows: [row] })
    }

    return result
  }, [rows])

  /** Строки, где значение отличается от сохранённого. */
  const changed = useMemo(() => {
    const result: { variant_id: string; amount: number | null }[] = []

    for (const row of rows) {
      const value = draft[row.variant_id]

      if (value === undefined) {
        continue
      }

      const parsed = parseAmount(value)

      if (parsed === undefined) {
        continue
      }

      if (parsed !== editedValue(row, kind)) {
        result.push({ variant_id: row.variant_id, amount: parsed })
      }
    }

    return result
  }, [rows, draft, kind])

  const invalid = useMemo(
    () => Object.values(draft).some((value) => parseAmount(value) === undefined),
    [draft]
  )

  async function save() {
    if (!changed.length) {
      return
    }

    setSaving(true)

    try {
      await sdk.client.fetch(`/admin/price-book/${listId}/items`, {
        method: "POST",
        body: { prices: changed },
      })

      toast.success(`Сохранено цен: ${changed.length}`)
      await load()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  function fillProduct(productId: string) {
    const value = bulk[productId] ?? ""

    if (parseAmount(value) === undefined) {
      toast.error("Цена должна быть неотрицательным числом")
      return
    }

    setDraft((current) => {
      const next = { ...current }

      for (const row of rows) {
        if (row.product_id === productId) {
          next[row.variant_id] = value
        }
      }

      return next
    })

    setBulk((current) => ({ ...current, [productId]: "" }))
  }

  const columns = kind === "cost" ? 2 : kind === "main" ? 4 : 6
  const page = Math.floor(offset / LIMIT) + 1
  const pages = Math.max(Math.ceil(count / LIMIT), 1)

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center justify-between gap-x-4">
        <Input
          placeholder="Поиск по названию товара"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-x-2">
          {changed.length ? (
            <Text size="small" className="text-ui-fg-subtle">
              Изменено строк: {changed.length}
            </Text>
          ) : null}
          <Button
            variant="primary"
            onClick={save}
            isLoading={saving}
            disabled={!changed.length || invalid || loading}
          >
            Сохранить
          </Button>
        </div>
      </div>

      {invalid ? (
        <Text size="small" className="text-ui-fg-error">
          Цена должна быть неотрицательным числом. Пустое поле стирает цену.
        </Text>
      ) : null}

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Вариация</Table.HeaderCell>
            {kind !== "cost" ? <Table.HeaderCell>Закупочная</Table.HeaderCell> : null}
            {kind === "discount" ? <Table.HeaderCell>Основная</Table.HeaderCell> : null}
            <Table.HeaderCell>
              {kind === "cost" ? "Закупочная" : kind === "main" ? "Основная" : "Скидочная"}
            </Table.HeaderCell>
            {kind === "main" ? <Table.HeaderCell>Надбавка</Table.HeaderCell> : null}
            {kind === "discount" ? <Table.HeaderCell>Скидка</Table.HeaderCell> : null}
            {kind === "discount" ? <Table.HeaderCell>Со скидкой</Table.HeaderCell> : null}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading ? (
            <Table.Row>
              <Table.Cell {...span(columns)}>Загружаем…</Table.Cell>
            </Table.Row>
          ) : null}

          {!loading && !rows.length ? (
            <Table.Row>
              <Table.Cell {...span(columns)}>
                {term ? "Ничего не нашли" : "Товаров пока нет"}
              </Table.Cell>
            </Table.Row>
          ) : null}

          {!loading &&
            groups.flatMap((group) => [
              <Table.Row key={group.product_id} className="bg-ui-bg-subtle">
                <Table.Cell {...span(columns)}>
                  <div className="flex items-center justify-between gap-x-4">
                    <Text weight="plus">{group.title}</Text>
                    {group.rows.length > 1 ? (
                      <div className="flex items-center gap-x-2">
                        <Input
                          size="small"
                          placeholder="Цена всем вариациям"
                          value={bulk[group.product_id] ?? ""}
                          onChange={(event) =>
                            setBulk((current) => ({
                              ...current,
                              [group.product_id]: event.target.value,
                            }))
                          }
                          className="w-44"
                        />
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => fillProduct(group.product_id)}
                        >
                          Проставить всем
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </Table.Cell>
              </Table.Row>,

              ...group.rows.map((row) => {
                const value = draft[row.variant_id] ?? toInput(editedValue(row, kind))
                const parsed = parseAmount(value)
                const shown = parsed === undefined ? editedValue(row, kind) : parsed
                const gain = margin(kind === "main" ? shown : row.main, row.cost)
                const loss = margin(kind === "discount" ? shown : row.discount, row.cost)
                const percent = discountPercent(
                  row.main,
                  kind === "discount" ? shown : row.discount
                )

                return (
                  <Table.Row key={row.variant_id}>
                    <Table.Cell>
                      <Text size="small">{row.variant_title || "Без вариаций"}</Text>
                      {row.sku ? (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {row.sku}
                        </Text>
                      ) : null}
                    </Table.Cell>

                    {kind !== "cost" ? <Table.Cell>{formatAmount(row.cost)}</Table.Cell> : null}

                    {kind === "discount" ? (
                      <Table.Cell>{formatAmount(row.main)}</Table.Cell>
                    ) : null}

                    <Table.Cell>
                      <Input
                        size="small"
                        inputMode="decimal"
                        placeholder="—"
                        value={value}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [row.variant_id]: event.target.value,
                          }))
                        }
                        className="w-32"
                      />
                    </Table.Cell>

                    {kind === "main" ? (
                      <Table.Cell>
                        {gain ? (
                          <div className="flex items-center gap-x-2">
                            <Text
                              size="small"
                              className={gain.absolute < 0 ? "text-ui-fg-error" : undefined}
                            >
                              {formatAmount(gain.absolute)}
                            </Text>
                            <Badge size="2xsmall" color={gain.absolute < 0 ? "red" : "green"}>
                              {formatPercent(gain.percent)}
                            </Badge>
                          </div>
                        ) : (
                          <Text size="small" className="text-ui-fg-subtle">
                            нет закупочной
                          </Text>
                        )}
                      </Table.Cell>
                    ) : null}

                    {kind === "discount" ? (
                      <Table.Cell>
                        <div className="flex items-center gap-x-2">
                          <Badge
                            size="2xsmall"
                            color={percent !== null && percent > 0 ? "orange" : "grey"}
                          >
                            {formatPercent(percent)}
                          </Badge>
                          {loss && loss.absolute < 0 ? (
                            <Text size="xsmall" className="text-ui-fg-error">
                              ниже закупочной
                            </Text>
                          ) : null}
                        </div>
                      </Table.Cell>
                    ) : null}

                    {kind === "discount" ? (
                      <Table.Cell>
                        <Badge size="2xsmall" color={row.discount_enabled ? "green" : "grey"}>
                          {row.discount_enabled ? "включена" : "выключена"}
                        </Badge>
                      </Table.Cell>
                    ) : null}
                  </Table.Row>
                )
              }),
            ])}
        </Table.Body>
      </Table>

      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          Товаров: {count} · страница {page} из {pages}
        </Text>
        <div className="flex items-center gap-x-2">
          <Button
            size="small"
            variant="secondary"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(offset - LIMIT, 0))}
          >
            Назад
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={offset + LIMIT >= count || loading}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Вперёд
          </Button>
        </div>
      </div>
    </div>
  )
}
