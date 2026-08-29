import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import {
  Alert,
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Label,
  Select,
  Text,
} from "@medusajs/ui"
import { useEffect, useMemo, useRef, useState } from "react"

type PosVariant = {
  variant_id: string
  product_id: string
  product_title: string
  variant_title: string
  sku: string | null
  barcode: string | null
  thumbnail: string | null
  unit_price: number | null
  currency_code: string | null
}

type CartLine = PosVariant & { quantity: number; discount: number }

type Receipt = {
  items: {
    title: string
    variant_title: string
    quantity: number
    unit_price: number
    line_total: number
    discount: number
  }[]
  subtotal: number
  discount_total: number
  total: number
  currency_code: string
  payment_method: string
  customer_name: string | null
  customer_phone: string | null
}

type SaleResponse = {
  order: { id: string; display_id: number | null; created_at: string }
  receipt: Receipt
  payment_recorded: boolean
  stock_deducted: boolean
}

const round = (value: number) => Math.round(value * 100) / 100

const money = (value: number, currency: string) =>
  `${value.toFixed(2)} ${currency.toUpperCase()}`

/**
 * Касса.
 *
 * Сканер штрихкодов ведёт себя как клавиатура: набирает код и жмёт Enter.
 * Поэтому по Enter в строке поиска, если нашлась ровно одна позиция, она
 * сразу падает в чек — кассиру не нужно ничего дожимать мышью.
 */
const PosPage = () => {
  const [term, setTerm] = useState("")
  const [found, setFound] = useState<PosVariant[]>([])
  const [searching, setSearching] = useState(false)

  const [cart, setCart] = useState<CartLine[]>([])
  const [orderDiscount, setOrderDiscount] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [cashGiven, setCashGiven] = useState("")

  const [selling, setSelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sale, setSale] = useState<SaleResponse | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  const currency = cart[0]?.currency_code ?? found[0]?.currency_code ?? "azn"

  const subtotal = useMemo(
    () => round(cart.reduce((sum, line) => sum + (line.unit_price ?? 0) * line.quantity, 0)),
    [cart]
  )
  const lineDiscounts = useMemo(
    () => round(cart.reduce((sum, line) => sum + line.discount, 0)),
    [cart]
  )
  const orderDiscountValue = Math.min(
    Math.max(round(Number(orderDiscount) || 0), 0),
    round(subtotal - lineDiscounts)
  )
  const total = round(subtotal - lineDiscounts - orderDiscountValue)
  const change = round((Number(cashGiven) || 0) - total)

  // Поиск с задержкой: сканер вводит код разом, а человек — по букве.
  useEffect(() => {
    const query = term.trim()
    if (query.length < 2) {
      setFound([])
      return
    }

    let cancelled = false
    setSearching(true)

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/admin/pos/search?q=${encodeURIComponent(query)}`,
          { credentials: "include" }
        )
        const data = await response.json()
        if (cancelled) return
        setFound(response.ok ? (data.variants ?? []) : [])
        if (!response.ok) setError(data?.message ?? null)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term])

  const addToCart = (variant: PosVariant) => {
    setCart((current) => {
      const existing = current.find((line) => line.variant_id === variant.variant_id)
      if (existing) {
        return current.map((line) =>
          line.variant_id === variant.variant_id
            ? { ...line, quantity: line.quantity + 1 }
            : line
        )
      }
      return [...current, { ...variant, quantity: 1, discount: 0 }]
    })
    setTerm("")
    setFound([])
    searchRef.current?.focus()
  }

  const updateLine = (variantId: string, patch: Partial<CartLine>) => {
    setCart((current) =>
      current.map((line) =>
        line.variant_id === variantId ? { ...line, ...patch } : line
      )
    )
  }

  const removeLine = (variantId: string) => {
    setCart((current) => current.filter((line) => line.variant_id !== variantId))
  }

  const resetSale = () => {
    setCart([])
    setOrderDiscount("")
    setCustomerName("")
    setCustomerPhone("")
    setCashGiven("")
    setSale(null)
    setError(null)
    searchRef.current?.focus()
  }

  const sell = async () => {
    if (!cart.length) return
    setSelling(true)
    setError(null)

    try {
      const response = await fetch("/admin/pos/sale", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((line) => ({
            variant_id: line.variant_id,
            quantity: line.quantity,
            discount: line.discount,
          })),
          order_discount: orderDiscountValue,
          payment_method: paymentMethod,
          customer: { name: customerName, phone: customerPhone },
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data?.message ?? "Не удалось провести продажу")
        return
      }

      setSale(data as SaleResponse)
      setCart([])
      setOrderDiscount("")
      setCashGiven("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось провести продажу")
    } finally {
      setSelling(false)
    }
  }

  // --- Чек после продажи ----------------------------------------------------

  if (sale) {
    const r = sale.receipt
    return (
      <Container className="p-0">
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            #pos-receipt, #pos-receipt * { visibility: visible !important; }
            #pos-receipt { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
            .pos-no-print { display: none !important; }
          }
        `}</style>

        <div className="flex items-center justify-between px-6 py-4 pos-no-print">
          <Heading level="h1">Продажа проведена</Heading>
          <div className="flex gap-x-2">
            <Button variant="secondary" onClick={() => window.print()}>
              Печать чека
            </Button>
            <Button onClick={resetSale}>Новая продажа</Button>
          </div>
        </div>

        {!sale.payment_recorded || !sale.stock_deducted ? (
          <div className="px-6 pb-4 pos-no-print">
            <Alert variant="warning">
              Заказ создан, но
              {!sale.payment_recorded ? " оплата не отмечена" : ""}
              {!sale.payment_recorded && !sale.stock_deducted ? " и" : ""}
              {!sale.stock_deducted ? " остатки не списаны" : ""}. Поправьте в
              карточке заказа вручную.
            </Alert>
          </div>
        ) : null}

        <div id="pos-receipt" className="mx-auto max-w-md px-6 py-6 text-sm">
          <div className="text-center">
            <div className="text-lg font-bold">TipTop</div>
            <div className="text-xs">
              Заказ {sale.order.display_id ? `№${sale.order.display_id}` : sale.order.id}
            </div>
            <div className="text-xs">
              {new Date(sale.order.created_at).toLocaleString("ru-RU")}
            </div>
          </div>

          <div className="my-3 border-t border-dashed" />

          {r.items.map((item, i) => (
            <div key={i} className="mb-2">
              <div className="font-medium">{item.title}</div>
              {item.variant_title ? (
                <div className="text-xs">{item.variant_title}</div>
              ) : null}
              <div className="flex justify-between">
                <span>
                  {item.quantity} × {money(item.unit_price, r.currency_code)}
                </span>
                <span>{money(item.line_total, r.currency_code)}</span>
              </div>
              {item.discount > 0 ? (
                <div className="flex justify-between text-xs">
                  <span>скидка</span>
                  <span>−{money(item.discount, r.currency_code)}</span>
                </div>
              ) : null}
            </div>
          ))}

          <div className="my-3 border-t border-dashed" />

          <div className="flex justify-between">
            <span>Сумма</span>
            <span>{money(r.subtotal, r.currency_code)}</span>
          </div>
          {r.discount_total > 0 ? (
            <div className="flex justify-between">
              <span>Скидка</span>
              <span>−{money(r.discount_total, r.currency_code)}</span>
            </div>
          ) : null}
          <div className="mt-1 flex justify-between text-base font-bold">
            <span>Итого</span>
            <span>{money(r.total, r.currency_code)}</span>
          </div>
          <div className="mt-1 flex justify-between text-xs">
            <span>Оплата</span>
            <span>{r.payment_method}</span>
          </div>

          {r.customer_name || r.customer_phone ? (
            <div className="mt-2 text-xs">
              Покупатель: {[r.customer_name, r.customer_phone].filter(Boolean).join(", ")}
            </div>
          ) : null}

          <div className="my-3 border-t border-dashed" />
          <div className="text-center text-xs">Спасибо за покупку!</div>
        </div>
      </Container>
    )
  }

  // --- Экран продажи --------------------------------------------------------

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Касса</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Отсканируйте штрихкод или найдите товар по названию
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-6 border-t px-6 py-4 lg:grid-cols-2">
        {/* Поиск */}
        <div className="flex flex-col gap-y-3">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="pos-search" size="small" weight="plus">
              Товар
            </Label>
            <Input
              id="pos-search"
              ref={searchRef}
              autoFocus
              autoComplete="off"
              placeholder="Штрихкод, артикул или название"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                // Сканер заканчивает ввод Enter — если нашлась одна позиция,
                // добавляем её сразу.
                if (e.key === "Enter" && found.length === 1) {
                  e.preventDefault()
                  addToCart(found[0])
                }
              }}
            />
          </div>

          <div className="min-h-[8rem] rounded-lg border">
            {searching && !found.length ? (
              <Text size="small" className="block p-4 text-ui-fg-muted">
                Ищем…
              </Text>
            ) : found.length ? (
              <ul className="divide-y">
                {found.map((variant) => (
                  <li key={variant.variant_id}>
                    <button
                      type="button"
                      onClick={() => addToCart(variant)}
                      disabled={variant.unit_price === null}
                      className="flex w-full items-center gap-3 p-3 text-left hover:bg-ui-bg-base-hover disabled:opacity-50"
                    >
                      {variant.thumbnail ? (
                        <img
                          src={variant.thumbnail}
                          alt=""
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <span className="h-10 w-10 rounded bg-ui-bg-subtle" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {variant.product_title}
                        </span>
                        <span className="block truncate text-xs text-ui-fg-subtle">
                          {variant.variant_title}
                          {variant.sku ? ` · ${variant.sku}` : ""}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-semibold">
                        {variant.unit_price === null
                          ? "нет цены"
                          : money(variant.unit_price, variant.currency_code ?? currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Text size="small" className="block p-4 text-ui-fg-muted">
                {term.trim().length >= 2 ? "Ничего не нашлось" : "Начните ввод"}
              </Text>
            )}
          </div>
        </div>

        {/* Чек */}
        <div className="flex flex-col gap-y-3">
          <Label size="small" weight="plus">
            Чек
          </Label>

          <div className="rounded-lg border">
            {cart.length === 0 ? (
              <Text size="small" className="block p-4 text-ui-fg-muted">
                Пусто
              </Text>
            ) : (
              <ul className="divide-y">
                {cart.map((line) => (
                  <li key={line.variant_id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{line.product_title}</div>
                        <div className="truncate text-xs text-ui-fg-subtle">
                          {line.variant_title}
                        </div>
                      </div>
                      <IconButton
                        size="small"
                        variant="transparent"
                        onClick={() => removeLine(line.variant_id)}
                        aria-label="Убрать позицию"
                      >
                        ✕
                      </IconButton>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1">
                        <IconButton
                          size="small"
                          variant="transparent"
                          onClick={() =>
                            updateLine(line.variant_id, {
                              quantity: Math.max(1, line.quantity - 1),
                            })
                          }
                          aria-label="Меньше"
                        >
                          −
                        </IconButton>
                        <Input
                          className="w-16 text-center"
                          value={String(line.quantity)}
                          onChange={(e) =>
                            updateLine(line.variant_id, {
                              quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                            })
                          }
                        />
                        <IconButton
                          size="small"
                          variant="transparent"
                          onClick={() =>
                            updateLine(line.variant_id, { quantity: line.quantity + 1 })
                          }
                          aria-label="Больше"
                        >
                          +
                        </IconButton>
                      </div>

                      <Input
                        className="w-28"
                        placeholder="скидка"
                        value={line.discount ? String(line.discount) : ""}
                        onChange={(e) =>
                          updateLine(line.variant_id, {
                            discount: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                      />

                      <span className="ml-auto whitespace-nowrap font-semibold">
                        {money(
                          round((line.unit_price ?? 0) * line.quantity - line.discount),
                          currency
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="pos-order-discount" size="small">
                Скидка на чек
              </Label>
              <Input
                id="pos-order-discount"
                placeholder="0"
                value={orderDiscount}
                onChange={(e) => setOrderDiscount(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="pos-payment" size="small">
                Оплата
              </Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <Select.Trigger id="pos-payment">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="cash">Наличные</Select.Item>
                  <Select.Item value="card">Карта</Select.Item>
                  <Select.Item value="transfer">Перевод</Select.Item>
                </Select.Content>
              </Select>
            </div>
          </div>

          {paymentMethod === "cash" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-y-2">
                <Label htmlFor="pos-cash" size="small">
                  Получено наличными
                </Label>
                <Input
                  id="pos-cash"
                  placeholder="0"
                  value={cashGiven}
                  onChange={(e) => setCashGiven(e.target.value)}
                />
              </div>
              <div className="flex flex-col justify-end">
                <Text size="small" className={change < 0 ? "text-ui-fg-error" : ""}>
                  Сдача: {money(Math.max(change, 0), currency)}
                  {change < 0 ? ` (не хватает ${money(-change, currency)})` : ""}
                </Text>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="pos-name" size="small">
                Имя покупателя
              </Label>
              <Input
                id="pos-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="pos-phone" size="small">
                Телефон
              </Label>
              <Input
                id="pos-phone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="flex justify-between text-sm">
              <span>Сумма</span>
              <span>{money(subtotal, currency)}</span>
            </div>
            {lineDiscounts + orderDiscountValue > 0 ? (
              <div className="flex justify-between text-sm">
                <span>Скидка</span>
                <span>−{money(round(lineDiscounts + orderDiscountValue), currency)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between text-lg font-bold">
              <span>Итого</span>
              <span>{money(total, currency)}</span>
            </div>
          </div>

          {error ? <Alert variant="error">{error}</Alert> : null}

          <Button
            size="large"
            onClick={sell}
            isLoading={selling}
            disabled={!cart.length || selling}
          >
            Продать
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Касса",
  icon: CurrencyDollar,
})

export default PosPage
