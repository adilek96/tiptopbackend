import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { PRODUCT_IMPORT_MODULE } from "../../../modules/product-import"
import type ProductImportService from "../../../modules/product-import/service"
import type { KnownSku } from "../../../modules/product-import/service"

const MAX_MEDIA = 15
const MAX_FILE_BYTES = 25 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30000

/** Файл, который прислало расширение: скачан браузером и лежит в base64. */
type InlineMedia = {
  url?: string
  content?: string
  mime_type?: string
}

type ImportBody = {
  source_url?: string
  source_site?: string
  raw_text?: string
  /** Ручной импорт: только ссылки, файлы качает сервер. */
  image_urls?: string[]
  video_url?: string
  /** Импорт из расширения: файлы приходят готовыми. */
  images?: InlineMedia[]
  video?: InlineMedia
  /** Настоящие варианты продавца, снятые со страницы. */
  options?: { title?: string; values?: string[] }[]
  variants?: { title?: string; options?: Record<string, string> }[]
  category_id?: string
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
}

type PreparedFile = { content: string; mimeType: string; extension: string }

/**
 * Скачивает медиафайл по чужой ссылке.
 *
 * Нужен только для ручного импорта: расширение присылает файлы уже
 * скачанными браузером. Referer подставляется от исходной страницы —
 * CDN Taobao и Alibaba отдают картинки только со «своим» реферером,
 * а без него возвращают заглушку. Из датацентра даже это срабатывает
 * не всегда, поэтому импорт из расширения надёжнее.
 */
async function download(
  url: string,
  referer: string | undefined
): Promise<PreparedFile | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        ...(referer ? { Referer: referer } : {}),
      },
    })

    if (!response.ok) {
      return null
    }

    const mimeType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase()

    const extension = EXTENSION_BY_MIME[mimeType]
    if (!extension) {
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
      return null
    }

    return { content: buffer.toString("base64"), mimeType, extension }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Проверяет файл, пришедший из расширения.
 *
 * Расширению доверять на слово нельзя: тип и размер проверяем сами,
 * как и у файлов, скачанных сервером.
 */
function prepareInline(media: InlineMedia | undefined): PreparedFile | null {
  const content = String(media?.content ?? "").trim()
  const mimeType = String(media?.mime_type ?? "").split(";")[0].trim().toLowerCase()

  if (!content || !mimeType) {
    return null
  }

  const extension = EXTENSION_BY_MIME[mimeType]
  if (!extension) {
    return null
  }

  // base64 раздувает данные примерно на треть — считаем исходный размер.
  if (Math.ceil((content.length * 3) / 4) > MAX_FILE_BYTES) {
    return null
  }

  return { content, mimeType, extension }
}

/** Варианты со страницы товара — только если они пришли целиком. */
function readSku(body: ImportBody): KnownSku | null {
  const options = (Array.isArray(body.options) ? body.options : [])
    .map((option) => ({
      title: String(option?.title ?? "").trim(),
      values: (Array.isArray(option?.values) ? option.values : [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    }))
    .filter((option) => option.title && option.values.length)

  const variants = (Array.isArray(body.variants) ? body.variants : [])
    .map((variant) => ({
      title: String(variant?.title ?? "").trim(),
      options:
        variant?.options && typeof variant.options === "object"
          ? Object.fromEntries(
              Object.entries(variant.options).map(([key, value]) => [
                String(key).trim(),
                String(value ?? "").trim(),
              ])
            )
          : {},
    }))
    .filter((variant) => Object.keys(variant.options).length)

  if (!options.length || !variants.length) {
    return null
  }

  return { options, variants }
}

/**
 * POST /admin/product-import
 *
 * Собирает черновик товара со страницы Taobao, 1688, AliExpress или Amazon.
 *
 * Работает с двух сторон. Расширение для Chrome присылает всё разом: текст,
 * скачанные браузером фото и видео, настоящие варианты продавца. Страница
 * импорта в админке присылает то, что продавец скопировал руками, — тогда
 * файлы качает сервер, а варианты восстанавливает модель.
 *
 * Товар создаётся в статусе черновика — цены и финальный текст продавец
 * правит сам перед публикацией.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as ImportBody
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const rawText = String(body.raw_text ?? "").trim()
  const sourceUrl = String(body.source_url ?? "").trim()
  const sourceSite = String(body.source_site ?? "").trim()

  // Файлы из расширения имеют приоритет: они уже скачаны браузером, а
  // ссылки на те же картинки сервер зачастую не откроет.
  const inlineImages = (Array.isArray(body.images) ? body.images : []).slice(0, MAX_MEDIA)
  const legacyImageUrls = (Array.isArray(body.image_urls) ? body.image_urls : [])
    .map((url) => String(url).trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, MAX_MEDIA)

  const videoUrl = String(body.video_url ?? body.video?.url ?? "").trim()

  if (!rawText && !inlineImages.length && !legacyImageUrls.length) {
    res.status(400).json({
      message: "Нужен текст товара или хотя бы одна ссылка на изображение",
    })
    return
  }

  // --- Текст: описание и варианты ------------------------------------------

  const importService: ProductImportService = req.scope.resolve(PRODUCT_IMPORT_MODULE)
  const sku = readSku(body)
  const generated = await importService.generate(rawText, sku)

  // Без ключа DeepSeek генерации нет — тогда берём вставленный текст как есть,
  // чтобы импорт всё равно принёс фото и заготовку карточки. Варианты со
  // страницы при этом сохраняются: перевести их некому, но терять нельзя.
  const fallbackTitle = rawText.split("\n")[0]?.slice(0, 120) || "Импортированный товар"
  const card = generated ?? {
    title: fallbackTitle,
    subtitle: null,
    description: rawText,
    tags: [],
    ...(sku
      ? importService.buildSkuCard(sku)
      : {
          options: [{ title: "Вариант", values: ["Стандартный"] }],
          variants: [{ title: "Стандартный", options: { Вариант: "Стандартный" } }],
        }),
  }

  // --- Медиа: переносим в наше хранилище ------------------------------------

  const fileModuleService = req.scope.resolve(Modules.FILE)
  const referer = sourceUrl || undefined

  const uploadedImages: string[] = []
  let uploadedVideo: string | null = null
  const failedMedia: string[] = []

  /** Кладёт готовый файл в хранилище. Возвращает url или null. */
  const store = async (file: PreparedFile, name: string): Promise<string | null> => {
    try {
      const stored = await fileModuleService.createFiles({
        filename: `import-${Date.now()}-${name}.${file.extension}`,
        mimeType: file.mimeType,
        content: file.content,
        access: "public",
      })
      return stored.url
    } catch (error) {
      logger.error(
        `Не удалось сохранить файл ${name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return null
    }
  }

  if (inlineImages.length) {
    for (const [index, media] of inlineImages.entries()) {
      const label = media.url || `изображение ${index + 1}`
      const file = prepareInline(media)
      if (!file) {
        failedMedia.push(label)
        continue
      }

      const url = await store(file, String(uploadedImages.length))
      if (url) {
        uploadedImages.push(url)
      } else {
        failedMedia.push(label)
      }
    }
  } else {
    for (const url of legacyImageUrls) {
      const file = await download(url, referer)
      if (!file) {
        failedMedia.push(url)
        continue
      }

      const stored = await store(file, String(uploadedImages.length))
      if (stored) {
        uploadedImages.push(stored)
      } else {
        failedMedia.push(url)
      }
    }
  }

  const videoFile = body.video?.content
    ? prepareInline(body.video)
    : videoUrl
      ? await download(videoUrl, referer)
      : null

  if (videoFile) {
    uploadedVideo = await store(videoFile, "video")
    if (!uploadedVideo) {
      failedMedia.push(videoUrl || "видео")
    }
  } else if (videoUrl || body.video?.content) {
    failedMedia.push(videoUrl || "видео")
  }

  // --- Создаём черновик -----------------------------------------------------

  // Профиль доставки обязателен при создании товара в Medusa 2.19.
  const fulfillmentModuleService = req.scope.resolve(Modules.FULFILLMENT)
  const [shippingProfile] = await fulfillmentModuleService.listShippingProfiles(
    { type: "default" },
    { take: 1 }
  )

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [
        {
          title: card.title,
          subtitle: card.subtitle,
          description: card.description,
          status: ProductStatus.DRAFT,
          shipping_profile_id: shippingProfile?.id,
          thumbnail: uploadedImages[0] ?? null,
          images: uploadedImages.map((url) => ({ url })),
          options: card.options,
          variants: card.variants.map((variant) => ({
            title: variant.title,
            options: variant.options,
          })),
          ...(body.category_id ? { category_ids: [body.category_id] } : {}),
          metadata: {
            // Откуда приехал товар — пригодится, когда надо свериться
            // с оригиналом или обновить цену у поставщика.
            import_source_url: sourceUrl || null,
            import_source_site: sourceSite || null,
            // У товара в Medusa нет поля под видео, поэтому храним здесь.
            video_url: uploadedVideo,
            imported_at: new Date().toISOString(),
            generated_by_ai: Boolean(generated),
            // Варианты продавца или догадка модели — видно прямо в карточке.
            variants_from_source: Boolean(sku),
          },
        },
      ],
    },
  })

  const product = result[0]

  logger.info(
    `Импортирован черновик ${product.id}${sourceSite ? ` с ${sourceSite}` : ""}: ` +
      `изображений ${uploadedImages.length}, видео ${uploadedVideo ? "да" : "нет"}, ` +
      `варианты ${sku ? "со страницы" : "от модели"}, генерация ${generated ? "да" : "нет"}`
  )

  res.json({
    product: { id: product.id, title: product.title, handle: product.handle },
    images_uploaded: uploadedImages.length,
    video_uploaded: Boolean(uploadedVideo),
    ai_generated: Boolean(generated),
    variants_from_source: Boolean(sku),
    variants_created: card.variants.length,
    failed_media: failedMedia,
  })
}
