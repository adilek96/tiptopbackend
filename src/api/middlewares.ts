import { defineMiddlewares } from "@medusajs/framework/http"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

/**
 * Ответ штатным экранам прайс-листов Medusa.
 *
 * Цены заводятся в разделе «Прайс-листы»: там у скидочной цены рядом
 * стоят закупочная и основная, а участие товара в акции решает тумблер
 * «Со скидкой» в его карточке. Лист, созданный штатным экраном, ничего
 * этого не знает: цены в нём действовали бы у всех товаров подряд, мимо
 * тумблера. Поэтому изменения закрыты.
 */
function priceListsAreReadOnly(
  _req: MedusaRequest,
  res: MedusaResponse,
  _next: MedusaNextFunction
): void {
  res.status(409).json({
    message:
      "Прайс-листы заводятся в разделе «Прайс-листы»: там у цены есть закупочная, " +
      "основная и тумблер «Со скидкой» у товара.",
  })
}

export default defineMiddlewares({
  routes: [
    {
      /**
       * Импорт из расширения присылает фото и видео прямо в теле запроса:
       * браузер продавца уже скачал их со страницы товара, и это надёжнее,
       * чем если бы файлы качал сервер. Стандартных 100 КБ на JSON тут
       * не хватает — до 15 изображений и одно видео в base64.
       *
       * Если бэкенд стоит за nginx, ему нужен такой же client_max_body_size,
       * иначе запрос отвалится с 413 ещё до Medusa.
       */
      matcher: "/admin/product-import",
      // Именно methods: поле method объявлено устаревшим, и загрузчик
      // конфигурации его не читает — лимит молча применился бы ко всем
      // методам сразу.
      methods: ["POST"],
      bodyParser: { sizeLimit: "60mb" },
    },

    /**
     * Касса. Ресурс pos придуман нами: политики в Medusa — это обычные
     * строки resource/operation, поэтому своя область прав заводится без
     * изменений в ядре.
     *
     * Роли раздаёт src/scripts/setup-roles.ts. Проверка включается только
     * при включённом флаге rbac — без него policies просто игнорируются.
     */
    {
      matcher: "/admin/pos/search",
      methods: ["GET"],
      policies: [{ resource: "pos", operation: "read" }],
    },
    {
      matcher: "/admin/pos/sale",
      methods: ["POST"],
      policies: [{ resource: "pos", operation: "create" }],
    },

    /**
     * Прайс-книга. Закупочная цена — коммерческая тайна магазина, и
     * видеть её должен не всякий, кто вошёл в админку: без объявленной
     * политики маршрут открыт в том числе кассиру.
     */
    {
      matcher: "/admin/price-book*",
      methods: ["GET"],
      policies: [{ resource: "price_book", operation: "read" }],
    },
    {
      matcher: "/admin/price-book*",
      methods: ["POST", "DELETE"],
      policies: [{ resource: "price_book", operation: "write" }],
    },

    /**
     * Штатные прайс-листы Medusa — только на чтение: чтение нужно самой
     * админке, а создание и изменение живут в разделе «Прайс-листы».
     */
    {
      matcher: "/admin/price-lists*",
      methods: ["POST", "DELETE"],
      middlewares: [priceListsAreReadOnly],
    },
  ],
})
