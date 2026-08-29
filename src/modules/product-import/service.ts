/**
 * Генерация карточки товара из текста, скопированного с Taobao, Amazon
 * или Alibaba.
 *
 * Страницы этих площадок мы не забираем сами: они закрыты антибот-защитой,
 * и запрос с сервера в датацентре почти всегда упирается в капчу. Вместо
 * этого продавец вставляет текст и ссылки на фото руками, а модель приводит
 * их к нормальной карточке на русском.
 *
 * API DeepSeek OpenAI-совместимый, поэтому обходимся fetch без клиентской
 * библиотеки — как и в модуле поиска.
 */

export type ProductImportOptions = {
  apiKey?: string
  baseUrl?: string
  model?: string
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

const SYSTEM_PROMPT = `Ты помогаешь наполнять карточки интернет-магазина подарков и сувениров TipTop в Азербайджане.

На вход даётся текст, скопированный со страницы товара на Taobao, Amazon или Alibaba. Он может быть на китайском или английском, содержать мусор: навигацию, отзывы, условия доставки, рекламу продавца.

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
- Пиши на русском, даже если исходник на другом языке.
- Описывай только то, что есть в исходном тексте. Не выдумывай характеристики, материалы, размеры и гарантии, которых там нет.
- Не переноси в описание условия доставки и оплаты продавца, названия магазина и упоминания площадки.
- options — это реальные варианты выбора (цвет, размер, комплектация). Если в тексте их нет, верни options: [{"title": "Вариант", "values": ["Стандартный"]}] и один variant.
- Каждый variant должен указывать значение для каждой опции из options.
- Комбинаций variants не должно быть больше 20: если их получается больше, оставь самые ходовые.
- Цены не указывай вообще: их проставляет продавец вручную.`

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
   * Просит модель разобрать вставленный текст. Возвращает null, если ключа
   * нет или сервис недоступен — вызывающий код тогда обходится без генерации.
   */
  async generate(rawText: string): Promise<GeneratedProduct | null> {
    if (!this.isEnabled()) {
      return null
    }

    const text = rawText.trim()
    if (!text) {
      return null
    }

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
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text.slice(0, 24000) },
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

      return this.normalize(JSON.parse(content))
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
   * Приводит ответ модели к тому, что примет Medusa.
   *
   * Medusa требует хотя бы одну опцию и хотя бы один вариант, а каждый
   * вариант обязан задавать значение для каждой опции. Модель это правило
   * иногда нарушает, поэтому чиним здесь, а не полагаемся на промпт.
   */
  private normalize(raw: any): GeneratedProduct {
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

    let options = Array.isArray(raw?.options)
      ? raw.options
          .map((option: any) => ({
            title: String(option?.title ?? "").trim(),
            values: Array.isArray(option?.values)
              ? [
                  ...new Set(
                    option.values.map((v: unknown) => String(v).trim()).filter(Boolean)
                  ),
                ] as string[]
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
      .slice(0, 20)

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

    return {
      title: title.slice(0, 120),
      subtitle,
      description: String(raw?.description ?? "").trim(),
      tags,
      options,
      variants,
    }
  }
}
