import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Первичное наполнение чистой базы TipTop.
 *
 * Создаёт то, без чего витрина физически не работает: регион, канал продаж,
 * публичный ключ, склад и три способа доставки (метро / по городу / по стране).
 * Идентификаторы способов доставки и региона попадают в переменные окружения
 * витрины и бэкенда — скрипт печатает их в конце.
 *
 * Скрипт идемпотентен: повторный запуск ничего не дублирует, а просто
 * допечатывает уже существующие идентификаторы.
 *
 *   npx medusa exec ./src/scripts/seed.ts
 */
export default async function seedTipTop({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const storeModuleService = container.resolve(Modules.STORE)
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)
  const regionModuleService = container.resolve(Modules.REGION)
  const stockLocationModuleService = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)
  const apiKeyModuleService = container.resolve(Modules.API_KEY)

  const COUNTRY = "az"
  const CURRENCY = "azn"

  // --- Канал продаж ---------------------------------------------------------

  let [salesChannel] = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  })

  if (!salesChannel) {
    logger.info("Создаю канал продаж")
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Default Sales Channel" }] },
    })
    salesChannel = result[0]
  }

  // --- Регион ---------------------------------------------------------------

  let [region] = await regionModuleService.listRegions({ name: "Azerbaijan" })

  if (!region) {
    logger.info("Создаю регион Azerbaijan")
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Azerbaijan",
            currency_code: CURRENCY,
            countries: [COUNTRY],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    })
    region = result[0]

    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: COUNTRY }],
    })
  }

  // --- Магазин: валюта, канал и регион по умолчанию -------------------------

  const [store] = await storeModuleService.listStores()

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        name: "TipTop",
        supported_currencies: [{ currency_code: CURRENCY, is_default: true }],
        default_sales_channel_id: salesChannel.id,
        default_region_id: region.id,
      },
    },
  })

  // --- Склад ----------------------------------------------------------------

  let [stockLocation] = await stockLocationModuleService.listStockLocations({
    name: "Baku Warehouse",
  })

  if (!stockLocation) {
    logger.info("Создаю склад")
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: "Baku Warehouse",
            address: { city: "Baku", country_code: COUNTRY, address_1: "" },
          },
        ],
      },
    })
    stockLocation = result[0]

    // Склад обслуживает ручной провайдер доставки и канал продаж витрины.
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
    })

    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocation.id, add: [salesChannel.id] },
    })
  }

  // --- Профиль доставки и зона обслуживания ---------------------------------

  let [shippingProfile] = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  })

  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default", type: "default" }] },
    })
    shippingProfile = result[0]
  }

  let [fulfillmentSet] = await fulfillmentModuleService.listFulfillmentSets(
    { name: "TipTop Delivery" },
    { relations: ["service_zones"] }
  )

  if (!fulfillmentSet) {
    logger.info("Создаю зону доставки")
    fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: "TipTop Delivery",
      type: "shipping",
      service_zones: [
        {
          name: "Azerbaijan",
          geo_zones: [{ country_code: COUNTRY, type: "country" }],
        },
      ],
    })

    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    })
  }

  const serviceZone = fulfillmentSet.service_zones[0]

  // --- Способы доставки -----------------------------------------------------
  //
  // Витрина различает их по id: метро, по Баку и по стране. Поля формы
  // (имя, телефон, адрес, станция) уезжают в shipping_method.data и оттуда
  // попадают в уведомление в Telegram.

  const shippingOptionsData = [
    {
      name: "Доставка до станции метро",
      code: "metro",
      description: "Курьер привозит заказ к выходу из выбранной станции метро",
      amount: 0,
      envKey: "NEXT_PUBLIC_SHIPPING_OPTION_METRO_ID",
    },
    {
      name: "Доставка по городу",
      code: "city",
      description: "Доставка по адресу в пределах Баку",
      amount: 0,
      envKey: "NEXT_PUBLIC_SHIPPING_OPTION_CITY_ID",
    },
    {
      name: "Доставка по стране",
      code: "country",
      description: "Отправка в регионы Азербайджана",
      amount: 0,
      envKey: "NEXT_PUBLIC_SHIPPING_OPTION_COUNTRY_ID",
    },
  ]

  const createdOptions: Record<string, string> = {}

  for (const option of shippingOptionsData) {
    const [existing] = await fulfillmentModuleService.listShippingOptions({
      name: option.name,
    })

    if (existing) {
      createdOptions[option.envKey] = existing.id
      continue
    }

    logger.info(`Создаю способ доставки: ${option.name}`)
    const { result } = await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: option.name,
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: serviceZone.id,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: option.name,
            description: option.description,
            code: option.code,
          },
          prices: [
            { currency_code: CURRENCY, amount: option.amount },
            { region_id: region.id, amount: option.amount },
          ],
          rules: [
            {
              attribute: "enabled_in_store",
              value: "true",
              operator: "eq",
            },
            {
              attribute: "is_return",
              value: "false",
              operator: "eq",
            },
          ],
        },
      ],
    })
    createdOptions[option.envKey] = result[0].id
  }

  // --- Публичный ключ витрины -----------------------------------------------

  let [publishableKey] = await apiKeyModuleService.listApiKeys({
    type: "publishable",
    title: "TipTop Storefront",
  })

  if (!publishableKey) {
    logger.info("Создаю публичный ключ витрины")
    const { result } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: "TipTop Storefront",
            type: "publishable",
            created_by: "seed",
          },
        ],
      },
    })
    publishableKey = result[0]

    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: publishableKey.id, add: [salesChannel.id] },
    })
  }

  // --- Что прописать в переменные окружения ---------------------------------

  logger.info("Готово. Переменные для витрины (tiptopstorefront):")
  console.log(
    [
      "",
      "──────────────────────────────────────────────────────────────",
      `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=${publishableKey.token}`,
      `NEXT_PUBLIC_MEDUSA_REGION_ID=${region.id}`,
      ...Object.entries(createdOptions).map(([k, v]) => `${k}=${v}`),
      "",
      "Для бэкенда (tiptopBackend) — те же id способов доставки:",
      `SHIPPING_OPTION_METRO_ID=${createdOptions["NEXT_PUBLIC_SHIPPING_OPTION_METRO_ID"]}`,
      `SHIPPING_OPTION_CITY_ID=${createdOptions["NEXT_PUBLIC_SHIPPING_OPTION_CITY_ID"]}`,
      `SHIPPING_OPTION_COUNTRY_ID=${createdOptions["NEXT_PUBLIC_SHIPPING_OPTION_COUNTRY_ID"]}`,
      "",
      "Тег «Топ товаров» создаётся вручную в админке — после этого",
      "пропиши его id в NEXT_PUBLIC_MEDUSA_TOP_TAG_ID.",
      "──────────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  )

  // query остаётся зарезервированным для будущих проверок наполнения
  void query
}
