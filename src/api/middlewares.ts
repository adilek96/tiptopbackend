import { defineMiddlewares } from "@medusajs/framework/http"

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
  ],
})
