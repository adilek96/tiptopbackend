/** Разбор поля ввода: пустая строка — «цены нет», а не ноль. */
export function parseAmount(value: string): number | null | undefined {
  const trimmed = value.trim().replace(",", ".")

  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined
  }

  return parsed
}

/** Сумма для показа. null — прочерк: цены нет, и ноль тут был бы враньём. */
export function formatAmount(value: number | null): string {
  if (value === null) {
    return "—"
  }

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Поле ввода показывает то же число, но без разделителей разрядов. */
export function toInput(value: number | null): string {
  return value === null ? "" : String(value)
}

export type Margin = {
  /** Надбавка в манатах. */
  absolute: number
  /** Надбавка в процентах от закупочной цены. */
  percent: number | null
}

/**
 * Надбавка: сколько магазин зарабатывает сверх закупочной цены.
 *
 * Процент считается от закупочной цены, а не от продажной: продавец
 * думает категориями «взял за 10, продаю с наценкой 50%».
 * При нулевой закупочной проценты не считаются — делить не на что.
 */
export function margin(main: number | null, cost: number | null): Margin | null {
  if (main === null || cost === null) {
    return null
  }

  return {
    absolute: main - cost,
    percent: cost === 0 ? null : ((main - cost) / cost) * 100,
  }
}

/** Скидка в процентах от основной цены. */
export function discountPercent(main: number | null, discount: number | null): number | null {
  if (main === null || discount === null || main === 0) {
    return null
  }

  return ((main - discount) / main) * 100
}

export function formatPercent(value: number | null): string {
  if (value === null) {
    return "—"
  }

  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}%`
}
