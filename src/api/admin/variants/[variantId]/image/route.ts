import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { VARIANT_IMAGE_MODULE } from "../../../../../modules/variant-image"
import type { IFileModuleService } from "@medusajs/framework/types"
import VariantImageService from "../../../../../modules/variant-image/service"

/**
 * POST /admin/variants/:variantId/image
 * Загрузка изображения для вариации товара
 * 
 * Принимает file_id в теле запроса (файл должен быть загружен через стандартный API Medusa /admin/uploads)
 * Или можно использовать прямой загрузчик файлов
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { variantId } = req.params
  const fileModuleService: IFileModuleService = req.scope.resolve(Modules.FILE)
  const variantImageService: VariantImageService = req.scope.resolve(
    VARIANT_IMAGE_MODULE
  )

  const { file_id } = req.body

  if (!file_id) {
    res.status(400).json({
      message: "file_id обязателен. Сначала загрузите файл через /admin/uploads",
    })
    return
  }

  try {
    // Проверяем существование файла
    const file = await fileModuleService.retrieve(file_id)

    // Удаляем старое изображение для этой вариации, если есть
    await variantImageService.deleteVariantImage(variantId)

    // Обновляем metadata файла для связи с вариацией
    await fileModuleService.update(file_id, {
      metadata: {
        ...file.metadata,
        variant_id: variantId,
      },
    })

    // Сохраняем связь между вариацией и изображением
    await variantImageService.setVariantImage(variantId, file_id)

    // Получаем URL изображения
    const imageUrl = await variantImageService.getVariantImage(variantId)

    res.json({
      variant_id: variantId,
      image_url: imageUrl,
      file_id: file_id,
    })
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при загрузке изображения",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * GET /admin/variants/:variantId/image
 * Получение изображения для вариации товара
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { variantId } = req.params
  const variantImageService: VariantImageService = req.scope.resolve(
    VARIANT_IMAGE_MODULE
  )

  try {
    const imageUrl = await variantImageService.getVariantImage(variantId)

    if (!imageUrl) {
      res.status(404).json({
        message: "Изображение для данной вариации не найдено",
      })
      return
    }

    res.json({
      variant_id: variantId,
      image_url: imageUrl,
    })
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при получении изображения",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * DELETE /admin/variants/:variantId/image
 * Удаление изображения для вариации товара
 */
export async function DELETE(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { variantId } = req.params
  const variantImageService: VariantImageService = req.scope.resolve(
    VARIANT_IMAGE_MODULE
  )

  try {
    await variantImageService.deleteVariantImage(variantId)

    res.json({
      message: "Изображение успешно удалено",
      variant_id: variantId,
    })
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при удалении изображения",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

