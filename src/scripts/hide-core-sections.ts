import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/** Зона боковой панели админки. Задаётся дашбордом, менять её нельзя. */
const ZONE = "sidebar"

/**
 * Пункты меню, которые прячем. Идентификатор записи в панели — это
 * `nav:` плюс адрес раздела, так их заводит сам дашборд.
 */
const HIDDEN = {
  "nav:/inventory": "Inventory (вместе с вложенным Reservations)",
  "nav:/price-lists": "Price Lists",
}

type Widgets = Record<string, { hidden?: boolean; section?: string; order?: number }>

/** Дописывает «спрятать» к уже сохранённой раскладке, не трогая остальное. */
function withHidden(widgets: Widgets | undefined): Widgets {
  const next: Widgets = { ...(widgets ?? {}) }

  for (const id of Object.keys(HIDDEN)) {
    next[id] = { ...(next[id] ?? {}), hidden: true }
  }

  return next
}

/**
 * Убирает из меню админки штатные разделы «Inventory» и «Price Lists».
 *
 * Оба дублируют наши: остатки проставляются в разделе «Склад», цены — в
 * «Прайс-листах», где у скидочной цены рядом стоят закупочная и основная,
 * а участие товара в акции решает тумблер «Со скидкой». Штатные экраны
 * ничего этого не знают, и продавцу незачем выбирать между двумя похожими
 * разделами.
 *
 * Прятать — единственное, что тут делается. Сами прайс-листы и остатки
 * ядра остаются на месте: на них стоят наши же разделы. Скидка действует,
 * потому что лежит в прайс-листе Medusa, а остаток списывается отгрузкой
 * заказа через модуль inventory. Записи в штатные маршруты закрыты
 * отдельно, в src/api/middlewares.ts.
 *
 * Раскладка панели хранится в модуле settings: одна общая для магазина
 * (её и правим) и по одной личной у тех, кто настраивал панель под себя.
 * Личная перекрывает общую, поэтому «спрятать» дописывается и в неё —
 * иначе у такого пользователя разделы остались бы на месте. Порядок
 * пунктов, который он себе выставил, при этом сохраняется.
 *
 * Скрипт идемпотентен, запускать после каждого деплоя не нужно — только
 * после того, как кто-то вернул разделы обратно.
 *
 *   npx medusa exec ./src/scripts/hide-core-sections.ts
 */
export default async function hideCoreSections({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const settingsModuleService: any = container.resolve(Modules.SETTINGS)

  // --- Общая раскладка магазина --------------------------------------------

  const current = await settingsModuleService.getSystemDefaultLayoutConfiguration(ZONE)

  await settingsModuleService.setSystemDefaultLayoutConfiguration(ZONE, {
    widgets: withHidden(current?.configuration?.widgets),
  })

  logger.info(
    `Из меню убраны разделы: ${Object.values(HIDDEN).join(", ")}. ` +
      (current ? "Прежняя раскладка сохранена." : "Раскладка заведена впервые.")
  )

  // --- Личные раскладки -----------------------------------------------------

  const all = await settingsModuleService.listLayoutConfigurations(
    { zone: ZONE },
    { take: null }
  )

  const personal = all.filter((row: any) => row.user_id)

  for (const row of personal) {
    await settingsModuleService.setLayoutConfiguration(ZONE, row.user_id, {
      widgets: withHidden(row.configuration?.widgets),
    })
  }

  logger.info(
    personal.length
      ? `Личных раскладок поправлено: ${personal.length}`
      : "Личных раскладок панели ни у кого нет — правился только общий вид"
  )

  logger.info(
    "Меню обновится при следующей загрузке админки. Разделы спрятаны, но не " +
      "удалены: адреса /app/inventory и /app/price-lists по-прежнему открываются " +
      "вручную и работают на чтение."
  )
}
