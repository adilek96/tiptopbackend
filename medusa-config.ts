import { loadEnv, defineConfig } from '@medusajs/framework/utils'
// import { VARIANT_IMAGE_MODULE } from './src/modules/variant-image'

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
  modules: [
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
      // Поиск по каталогу. Готовый плагин для Meilisearch требует Medusa 2.19+,
      // а здесь 2.0.7, где плагины к тому же не умеют регистрировать модули —
      // поэтому интеграция сделана обычным модулем проекта.
      resolve: "./src/modules/meilisearch",
      options: {
        host: process.env.MEILISEARCH_HOST,
        apiKey: process.env.MEILISEARCH_API_KEY,
        indexName: process.env.MEILISEARCH_INDEX || "products",
      },
    },
    // Модуль variant-image отключён: он не запускается.
    //
    // 1. В конструкторе сервиса awilix передаёт прокси, поэтому
    //    container.resolve(...) ищет регистрацию с именем "resolve"
    //    и валит загрузку всего приложения.
    // 2. Даже если это починить, сервис вызывает у файлового модуля
    //    методы update/list/delete, которых в Medusa 2.0 нет
    //    (есть createFiles/deleteFiles/retrieveFile/listFiles), а метаданные
    //    у файлов не хранятся вовсе.
    //
    // Рабочий вариант — держать ссылку на картинку в metadata самой вариации
    // товара, а не в метаданных файла. Это переделка, а не правка одной строки.
    // {
    //   resolve: "./src/modules/variant-image",
    // },
  ],
})