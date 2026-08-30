import { definePolicies } from "@medusajs/framework/utils"

/**
 * Права на прайс-книгу.
 *
 * Отдельная область прав нужна из-за закупочной цены: кассиру и любому
 * другому ограниченному пользователю видеть себестоимость незачем, а без
 * объявленной политики маршрут открыт всякому, кто вошёл в админку.
 *
 * Объявлять политики нужно именно здесь: при каждом старте модуль ролей
 * сверяет таблицу с этим каталогом и всё, чего в нём нет, удаляет.
 */
export const priceBookPolicies = definePolicies([
  {
    name: "ReadPriceBook",
    resource: "price_book",
    operation: "read",
    description: "Просмотр прайс-листов, включая закупочные цены",
  },
  {
    name: "WritePriceBook",
    resource: "price_book",
    operation: "write",
    description: "Изменение цен и скидочных прайс-листов",
  },
])
