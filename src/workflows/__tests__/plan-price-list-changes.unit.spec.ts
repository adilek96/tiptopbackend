import { planPriceListChanges } from "../sync-discount-prices"
import type { DraftPrice, ExistingPrice } from "../sync-discount-prices"

const draft = (variantId: string, amount: number): DraftPrice => ({
  variant_id: variantId,
  amount,
  currency_code: "azn",
})

const existing = (id: string, variantId: string, amount: number): ExistingPrice => ({
  id,
  variant_id: variantId,
  amount,
  currency_code: "azn",
})

const all = () => true
const none = () => false

describe("planPriceListChanges", () => {
  it("кладёт цену в прайс-лист, когда у товара включена скидка", () => {
    const plan = planPriceListChanges({
      drafts: [draft("var_1", 8)],
      existing: [],
      isEnabled: all,
    })

    expect(plan.create).toEqual([draft("var_1", 8)])
    expect(plan.update).toEqual([])
    expect(plan.delete).toEqual([])
  })

  it("не кладёт цену, пока скидка у товара выключена", () => {
    const plan = planPriceListChanges({
      drafts: [draft("var_1", 8)],
      existing: [],
      isEnabled: none,
    })

    expect(plan).toEqual({ create: [], update: [], delete: [] })
  })

  it("убирает цену из прайс-листа, когда скидку выключили", () => {
    const plan = planPriceListChanges({
      drafts: [draft("var_1", 8)],
      existing: [existing("price_1", "var_1", 8)],
      isEnabled: none,
    })

    expect(plan.delete).toEqual(["price_1"])
    expect(plan.create).toEqual([])
  })

  it("правит цену, когда её поменяли", () => {
    const plan = planPriceListChanges({
      drafts: [draft("var_1", 7)],
      existing: [existing("price_1", "var_1", 8)],
      isEnabled: all,
    })

    expect(plan.update).toEqual([{ ...draft("var_1", 7), id: "price_1" }])
    expect(plan.delete).toEqual([])
  })

  it("ничего не делает, когда цена уже стоит правильная", () => {
    const plan = planPriceListChanges({
      drafts: [draft("var_1", 8)],
      existing: [existing("price_1", "var_1", 8)],
      isEnabled: all,
    })

    expect(plan).toEqual({ create: [], update: [], delete: [] })
  })

  // Ноль — допустимая цена, и «нет цены» от неё отличается: черновика с
  // нулём быть не должно только если продавец его не завёл сам.
  it("считает ноль обычной ценой", () => {
    const plan = planPriceListChanges({
      drafts: [draft("var_1", 0)],
      existing: [existing("price_1", "var_1", 8)],
      isEnabled: all,
    })

    expect(plan.update).toEqual([{ ...draft("var_1", 0), id: "price_1" }])
  })

  // Валюта входит в ключ: цена в манатах не должна затирать цену в другой
  // валюте у той же вариации.
  it("не путает цены разных валют", () => {
    const plan = planPriceListChanges({
      drafts: [draft("var_1", 8)],
      existing: [{ ...existing("price_usd", "var_1", 5), currency_code: "usd" }],
      isEnabled: all,
    })

    expect(plan.create).toEqual([draft("var_1", 8)])
    expect(plan.delete).toEqual(["price_usd"])
  })

  it("разбирает вариации одного товара по отдельности", () => {
    const plan = planPriceListChanges({
      drafts: [draft("var_1", 8), draft("var_2", 9)],
      existing: [existing("price_1", "var_1", 8)],
      isEnabled: (variantId) => variantId === "var_2",
    })

    expect(plan.create).toEqual([draft("var_2", 9)])
    expect(plan.delete).toEqual(["price_1"])
  })
})
