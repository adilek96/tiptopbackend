import type { ProductDTO } from "@medusajs/framework/types"

/**
 * Обёртка над HTTP-API Meilisearch.
 *
 * Клиентская библиотека сознательно не используется: в package.json все
 * пакеты @medusajs/* стоят как "latest", и npm install ради одной зависимости
 * переустановил бы Medusa с 2.0.7 на актуальную мажорную версию. Нужны нам
 * всего четыре запроса, поэтому ходим в REST напрямую через fetch.
 */

export type MeilisearchModuleOptions = {
  host?: string
  apiKey?: string
  indexName?: string
}

/** Документ, который кладём в индекс. */
export type ProductSearchDocument = {
  id: string
  handle: string
  title: string
  subtitle: string | null
  description: string | null
  thumbnail: string | null
  tags: string[]
  category_names: string[]
  category_handles: string[]
  variant_titles: string[]
  collection_title: string | null
}

type Logger = {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export default class MeilisearchModuleService {
  private readonly logger: Logger
  private readonly host: string
  private readonly apiKey: string
  private readonly indexName: string

  constructor({ logger }: { logger: Logger }, options: MeilisearchModuleOptions = {}) {
    this.logger = logger
    this.host = (options.host ?? "").replace(/\/+$/, "")
    this.apiKey = options.apiKey ?? ""
    this.indexName = options.indexName || "products"

    if (!this.isEnabled()) {
      this.logger.warn(
        "Meilisearch не настроен (нет MEILISEARCH_HOST или MEILISEARCH_API_KEY) — поиск отключён"
      )
    }
  }

  /**
   * Без настроек модуль работает вхолостую, а не роняет приложение:
   * магазин должен подниматься и когда поиск недоступен.
   */
  isEnabled(): boolean {
    return Boolean(this.host && this.apiKey)
  }

  private async request<T = any>(
    path: string,
    init: RequestInit = {}
  ): Promise<T | null> {
    if (!this.isEnabled()) {
      return null
    }

    try {
      const response = await fetch(`${this.host}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
      })

      if (!response.ok) {
        const body = await response.text()
        this.logger.error(
          `Meilisearch ответил ${response.status} на ${init.method ?? "GET"} ${path}: ${body}`
        )
        return null
      }

      return (await response.json()) as T
    } catch (error) {
      this.logger.error(
        `Meilisearch недоступен (${init.method ?? "GET"} ${path}): ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return null
    }
  }

  /**
   * Создаёт индекс, если его нет, и приводит настройки к нужным.
   * Вызывается при старте и из скрипта переиндексации — идемпотентно.
   */
  async ensureIndex(): Promise<void> {
    if (!this.isEnabled()) {
      return
    }

    await this.request("/indexes", {
      method: "POST",
      body: JSON.stringify({ uid: this.indexName, primaryKey: "id" }),
    })

    await this.request(`/indexes/${this.indexName}/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        searchableAttributes: [
          "title",
          "subtitle",
          "variant_titles",
          "category_names",
          "tags",
          "description",
        ],
        filterableAttributes: ["category_handles", "tags"],
        displayedAttributes: ["*"],
        // Опечатки в коротких словах прощаем неохотно: названия товаров
        // короткие, и агрессивный fuzzy-поиск даёт мусор.
        typoTolerance: {
          enabled: true,
          minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
        },
      }),
    })
  }

  private indexReady: Promise<void> | null = null

  /** ensureIndex, но не чаще одного раза за жизнь процесса. */
  private ensureIndexOnce(): Promise<void> {
    this.indexReady ??= this.ensureIndex()
    return this.indexReady
  }

  /** Приводит товар Medusa к документу индекса. */
  toDocument(product: ProductDTO): ProductSearchDocument {
    return {
      id: product.id,
      handle: product.handle,
      title: product.title,
      subtitle: product.subtitle ?? null,
      description: product.description ?? null,
      thumbnail: product.thumbnail ?? null,
      tags: (product.tags ?? []).map((tag) => tag.value).filter(Boolean),
      category_names: (product.categories ?? []).map((c) => c.name).filter(Boolean),
      category_handles: (product.categories ?? []).map((c) => c.handle).filter(Boolean),
      variant_titles: (product.variants ?? [])
        .map((variant) => variant.title)
        .filter((title): title is string => Boolean(title)),
      collection_title: product.collection?.title ?? null,
    }
  }

  async upsertProducts(products: ProductDTO[]): Promise<void> {
    if (!products.length) {
      return
    }

    // Индекс создаётся при первой записи, а не при загрузке приложения:
    // недоступный Meilisearch не должен мешать бэкенду подняться.
    await this.ensureIndexOnce()

    const documents = products.map((product) => this.toDocument(product))

    await this.request(`/indexes/${this.indexName}/documents?primaryKey=id`, {
      method: "PUT",
      body: JSON.stringify(documents),
    })
  }

  async deleteProducts(ids: string[]): Promise<void> {
    if (!ids.length) {
      return
    }

    await this.request(`/indexes/${this.indexName}/documents/delete-batch`, {
      method: "POST",
      body: JSON.stringify(ids),
    })
  }

  async search(
    query: string,
    { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}
  ): Promise<{ hits: ProductSearchDocument[]; estimatedTotalHits: number }> {
    const result = await this.request<{
      hits: ProductSearchDocument[]
      estimatedTotalHits: number
    }>(`/indexes/${this.indexName}/search`, {
      method: "POST",
      body: JSON.stringify({ q: query, limit, offset }),
    })

    return result ?? { hits: [], estimatedTotalHits: 0 }
  }
}
