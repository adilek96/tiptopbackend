import { defineMiddlewares } from "@medusajs/framework/http"
import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { VARIANT_IMAGE_MODULE } from "../modules/variant-image"
import VariantImageService from "../modules/variant-image/service"

/**
 * Middleware для добавления изображения вариации в ответ API
 */
async function addVariantImage(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const originalJson = res.json.bind(res)

  res.json = async function (data: any) {
    try {
      const variantImageService: VariantImageService = req.scope.resolve(
        VARIANT_IMAGE_MODULE
      )

      // Обработка одиночной вариации
      if (data?.variant?.id) {
        const imageUrl = await variantImageService.getVariantImage(data.variant.id)
        if (imageUrl) {
          data.variant.image_url = imageUrl
        }
      }

      // Обработка массива вариаций
      if (data?.variants && Array.isArray(data.variants)) {
        for (const variant of data.variants) {
          if (variant.id) {
            const imageUrl = await variantImageService.getVariantImage(variant.id)
            if (imageUrl) {
              variant.image_url = imageUrl
            }
          }
        }
      }

      // Обработка массива в корне ответа
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.id && (item.type === "product_variant" || item.variant_id)) {
            const variantId = item.id || item.variant_id
            const imageUrl = await variantImageService.getVariantImage(variantId)
            if (imageUrl) {
              item.image_url = imageUrl
            }
          }
        }
      }

      // Обработка продукта с вариациями
      if (data?.product?.variants && Array.isArray(data.product.variants)) {
        for (const variant of data.product.variants) {
          if (variant.id) {
            const imageUrl = await variantImageService.getVariantImage(variant.id)
            if (imageUrl) {
              variant.image_url = imageUrl
            }
          }
        }
      }
    } catch (error) {
      console.error("Ошибка при добавлении изображений вариаций:", error)
    }

    return originalJson(data)
  }

  next()
}

// Маршруты отключены вместе с модулем variant-image (см. medusa-config.ts):
// без него req.scope.resolve падает на каждом запросе к товарам и засоряет
// логи. Вернуть, когда модуль будет переписан на metadata вариации.
export default defineMiddlewares({
  routes: [],
})

// Прежняя регистрация:
//   { matcher: /^\/admin\/products\/.*\/variants/, middlewares: [addVariantImage] },
//   { matcher: /^\/store\/products\/.*\/variants/, middlewares: [addVariantImage] },
//   { matcher: /^\/admin\/products\/.*$/,          middlewares: [addVariantImage] },
//   { matcher: /^\/store\/products\/.*$/,          middlewares: [addVariantImage] },
void addVariantImage

