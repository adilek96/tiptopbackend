import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MEILISEARCH_MODULE } from "../../../modules/meilisearch"
import type MeilisearchModuleService from "../../../modules/meilisearch/service"

const MAX_LIMIT = 50

/**
 * GET /store/search?q=подарок&limit=20&offset=0
 *
 * Поиск живёт на стороне Medusa, а не в браузере: так Meilisearch остаётся
 * внутри сети сервера и наружу не выставлен. Витрина ходит сюда обычным
 * store-запросом с публичным ключом.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const query = String(req.query.q ?? "").trim()

  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
    MAX_LIMIT
  )
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0)

  if (!query) {
    res.json({ query: "", hits: [], count: 0 })
    return
  }

  const search: MeilisearchModuleService = req.scope.resolve(MEILISEARCH_MODULE)
  const { hits, estimatedTotalHits } = await search.search(query, { limit, offset })

  res.json({ query, hits, count: estimatedTotalHits })
}
