import { model } from "@medusajs/framework/utils"

/**
 * Скидочная цена вариации в конкретном прайс-листе.
 *
 * Это черновик, а не действующая цена: в прайс-лист Medusa она попадает
 * только когда у товара включён тумблер «Со скидкой». Поэтому цена и
 * хранится отдельно — выключенный тумблер убирает цену из расчёта, но не
 * стирает набранные значения, и после обратного включения ничего не надо
 * заполнять заново.
 */
const DiscountPrice = model
  .define("discount_price", {
    id: model.id().primaryKey(),
    price_list_id: model.text(),
    variant_id: model.text(),
    amount: model.bigNumber(),
    currency_code: model.text(),
  })
  .indexes([{ on: ["price_list_id", "variant_id"], unique: true }])

export default DiscountPrice
