import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { POS_PAGE_HTML } from "./page"

/**
 * GET /pos
 *
 * Касса отдельной страницей, вне админки. Кассир открывает этот адрес,
 * входит своей учёткой и не видит ничего, кроме кассы.
 *
 * Маршрут намеренно публичный: сама страница — это просто HTML, а всё,
 * что за ней, закрыто. Вход идёт через /auth/user/emailpass, а продажа и
 * поиск — через /admin/pos/*, где права проверяются политиками ресурса
 * `pos`. Без роли «Кассир» страница откроется, но не сделает ничего.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  // Страница меняется только вместе с деплоем, но кассовый терминал должен
  // получать свежую версию сразу после него, а не через сутки.
  res.setHeader("Cache-Control", "no-cache")
  res.send(POS_PAGE_HTML)
}
