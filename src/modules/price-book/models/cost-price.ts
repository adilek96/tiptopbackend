import { model } from "@medusajs/framework/utils"

/**
 * Закупочная цена вариации — сколько магазин заплатил за товар поставщику.
 *
 * Хранится своей таблицей, а не прайс-листом Medusa, и это принципиально.
 * Любой прайс-лист участвует в расчёте цены: стоит ошибиться со статусом
 * или правилом — и закупочная цена уедет покупателю в /store/products.
 * Своя таблица движку цен не видна вовсе, поэтому такая ошибка здесь
 * невозможна по построению.
 */
const CostPrice = model
  .define("cost_price", {
    id: model.id().primaryKey(),
    variant_id: model.text(),
    amount: model.bigNumber(),
    currency_code: model.text(),
  })
  .indexes([{ on: ["variant_id"], unique: true }])

export default CostPrice
