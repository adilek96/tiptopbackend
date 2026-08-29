import ProductImportService from "../service"

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }

const service = () => new ProductImportService({ logger }, {})

/**
 * Варианты, снятые расширением со страницы продавца. Перевод к ним
 * применяется поверх, и главное требование — ни один настоящий SKU не должен
 * потеряться из-за качества перевода.
 */
describe("buildSkuCard", () => {
  const sku = {
    options: [
      { title: "颜色", values: ["红色", "蓝色"] },
      { title: "尺码", values: ["M", "L"] },
    ],
    variants: [
      { title: "红色 M", options: { 颜色: "红色", 尺码: "M" } },
      { title: "红色 L", options: { 颜色: "红色", 尺码: "L" } },
      { title: "蓝色 M", options: { 颜色: "蓝色", 尺码: "M" } },
    ],
  }

  it("переводит названия и значения по словарю модели", () => {
    const card = service().buildSkuCard(sku, {
      颜色: "Цвет",
      尺码: "Размер",
      红色: "Красный",
      蓝色: "Синий",
    })

    expect(card.options).toEqual([
      { title: "Цвет", values: ["Красный", "Синий"] },
      { title: "Размер", values: ["M", "L"] },
    ])
    expect(card.variants).toHaveLength(3)
    expect(card.variants[0]).toEqual({
      title: "Красный / M",
      options: { Цвет: "Красный", Размер: "M" },
    })
  })

  it("оставляет исходные строки, когда перевода нет", () => {
    const card = service().buildSkuCard(sku, { 颜色: "Цвет" })

    expect(card.options[0]).toEqual({ title: "Цвет", values: ["红色", "蓝色"] })
    expect(card.options[1].title).toBe("尺码")
    expect(card.variants).toHaveLength(3)
  })

  it("не теряет вариант, когда модель перевела два значения одинаково", () => {
    const card = service().buildSkuCard(sku, {
      颜色: "Цвет",
      红色: "Красный",
      蓝色: "Красный",
    })

    // Оба цвета остаются различимыми, иначе один SKU схлопнулся бы в другой.
    expect(card.options[0].values).toEqual(["Красный", "Красный (蓝色)"])
    expect(card.variants).toHaveLength(3)
  })

  it("выбрасывает комбинации, которые ссылаются на несуществующее значение", () => {
    const broken = {
      options: sku.options,
      variants: [
        ...sku.variants,
        { title: "битый", options: { 颜色: "绿色", 尺码: "M" } },
      ],
    }

    expect(service().buildSkuCard(broken, {}).variants).toHaveLength(3)
  })

  it("убирает дубли: Medusa не примет два варианта с одним набором значений", () => {
    const duplicated = {
      options: sku.options,
      variants: [...sku.variants, sku.variants[0]],
    }

    expect(service().buildSkuCard(duplicated, {}).variants).toHaveLength(3)
  })

  it("подставляет заглушку, если разобрать нечего", () => {
    const card = service().buildSkuCard({ options: [], variants: [] })

    expect(card.options).toEqual([{ title: "Вариант", values: ["Стандартный"] }])
    expect(card.variants).toHaveLength(1)
  })
})
