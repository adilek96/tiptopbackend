import { model } from "@medusajs/framework/utils"

/**
 * Тумблер «Со скидкой» в карточке товара.
 *
 * Скидка действует на товар целиком, а не на отдельные вариации: продавец
 * решает, участвует ли товар в акции, а цены по вариациям набираются в
 * самом прайс-листе.
 *
 * Строки нет — значит выключено. Записи заводятся только для товаров,
 * которые хоть раз включали.
 */
const DiscountOptIn = model
  .define("discount_opt_in", {
    id: model.id().primaryKey(),
    product_id: model.text(),
    enabled: model.boolean().default(false),
  })
  .indexes([{ on: ["product_id"], unique: true }])

export default DiscountOptIn
