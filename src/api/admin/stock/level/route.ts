import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createInventoryLevelsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"

type Body = {
  inventory_item_id?: string
  location_id?: string
  stocked_quantity?: number | string
}

/**
 * POST /admin/stock/level
 *
 * Проставляет остаток вариации на складе — единственный путь, которым
 * остаток вообще меняется руками. Штатные `/admin/inventory-items*`
 * закрыты на запись в `src/api/middlewares.ts`, чтобы остаток нельзя было
 * поправить мимо раздела «Склад»: там продавец видит товар целиком, а не
 * строку складской позиции без названия.
 *
 * Списание при продаже сюда не заходит — его делает отгрузка заказа
 * рабочим процессом ядра, минуя HTTP.
 *
 * Строки остатка у вариации может ещё не быть: Medusa заводит её не при
 * создании товара, а когда остаток впервые проставили. Поэтому маршрут
 * сам решает, создавать строку или править существующую, — вызывающему
 * знать об этом не нужно.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as Body
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const inventoryItemId = String(body.inventory_item_id ?? "").trim()
  const locationId = String(body.location_id ?? "").trim()

  if (!inventoryItemId || !locationId) {
    res.status(400).json({
      message: "Нужны inventory_item_id и location_id",
    })
    return
  }

  const quantity = Math.floor(Number(body.stocked_quantity))

  if (!Number.isFinite(quantity) || quantity < 0) {
    res.status(400).json({
      message: "Остаток должен быть целым числом не меньше нуля",
    })
    return
  }

  const inventoryModuleService = req.scope.resolve(Modules.INVENTORY)

  const [existing] = await inventoryModuleService.listInventoryLevels(
    { inventory_item_id: inventoryItemId, location_id: locationId },
    { take: 1 }
  )

  if (existing) {
    await updateInventoryLevelsWorkflow(req.scope).run({
      input: {
        updates: [
          {
            inventory_item_id: inventoryItemId,
            location_id: locationId,
            stocked_quantity: quantity,
          },
        ],
      },
    })
  } else {
    await createInventoryLevelsWorkflow(req.scope).run({
      input: {
        inventory_levels: [
          {
            inventory_item_id: inventoryItemId,
            location_id: locationId,
            stocked_quantity: quantity,
          },
        ],
      },
    })
  }

  // Перечитываем строку: у только что заведённой появился свой id, а
  // резерв мог измениться, пока продавец набирал число.
  const [level] = await inventoryModuleService.listInventoryLevels(
    { inventory_item_id: inventoryItemId, location_id: locationId },
    { take: 1 }
  )

  logger.info(
    `Склад: остаток позиции ${inventoryItemId} на ${locationId} ` +
      `${existing ? "изменён" : "заведён"} — ${quantity} шт.`
  )

  res.json({
    level: {
      id: level?.id ?? null,
      location_id: locationId,
      stocked_quantity: Number(level?.stocked_quantity ?? quantity),
      reserved_quantity: Number(level?.reserved_quantity ?? 0),
    },
    created: !existing,
  })
}
