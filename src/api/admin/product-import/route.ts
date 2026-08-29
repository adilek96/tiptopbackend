import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ProductStatus, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { PRODUCT_IMPORT_MODULE } from "../../../modules/product-import"
import type ProductImportService from "../../../modules/product-import/service"

const MAX_MEDIA = 15
const MAX_FILE_BYTES = 25 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30000

type ImportBody = {
  source_url?: string
  raw_text?: string
  image_urls?: string[]
  video_url?: string
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

/**
 * Скачивает медиафайл по чужой ссылке.
 *
 * Referer подставляется от исходной страницы: CDN Taobao и Alibaba отдают
 * картинки только со «своим» реферером, а без него возвращают заглушку.
 */
async function download(
  url: string,
  referer: string | undefined
): Promise<{ content: string; mimeType: string; extension: string } | null> {
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
 * POST /admin/product-import
 *
 * Собирает черновик товара из того, что продавец скопировал со страницы
 * Taobao, Amazon или Alibaba: перекладывает фото и видео в наше хранилище
 * и просит модель составить описание и варианты.
 *
 * Товар создаётся в статусе черновика — цены и финальный текст продавец
 * правит сам перед публикацией.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as ImportBody
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const rawText = String(body.raw_text ?? "").trim()
  const sourceUrl = String(body.source_url ?? "").trim()
  const videoUrl = String(body.video_url ?? "").trim()
  const imageUrls = (Array.isArray(body.image_urls) ? body.image_urls : [])
    .map((url) => String(url).trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, MAX_MEDIA)

  if (!rawText && !imageUrls.length) {
    res.status(400).json({
      message: "Нужен текст товара или хотя бы одна ссылка на изображение",
    })
    return
  }

  // --- Текст: описание и варианты ------------------------------------------

  const importService: ProductImportService = req.scope.resolve(PRODUCT_IMPORT_MODULE)
  const generated = await importService.generate(rawText)

  // Без ключа DeepSeek генерации нет — тогда берём вставленный текст как есть,
  // чтобы импорт всё равно принёс фото и заготовку карточки.
  const fallbackTitle = rawText.split("\n")[0]?.slice(0, 120) || "Импортированный товар"
  const card = generated ?? {
    title: fallbackTitle,
    subtitle: null,
    description: rawText,
    tags: [],
    options: [{ title: "Вариант", values: ["Стандартный"] }],
    variants: [
      { title: "Стандартный", options: { Вариант: "Стандартный" } },
    ],
  }

  // --- Медиа: переносим в наше хранилище ------------------------------------

  const fileModuleService = req.scope.resolve(Modules.FILE)
  const referer = sourceUrl || undefined

  const uploadedImages: string[] = []
  let uploadedVideo: string | null = null
  const failedMedia: string[] = []

  for (const url of imageUrls) {
    const file = await download(url, referer)
    if (!file) {
      failedMedia.push(url)
      continue
    }

    try {
      const stored = await fileModuleService.createFiles({
        filename: `import-${Date.now()}-${uploadedImages.length}.${file.extension}`,
        mimeType: file.mimeType,
        content: file.content,
        access: "public",
      })
      uploadedImages.push(stored.url)
    } catch (error) {
      logger.error(
        `Не удалось сохранить изображение ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      failedMedia.push(url)
    }
  }

  if (videoUrl) {
    const file = await download(videoUrl, referer)
    if (file) {
      try {
        const stored = await fileModuleService.createFiles({
          filename: `import-${Date.now()}-video.${file.extension}`,
          mimeType: file.mimeType,
          content: file.content,
          access: "public",
        })
        uploadedVideo = stored.url
      } catch (error) {
        logger.error(
          `Не удалось сохранить видео: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        failedMedia.push(videoUrl)
      }
    } else {
      failedMedia.push(videoUrl)
    }
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
            // У товара в Medusa нет поля под видео, поэтому храним здесь.
            video_url: uploadedVideo,
            imported_at: new Date().toISOString(),
            generated_by_ai: Boolean(generated),
          },
        },
      ],
    },
  })

  const product = result[0]

  logger.info(
    `Импортирован черновик ${product.id}: изображений ${uploadedImages.length}, ` +
      `видео ${uploadedVideo ? "да" : "нет"}, генерация ${generated ? "да" : "нет"}`
  )

  res.json({
    product: { id: product.id, title: product.title, handle: product.handle },
    images_uploaded: uploadedImages.length,
    video_uploaded: Boolean(uploadedVideo),
    ai_generated: Boolean(generated),
    failed_media: failedMedia,
  })
}
