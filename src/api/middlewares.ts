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

/**
 * Ответ штатным экранам остатков Medusa.
 *
 * Остаток проставляется в разделе «Склад»: там строка — это товар со
 * своими вариациями, а не безымянная складская позиция. Штатный экран
 * Inventory правит ту же строку в обход раздела, поэтому запись закрыта,
 * а раздел «Склад» ходит в собственный /admin/stock/level.
 *
 * Списания при продаже это не касается: отгрузка заказа идёт рабочим
 * процессом ядра и до HTTP-маршрутов не доходит.
 */
function inventoryIsReadOnly(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  // Выгрузка остатков в файл — это чтение, хотя маршрут и POST. Запрещать
  // её незачем, а продавцу она нужна для сверки на складе.
  if (req.path.endsWith("/export")) {
    next()
    return
  }

  res.status(409).json({
    message:
      "Остатки проставляются в разделе «Склад»: там видно товар целиком, " +
      "а не отдельную складскую позицию.",
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
     * Склад. Свой маршрут правки остатка — взамен закрытых ниже штатных.
     * Кассиру остатки менять незачем, поэтому нужна политика: без неё
     * маршрут открыт всякому, кто вошёл в админку.
     */
    {
      matcher: "/admin/stock/level",
      methods: ["POST"],
      policies: [{ resource: "stock", operation: "write" }],
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

    /**
     * Штатные остатки и резервы Medusa — только на чтение. Чтение нужно
     * самой админке (и разделу «Склад», он читает остатки вместе с
     * товарами), а запись идёт через /admin/stock/level.
     *
     * Под matcher попадают и пакетные маршруты — /admin/inventory-items/
     * location-levels/batch и его вариант внутри позиции: правка остатка
     * из карточки товара шла бы именно туда.
     */
    {
      matcher: "/admin/inventory-items*",
      methods: ["POST", "DELETE"],
      middlewares: [inventoryIsReadOnly],
    },
    {
      matcher: "/admin/reservations*",
      methods: ["POST", "DELETE"],
      middlewares: [inventoryIsReadOnly],
    },
  ],
})
