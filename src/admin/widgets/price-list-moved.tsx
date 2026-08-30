import { Link } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Text } from "@medusajs/ui"

/**
 * Указатель на штатных экранах прайс-листов.
 *
 * Убрать сам раздел из бокового меню Medusa не даёт — его пункты зашиты
 * в админку, и расширение может только добавлять свои. Поэтому здесь
 * стоит указатель, а изменения на штатных маршрутах закрыты на бэкенде
 * (src/api/middlewares.ts): цены заводятся там, где рядом видно
 * закупочную, основную и тумблер «Со скидкой».
 */
const PriceListMoved = () => {
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Цены переехали</Heading>
      </div>
      <div className="flex items-center justify-between gap-x-4 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Этот экран остался только для просмотра. Прайс-листы магазина — закупочный, основной и
          скидочные — живут в своём разделе: там у цены рядом стоят закупочная и надбавка, а у
          товара — тумблер «Со скидкой».
        </Text>
        <Link to="/price-book">
          <Button size="small" variant="secondary">
            Открыть «Прайс-листы»
          </Button>
        </Link>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: ["price_list.list.before", "price_list.details.before"],
})

export default PriceListMoved
