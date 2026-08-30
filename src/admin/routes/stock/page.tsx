import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Buildings } from "@medusajs/icons"
import {
  Alert,
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Text,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type Level = {
  id: string
  location_id: string
  stocked_quantity: number
  reserved_quantity: number
}

type Variant = {
  id: string
  title: string
  sku: string | null
  manage_inventory: boolean
  inventory_item_id: string | null
  levels: Level[]
  stocked: number
  reserved: number
}

type Product = {
  id: string
  title: string
  thumbnail: string | null
  variants: Variant[]
  stocked: number
  reserved: number
}

const PAGE_SIZE = 50

/**
 * Поля запрашиваем явно: остатки лежат в связанной сущности, и без
 * перечисления вложенных путей ядро их не отдаёт.
 */
const FIELDS = [
  "id",
  "title",
  "thumbnail",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.manage_inventory",
  "variants.inventory_items.inventory_item_id",
  "variants.inventory_items.inventory.id",
  "variants.inventory_items.inventory.location_levels.id",
  "variants.inventory_items.inventory.location_levels.location_id",
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
].join(",")

function toProduct(raw: any): Product {
  const variants: Variant[] = (raw.variants ?? []).map((v: any) => {
    const inventory = (v.inventory_items ?? [])[0]?.inventory
    const levels: Level[] = (inventory?.location_levels ?? []).map((l: any) => ({
      id: l.id,
      location_id: l.location_id,
      stocked_quantity: Number(l.stocked_quantity ?? 0),
      reserved_quantity: Number(l.reserved_quantity ?? 0),
    }))

    return {
      id: v.id,
      title: v.title ?? "",
      sku: v.sku ?? null,
      manage_inventory: Boolean(v.manage_inventory),
      inventory_item_id: (v.inventory_items ?? [])[0]?.inventory_item_id ?? null,
      levels,
      stocked: levels.reduce((sum, l) => sum + l.stocked_quantity, 0),
      reserved: levels.reduce((sum, l) => sum + l.reserved_quantity, 0),
    }
  })

  return {
    id: raw.id,
    title: raw.title,
    thumbnail: raw.thumbnail ?? null,
    variants,
    stocked: variants.reduce((sum, v) => sum + v.stocked, 0),
    reserved: variants.reduce((sum, v) => sum + v.reserved, 0),
  }
}

/**
 * Склад.
 *
 * Штатный раздел «Inventory» показывает по строке на каждую вариацию, и
 * товар из десяти расцветок растягивается на десять строк — найти нужное
 * в таком списке тяжело. Здесь строка — это товар, а вариации со своими
 * остатками раскрываются по клику.
 *
 * Читает страница штатными эндпоинтами ядра, а пишет через собственный
 * /admin/stock/level: штатные маршруты остатков закрыты на запись, чтобы
 * остаток нельзя было поправить в обход этого раздела.
 */
const StockPage = () => {
  const [term, setTerm] = useState("")
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Черновики правок: ключ — id вариации. Пока продавец не нажал
  // «Сохранить», в базу ничего не уходит.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set())

  // Склад, на который заводится остаток вариации, у которой его ещё нет.
  const [locationId, setLocationId] = useState<string | null>(null)

  const termRef = useRef(term)
  termRef.current = term

  /**
   * Склад магазина.
   *
   * Нужен, чтобы завести строку остатка там, где её ещё нет. Склад в
   * магазине один, поэтому берём первый: появится второй — выбор придётся
   * делать явно, иначе остаток уедет не туда.
   */
  useEffect(() => {
    let cancelled = false

    const loadLocation = async () => {
      try {
        const response = await fetch("/admin/stock-locations", { credentials: "include" })
        const data = await response.json()

        if (!cancelled && response.ok) {
          setLocationId(data?.stock_locations?.[0]?.id ?? null)
        }
      } catch {
        // Без склада остаток просто не завести — страница скажет об этом
        // в строке вариации.
      }
    }

    loadLocation()

    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async (query: string) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        fields: FIELDS,
      })
      if (query.trim()) {
        params.set("q", query.trim())
      }

      const response = await fetch(`/admin/products?${params.toString()}`, {
        credentials: "include",
      })
      const data = await response.json()

      if (!response.ok) {
        setError(data?.message ?? "Не удалось загрузить остатки")
        return
      }

      // Пока ответ шёл, продавец мог набрать другой запрос — старый
      // результат затирать нельзя.
      if (termRef.current.trim() !== query.trim()) {
        return
      }

      setProducts((data.products ?? []).map(toProduct))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить остатки")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => load(term), 250)
    return () => clearTimeout(timer)
  }, [term, load])

  const toggle = (productId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }

  const save = async (variant: Variant) => {
    const level = variant.levels[0]
    // Пока строки остатка нет, её надо завести — на складе магазина.
    const target = level?.location_id ?? locationId

    if (!variant.inventory_item_id || !target) {
      return
    }

    const raw = drafts[variant.id]
    const quantity = Math.max(0, Math.floor(Number(raw)))
    if (!Number.isFinite(quantity)) {
      return
    }

    setSaving((c) => new Set(c).add(variant.id))
    setError(null)

    try {
      // Пишем через свой маршрут: штатные /admin/inventory-items* закрыты
      // на запись, чтобы остаток нельзя было поправить мимо этого раздела.
      //
      // Заводить строку остатка или править существующую, решает сам
      // маршрут: товар из импорта приезжает со складской позицией, но без
      // строки остатка — её Medusa создаёт не при создании товара, а когда
      // остаток впервые проставили.
      const response = await fetch("/admin/stock/level", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventory_item_id: variant.inventory_item_id,
          location_id: target,
          stocked_quantity: quantity,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        setError(data?.message ?? "Не удалось сохранить остаток")
        return
      }

      // У заведённой строки появился свой id — он приходит в ответе.
      const created: Level = {
        id: data?.level?.id ?? "",
        location_id: target,
        stocked_quantity: quantity,
        reserved_quantity: Number(data?.level?.reserved_quantity ?? 0),
      }

      setProducts((current) =>
        current.map((p) => {
          if (!p.variants.some((v) => v.id === variant.id)) {
            return p
          }
          const variants = p.variants.map((v) =>
            v.id === variant.id
              ? {
                  ...v,
                  stocked: quantity,
                  levels: v.levels.length
                    ? v.levels.map((l, i) =>
                        i === 0 ? { ...l, stocked_quantity: quantity } : l
                      )
                    : [created],
                }
              : v
          )
          return {
            ...p,
            variants,
            stocked: variants.reduce((sum, v) => sum + v.stocked, 0),
          }
        })
      )

      setDrafts((c) => {
        const next = { ...c }
        delete next[variant.id]
        return next
      })
      setSaved((c) => new Set(c).add(variant.id))
      setTimeout(() => {
        setSaved((c) => {
          const next = new Set(c)
          next.delete(variant.id)
          return next
        })
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить остаток")
    } finally {
      setSaving((c) => {
        const next = new Set(c)
        next.delete(variant.id)
        return next
      })
    }
  }

  const totals = useMemo(
    () => ({
      products: products.length,
      stocked: products.reduce((sum, p) => sum + p.stocked, 0),
    }),
    [products]
  )

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <Heading level="h1">Склад</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Товаров: {totals.products} · всего на складе: {totals.stocked}
        </Text>
      </div>

      <div className="px-6 py-4">
        <Input
          placeholder="Поиск по названию товара"
          value={term}
          autoComplete="off"
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>

      {error ? (
        <div className="px-6 py-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      <div>
        {loading && !products.length ? (
          <Text size="small" className="block px-6 py-8 text-ui-fg-muted">
            Загружаем…
          </Text>
        ) : !products.length ? (
          <Text size="small" className="block px-6 py-8 text-ui-fg-muted">
            {term.trim() ? "Ничего не нашлось" : "Товаров пока нет"}
          </Text>
        ) : (
          <ul className="divide-y">
            {products.map((product) => {
              const isOpen = expanded.has(product.id)

              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => toggle(product.id)}
                    className="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-ui-bg-base-hover"
                  >
                    <span className="w-4 text-ui-fg-muted">{isOpen ? "▾" : "▸"}</span>

                    {product.thumbnail ? (
                      <img
                        src={product.thumbnail}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <span className="h-10 w-10 rounded bg-ui-bg-subtle" />
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{product.title}</span>
                      <span className="block text-xs text-ui-fg-subtle">
                        {product.variants.length}{" "}
                        {product.variants.length === 1 ? "вариация" : "вариаций"}
                      </span>
                    </span>

                    {product.reserved > 0 ? (
                      <Badge size="2xsmall" color="orange">
                        в резерве {product.reserved}
                      </Badge>
                    ) : null}

                    <Badge size="2xsmall" color={product.stocked > 0 ? "green" : "red"}>
                      {product.stocked} шт.
                    </Badge>
                  </button>

                  {isOpen ? (
                    <div className="bg-ui-bg-subtle px-6 pb-3">
                      <ul className="divide-y divide-ui-border-base">
                        {product.variants.map((variant) => {
                          const draft = drafts[variant.id]
                          const changed =
                            draft !== undefined && Number(draft) !== variant.stocked
                          // Вариация без строки остатка тоже правится:
                          // первое сохранение эту строку и заведёт.
                          const editable =
                            variant.manage_inventory &&
                            variant.inventory_item_id &&
                            (variant.levels.length > 0 || locationId)

                          return (
                            <li
                              key={variant.id}
                              className="flex flex-wrap items-center gap-3 py-2 pl-7"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">
                                  {variant.title || "Без названия"}
                                </span>
                                <span className="block text-xs text-ui-fg-muted">
                                  {variant.sku ? `Артикул ${variant.sku}` : "Артикул не задан"}
                                  {variant.reserved > 0
                                    ? ` · в резерве ${variant.reserved}`
                                    : ""}
                                </span>
                              </span>

                              {editable ? (
                                <>
                                  <Input
                                    className="w-24"
                                    inputMode="numeric"
                                    value={draft ?? String(variant.stocked)}
                                    onChange={(e) =>
                                      setDrafts((c) => ({
                                        ...c,
                                        [variant.id]: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && changed) {
                                        e.preventDefault()
                                        save(variant)
                                      }
                                    }}
                                  />
                                  <Button
                                    size="small"
                                    variant={changed ? "primary" : "secondary"}
                                    disabled={!changed || saving.has(variant.id)}
                                    isLoading={saving.has(variant.id)}
                                    onClick={() => save(variant)}
                                  >
                                    {saved.has(variant.id) ? "Сохранено" : "Сохранить"}
                                  </Button>
                                </>
                              ) : (
                                <Text size="small" className="text-ui-fg-muted">
                                  {!variant.manage_inventory
                                    ? "учёт остатков выключен"
                                    : variant.inventory_item_id
                                      ? "склад не заведён"
                                      : "нет позиции на складе"}
                                </Text>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Склад",
  icon: Buildings,
})

export default StockPage
