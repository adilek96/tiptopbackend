import { Link } from "react-router-dom"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { PriceTable } from "../../../components/price-table"

/**
 * Основной прайс-лист.
 *
 * Цена, по которой магазин продаёт товар, пока не идёт акция. Рядом —
 * закупочная из закупочного листа и надбавка: сколько магазин
 * зарабатывает на вариации в манатах и процентах.
 *
 * Технически это базовая цена вариации в Medusa, поэтому список нельзя
 * ни удалить, ни просрочить: без него товар просто не продаётся.
 */
const MainPricesPage = () => {
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Основной прайс-лист</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Цена продажи вне акций. Закупочная подтягивается из закупочного листа.
          </Text>
        </div>
        <Link to="/price-book">
          <Button size="small" variant="secondary">
            Все прайс-листы
          </Button>
        </Link>
      </div>
      <div className="px-6 py-4">
        <PriceTable listId="main" kind="main" />
      </div>
    </Container>
  )
}

export default MainPricesPage
