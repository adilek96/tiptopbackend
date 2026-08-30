import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { Container, Heading, Switch, Text, toast } from "@medusajs/ui"
import { errorText, sdk } from "../lib/sdk"

/**
 * Тумблер «Со скидкой» в карточке товара.
 *
 * Скидочные прайс-листы задают цену, но не решают, кто в акции
 * участвует, — это решает продавец здесь, по товару целиком. Цена в
 * прайс-листе может быть набрана заранее: пока тумблер выключен, она
 * лежит черновиком и на витрину не попадает.
 *
 * Переключение применяется сразу: цены товара тут же появляются в
 * действующих прайс-листах или уходят из них.
 */
const ProductDiscountToggle = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)

      try {
        const response = await sdk.client.fetch<{ enabled: boolean }>(
          "/admin/price-book/discount-opt-in",
          { query: { product_id: data.id } }
        )

        if (!cancelled) {
          setEnabled(response.enabled)
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(errorText(error))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [data.id])

  async function toggle(next: boolean) {
    setSaving(true)
    // Показываем новое положение сразу: запрос переносит цены в
    // прайс-листы и может занять секунду, а тумблер, который «think»
    // подвисает, продавец нажмёт второй раз.
    setEnabled(next)

    try {
      await sdk.client.fetch("/admin/price-book/discount-opt-in", {
        method: "POST",
        body: { product_id: data.id, enabled: next },
      })

      toast.success(next ? "Товар участвует в акциях" : "Товар убран из акций")
    } catch (error) {
      setEnabled(!next)
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Со скидкой</Heading>
      </div>
      <div className="flex items-center justify-between gap-x-4 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Пока включено, товар продаётся по цене из действующего скидочного прайс-листа. Саму
          цену задают в разделе{" "}
          <Link to="/price-book" className="text-ui-fg-interactive">
            «Прайс-листы»
          </Link>
          .
        </Text>
        <Switch checked={enabled} onCheckedChange={toggle} disabled={loading || saving} />
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default ProductDiscountToggle
