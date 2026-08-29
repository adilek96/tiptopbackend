/**
 * Генерация карточки товара по данным со страницы Taobao, 1688, AliExpress
 * или Amazon.
 *
 * Обычно данные снимает со страницы расширение для Chrome и присылает уже
 * разобранными: название, описание и настоящие SKU продавца. Тогда модель
 * ничего не выдумывает — только переводит текст и названия вариантов, а
 * структуру опций мы берём как есть.
 *
 * Если же в маршрут пришёл один текст без вариантов (вызов API напрямую),
 * модель восстанавливает варианты по описанию — как умеет.
 *
 * API DeepSeek OpenAI-совместимый, поэтому обходимся fetch без клиентской
 * библиотеки — как и в модуле поиска.
 */

export type ProductImportOptions = {
  apiKey?: string
  baseUrl?: string
  model?: string
}

/** Варианты, снятые расширением со страницы товара. */
export type KnownSku = {
  options: { title: string; values: string[] }[]
  variants: { title: string; options: Record<string, string> }[]
}

/** Что модель должна вернуть. */
export type GeneratedProduct = {
  title: string
  subtitle: string | null
  description: string
  tags: string[]
  options: { title: string; values: string[] }[]
  variants: { title: string; options: Record<string, string> }[]
}

type Logger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

/** Больше двадцати придуманных комбинаций продавцу не разгрести. */
const MAX_AI_VARIANTS = 20

/** Настоящие SKU режем только у совсем безумных карточек. */
const MAX_SKU_VARIANTS = 100

const BASE_PROMPT = `Ты помогаешь наполнять карточки интернет-магазина подарков и сувениров TipTop в Азербайджане.

На вход даётся текст со страницы товара на Taobao, 1688, AliExpress или Amazon. Он может быть на китайском или английском, содержать мусор: навигацию, отзывы, условия доставки, рекламу продавца.`

const COMMON_RULES = `- Пиши на русском, даже если исходник на другом языке.
- Описывай только то, что есть в исходном тексте. Не выдумывай характеристики, материалы, размеры и гарантии, которых там нет.
- Не переноси в описание условия доставки и оплаты продавца, названия магазина и упоминания площадки.
- Цены не указывай вообще: их проставляет продавец вручную.`

/** Текст вставлен руками: вариантов в нём нет, модель восстанавливает их сама. */
const SYSTEM_PROMPT = `${BASE_PROMPT}

Верни JSON строго такой формы:
{
  "title": "краткое название товара на русском, до 60 символов",
  "subtitle": "одна строка-подзаголовок на русском или null",
  "description": "описание на русском, 2-4 абзаца, обычным текстом без markdown",
  "tags": ["до 5 коротких тегов на русском"],
  "options": [{"title": "Цвет", "values": ["Красный", "Синий"]}],
  "variants": [{"title": "Красный", "options": {"Цвет": "Красный"}}]
}

Правила:
${COMMON_RULES}
- options — это реальные варианты выбора (цвет, размер, комплектация). Если в тексте их нет, верни options: [{"title": "Вариант", "values": ["Стандартный"]}] и один variant.
- Каждый variant должен указывать значение для каждой опции из options.
- Комбинаций variants не должно быть больше ${MAX_AI_VARIANTS}: если их получается больше, оставь самые ходовые.`

/** Варианты сняты со страницы: их надо перевести, а не сочинить заново. */
const SKU_SYSTEM_PROMPT = `${BASE_PROMPT}

Вместе с текстом даются варианты товара, снятые прямо со страницы продавца. Структуру вариантов менять нельзя — её мы соберём сами. От тебя нужен только перевод строк.

Верни JSON строго такой формы:
{
  "title": "краткое название товара на русском, до 60 символов",
  "subtitle": "одна строка-подзаголовок на русском или null",
  "description": "описание на русском, 2-4 абзаца, обычным текстом без markdown",
  "tags": ["до 5 коротких тегов на русском"],
  "option_translations": {"颜色": "Цвет", "红色": "Красный", "XL": "XL"}
}

Правила:
${COMMON_RULES}
- В option_translations ключ — исходная строка ровно в том виде, в каком она дана в блоке «ВАРИАНТЫ СО СТРАНИЦЫ», включая пробелы и регистр. Значение — перевод на русский.
- Переведи каждое название опции и каждое её значение, ничего не пропуская.
- Размеры, числа и латинские обозначения (XL, 2XL, 40x60 см) оставляй как есть.
- Разные исходные строки переводи разными словами: если два цвета перевести одинаково, продавец потеряет вариант.
- Не добавляй в option_translations строк, которых не было во входных данных, и не придумывай новых вариантов.`

export default class ProductImportService {
  private readonly logger: Logger
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string

  constructor(
    { logger }: { logger: Logger },
    options: ProductImportOptions = {}
  ) {
    this.logger = logger
    this.apiKey = options.apiKey ?? ""
    this.baseUrl = (options.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "")
    this.model = options.model || "deepseek-v4-flash"

    if (!this.isEnabled()) {
      this.logger.warn(
        "Генерация описаний выключена: не задан DEEPSEEK_API_KEY. Импорт будет создавать товар из вставленного текста как есть."
      )
    }
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey)
  }

  /**
   * Просит модель разобрать текст товара. Если переданы sku, снятые со
   * страницы, модель их только переводит: опции и варианты собираются из
   * них, а не из ответа модели.
   *
   * Возвращает null, если ключа нет или сервис недоступен — вызывающий код
   * тогда обходится без генерации.
   */
  async generate(
    rawText: string,
    sku?: KnownSku | null
  ): Promise<GeneratedProduct | null> {
    if (!this.isEnabled()) {
      return null
    }

    const text = rawText.trim()
    if (!text) {
      return null
    }

    const useSku = Boolean(sku?.options?.length && sku?.variants?.length)
    const userMessage = useSku
      ? `${text.slice(0, 24000)}\n\nВАРИАНТЫ СО СТРАНИЦЫ:\n${JSON.stringify(
          sku!.options,
          null,
          2
        ).slice(0, 8000)}`
      : text.slice(0, 24000)

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: useSku ? SKU_SYSTEM_PROMPT : SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      })

      if (!response.ok) {
        const body = await response.text()
        this.logger.error(
          `DeepSeek ответил ${response.status}: ${body.slice(0, 500)}`
        )
        return null
      }

      const payload = await response.json()
      const content = payload?.choices?.[0]?.message?.content

      if (!content) {
        this.logger.error("DeepSeek вернул пустой ответ")
        return null
      }

      return this.normalize(JSON.parse(content), useSku ? sku! : null)
    } catch (error) {
      this.logger.error(
        `Не удалось сгенерировать карточку: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return null
    }
  }

  /**
   * Собирает опции и варианты из настоящих SKU, переводя названия по словарю
   * от модели.
   *
   * Перевод здесь — косметика поверх структуры продавца: если модели не
   * хватило словаря или она схлопнула два цвета в одно слово, вариант всё
   * равно остаётся на месте под исходным написанием. Терять реальные SKU
   * из-за качества перевода нельзя.
   *
   * Публичный метод: им же пользуется маршрут импорта, когда генерация
   * выключена и переводить некому.
   */
  buildSkuCard(
    sku: KnownSku,
    rawTranslations?: unknown
  ): Pick<GeneratedProduct, "options" | "variants"> {
    const dictionary = new Map<string, string>()
    if (rawTranslations && typeof rawTranslations === "object") {
      for (const [key, value] of Object.entries(
        rawTranslations as Record<string, unknown>
      )) {
        const from = String(key).trim()
        const to = String(value ?? "").trim()
        if (from && to) {
          dictionary.set(from, to)
        }
      }
    }

    const options: GeneratedProduct["options"] = []
    /** Исходное название опции -> итоговое. Порядок важен для вариантов. */
    const optionTitles = new Map<string, string>()
    /** Исходное название опции -> (исходное значение -> итоговое). */
    const optionValues = new Map<string, Map<string, string>>()
    const usedTitles = new Set<string>()

    for (const option of sku.options ?? []) {
      const sourceTitle = String(option?.title ?? "").trim()
      if (!sourceTitle || optionTitles.has(sourceTitle)) {
        continue
      }

      const values: string[] = []
      const usedValues = new Set<string>()
      const mapping = new Map<string, string>()

      for (const rawValue of option?.values ?? []) {
        const source = String(rawValue).trim()
        if (!source || mapping.has(source)) {
          continue
        }

        let value = dictionary.get(source) || source
        if (usedValues.has(value)) {
          value = `${value} (${source})`
        }
        if (usedValues.has(value)) {
          continue
        }

        usedValues.add(value)
        mapping.set(source, value)
        values.push(value)
      }

      if (!values.length) {
        continue
      }

      let title = dictionary.get(sourceTitle) || sourceTitle
      if (usedTitles.has(title)) {
        title = `${title} (${sourceTitle})`
      }
      if (usedTitles.has(title)) {
        continue
      }

      usedTitles.add(title)
      optionTitles.set(sourceTitle, title)
      optionValues.set(sourceTitle, mapping)
      options.push({ title, values })
    }

    if (!options.length) {
      return this.defaultCard()
    }

    const variants: GeneratedProduct["variants"] = []
    const seen = new Set<string>()

    for (const variant of sku.variants ?? []) {
      const values: Record<string, string> = {}
      let complete = true

      for (const [sourceTitle, title] of optionTitles) {
        const source = String(variant?.options?.[sourceTitle] ?? "").trim()
        const value = optionValues.get(sourceTitle)!.get(source)

        // Вариант ссылается на значение, которого нет среди опций: такой
        // SKU Medusa не примет, пропускаем его целиком.
        if (!value) {
          complete = false
          break
        }

        values[title] = value
      }

      if (!complete) {
        continue
      }

      const key = JSON.stringify(values)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)

      variants.push({ title: Object.values(values).join(" / "), options: values })

      if (variants.length >= MAX_SKU_VARIANTS) {
        break
      }
    }

    if (!variants.length) {
      return this.defaultCard()
    }

    return { options, variants }
  }

  /** Опция-заглушка: Medusa требует хотя бы одну опцию и один вариант. */
  private defaultCard(): Pick<GeneratedProduct, "options" | "variants"> {
    return {
      options: [{ title: "Вариант", values: ["Стандартный"] }],
      variants: [{ title: "Стандартный", options: { Вариант: "Стандартный" } }],
    }
  }

  /**
   * Приводит ответ модели к тому, что примет Medusa.
   *
   * Medusa требует хотя бы одну опцию и хотя бы один вариант, а каждый
   * вариант обязан задавать значение для каждой опции. Модель это правило
   * иногда нарушает, поэтому чиним здесь, а не полагаемся на промпт.
   */
  private normalize(raw: any, sku: KnownSku | null): GeneratedProduct {
    const title = String(raw?.title ?? "").trim() || "Товар без названия"
    const subtitleRaw = raw?.subtitle
    const subtitle =
      typeof subtitleRaw === "string" && subtitleRaw.trim()
        ? subtitleRaw.trim()
        : null

    const tags = Array.isArray(raw?.tags)
      ? raw.tags
          .map((tag: unknown) => String(tag).trim())
          .filter(Boolean)
          .slice(0, 5)
      : []

    const card = sku
      ? this.buildSkuCard(sku, raw?.option_translations)
      : this.normalizeGeneratedCard(raw)

    return {
      title: title.slice(0, 120),
      subtitle,
      description: String(raw?.description ?? "").trim(),
      tags,
      options: card.options,
      variants: card.variants,
    }
  }

  /** Опции и варианты, придуманные моделью по тексту. */
  private normalizeGeneratedCard(
    raw: any
  ): Pick<GeneratedProduct, "options" | "variants"> {
    let options = Array.isArray(raw?.options)
      ? raw.options
          .map((option: any) => ({
            title: String(option?.title ?? "").trim(),
            values: Array.isArray(option?.values)
              ? ([
                  ...new Set(
                    option.values.map((v: unknown) => String(v).trim()).filter(Boolean)
                  ),
                ] as string[])
              : [],
          }))
          .filter((option: any) => option.title && option.values.length)
      : []

    if (!options.length) {
      options = [{ title: "Вариант", values: ["Стандартный"] }]
    }

    const rawVariants = Array.isArray(raw?.variants) ? raw.variants : []

    let variants = rawVariants
      .map((variant: any) => {
        const values: Record<string, string> = {}

        for (const option of options) {
          const provided = variant?.options?.[option.title]
          const value =
            typeof provided === "string" && option.values.includes(provided.trim())
              ? provided.trim()
              : option.values[0]
          values[option.title] = value
        }

        const title =
          String(variant?.title ?? "").trim() || Object.values(values).join(" / ")

        return { title, options: values }
      })
      .slice(0, MAX_AI_VARIANTS)

    // Убираем дубли по набору значений: Medusa не примет два одинаковых варианта.
    const seen = new Set<string>()
    variants = variants.filter((variant: GeneratedProduct["variants"][number]) => {
      const key = JSON.stringify(variant.options)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

    if (!variants.length) {
      const values: Record<string, string> = {}
      for (const option of options) {
        values[option.title] = option.values[0]
      }
      variants = [{ title: Object.values(values).join(" / "), options: values }]
    }

    return { options, variants }
  }
}
