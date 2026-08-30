import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    workerMode: "shared",
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    databaseDriverOptions: { ssl: false },


    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  admin: {
    disable: false,
  },
  // Роли и права. Нужны, чтобы кассир получал доступ только к кассе и
  // не видел товары, заказы и настройки магазина.
  //
  // Флаг включает проверку политик на 54 маршрутах ядра разом, а
  // пользователь без ролей получает Forbidden. Поэтому роли раздаются
  // скриптом src/scripts/setup-roles.ts, и его нужно прогнать сразу
  // после первого деплоя с этим флагом — иначе админка окажется пустой.
  featureFlags: {
    rbac: true,
    // Переводы контента. В Medusa помечены как экспериментальные: набор
    // переводимых полей ещё меняется от версии к версии.
    translation: true,
  },
  plugins: [
    {
      // Своя обложка и свой набор картинок для каждой вариации товара.
      // Плагин хранит их в metadata вариации, поэтому витрина обязана
      // запрашивать поле metadata явно — см. app/services витрины.
      resolve: "medusa-variant-images",
      options: {},
    },
    {
      // Раздел «Analytics» в админке: продажи, заказы, покупатели.
      // Настроек нет, всё задаётся в интерфейсе.
      resolve: "@rsc-labs/medusa-store-analytics-v2",
      options: {},
    },
  ],
  modules: [
    {
      // Переводы названий и описаний товаров. Магазин русскоязычный,
      // азербайджанская версия добавляется через админку без правки кода.
      resolve: "@medusajs/medusa/translation",
    },
    {
      resolve: "@medusajs/medusa/cache-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.REDIS_URL,
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: {
        redis: {
          url: process.env.REDIS_URL,
        },
      },
    },
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-s3",
            id: "s3",
            options: {
              file_url: process.env.S3_FILE_URL,
              access_key_id: process.env.S3_ACCESS_KEY_ID,
              secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
              bucket: process.env.S3_BUCKET,
              endpoint: process.env.S3_ENDPOINT,
              region: "us-east-1",
              additional_client_config: {
                forcePathStyle: true,
              },

            },
          },
        ],
      },
    },
    {
      // Поиск по каталогу. Интеграция сделана своим модулем, а не готовым
      // плагином: он появился, когда проект был на 2.0.7 и плагин туда
      // не ставился, и был сознательно оставлен при переходе на 2.19 —
      // меньше зависимостей и полный контроль над схемой индекса.
      resolve: "./src/modules/meilisearch",
      options: {
        host: process.env.MEILISEARCH_HOST,
        apiKey: process.env.MEILISEARCH_API_KEY,
        indexName: process.env.MEILISEARCH_INDEX || "products",
      },
    },
    {
      // Прайс-книга: закупочные цены, черновики скидок и тумблер «Со
      // скидкой» у товара. Действующие цены остаются в ядре — модуль
      // хранит только то, чего в Medusa нет.
      resolve: "./src/modules/price-book",
    },
    {
      // Импорт товара по тексту, скопированному с Taobao / Amazon / Alibaba.
      // Без ключа модуль не отключает импорт целиком: фото переносятся,
      // а описание берётся из вставленного текста как есть.
      resolve: "./src/modules/product-import",
      options: {
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL,
        model: process.env.DEEPSEEK_MODEL,
      },
    },
  ],
})