import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { VARIANT_IMAGE_MODULE } from "../../../../../modules/variant-image"
import VariantImageService from "../../../../../modules/variant-image/service"

/**
 * GET /store/variants/:variantId/image
 * Получение изображения для вариации товара (публичный API)
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

