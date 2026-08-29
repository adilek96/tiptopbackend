import { Modules } from "@medusajs/framework/utils"
import type { IFileModuleService } from "@medusajs/framework/types"

export default class VariantImageService {
  private fileModuleService: IFileModuleService

  constructor(container: any) {
    this.fileModuleService = container.resolve(Modules.FILE)
  }

  /**
   * Сохраняет изображение для вариации товара
   */
  async setVariantImage(variantId: string, fileId: string): Promise<void> {
    // Используем metadata файла для хранения связи с вариацией
    await this.fileModuleService.update(fileId, {
      metadata: {
        variant_id: variantId,
      },
    })
  }

  /**
   * Получает изображение для вариации товара
   */
  async getVariantImage(variantId: string): Promise<string | null> {
    const [files] = await this.fileModuleService.list({
      metadata: {
        variant_id: variantId,
      },
    })

    if (files && files.length > 0) {
      // Возвращаем URL первого найденного изображения
      return files[0].url || null
    }

    return null
  }

  /**
   * Удаляет изображение для вариации товара
   */
  async deleteVariantImage(variantId: string): Promise<void> {
    const [files] = await this.fileModuleService.list({
      metadata: {
        variant_id: variantId,
      },
    })

    if (files && files.length > 0) {
      await this.fileModuleService.delete(files.map((f) => f.id))
    }
  }
}

