import Medusa from "@medusajs/js-sdk"

/**
 * Клиент админки.
 *
 * Админка отдаётся тем же сервером Medusa, что и API, поэтому ходим на
 * свой же origin: адрес бэкенда меняется от стенда к стенду, и зашитый
 * в код он ломался бы при каждом переезде.
 */
const baseUrl =
  typeof window !== "undefined" ? window.location.origin : "http://localhost:9000"

export const sdk = new Medusa({
  baseUrl,
  auth: { type: "session" },
})

/** Текст ошибки от бэкенда — в нём объяснение, понятное продавцу. */
export function errorText(error: unknown): string {
  const message = (error as any)?.message

  if (typeof message === "string" && message.trim()) {
    return message
  }

  return "Не удалось выполнить запрос. Попробуйте ещё раз."
}
