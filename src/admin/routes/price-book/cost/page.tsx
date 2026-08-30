import { Link } from "react-router-dom"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { PriceTable } from "../../../components/price-table"

/**
 * Закупочный прайс-лист.
 *
 * Одна колонка — цена, по которой товар куплен у поставщика. Покупателю
 * она не показывается нигде: эти цены лежат в отдельной таблице, до
 * которой движок цен не дотягивается.
 */
const CostPricesPage = () => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Закупочный прайс-лист</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Цена поставщика. Покупателю не показывается, нужна для подсчёта надбавки.
          </Text>
        </div>
        <Link to="/price-book">
          <Button size="small" variant="secondary">
            Все прайс-листы
          </Button>
        </Link>
      </div>
      <div className="px-6 py-4">
        <PriceTable listId="cost" kind="cost" />
      </div>
    </Container>
  )
}

export default CostPricesPage
