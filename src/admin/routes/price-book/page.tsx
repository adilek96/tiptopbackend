import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CurrencyDollar } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Text,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { errorText, sdk } from "../../lib/sdk"

type PriceBookList = {
  id: string
  kind: "cost" | "main" | "discount"
  title: string
  description: string | null
  system: boolean
  status: string | null
  starts_at: string | null
  ends_at: string | null
}

/** Ссылка на таблицу цен: у системных списков свои адреса. */
function listHref(list: PriceBookList): string {
  if (list.kind === "cost") {
    return "/price-book/cost"
  }

  return list.kind === "main" ? "/price-book/main" : `/price-book/discount/${list.id}`
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—"
  }

  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
}

/** Идёт ли акция прямо сейчас — по статусу и датам. */
function isRunning(list: PriceBookList): boolean {
  if (list.status !== "active") {
    return false
  }

  const now = Date.now()

  if (list.starts_at && new Date(list.starts_at).getTime() > now) {
    return false
  }

  if (list.ends_at && new Date(list.ends_at).getTime() < now) {
    return false
  }

  return true
}

/**
 * Раздел «Прайс-листы».
 *
 * Два списка сверху — системные: закупочный и основной. Их нет в базе
 * как записей, это два взгляда на цены, которые в магазине есть всегда,
 * поэтому удалить их нельзя и срока действия у них нет.
 *
 * Ниже — скидочные, которые заводит продавец. Только у них есть даты и
 * статус, и только они меняют цену на витрине.
 */
const PriceBookPage = () => {
  const [lists, setLists] = useState<PriceBookList[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const prompt = usePrompt()

  const load = useCallback(async () => {
    setLoading(true)

    try {
      const response = await sdk.client.fetch<{ lists: PriceBookList[] }>("/admin/price-book")
      setLists(response.lists)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    if (!title.trim()) {
      toast.error("Укажите название прайс-листа")
      return
    }

    setCreating(true)

    try {
      await sdk.client.fetch("/admin/price-book", {
        method: "POST",
        body: {
          title: title.trim(),
          starts_at: startsAt ? new Date(startsAt).toISOString() : null,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        },
      })

      toast.success("Прайс-лист создан. Наберите в нём цены и включите его.")
      setOpen(false)
      setTitle("")
      setStartsAt("")
      setEndsAt("")
      await load()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setCreating(false)
    }
  }

  async function remove(list: PriceBookList) {
    const confirmed = await prompt({
      title: `Удалить «${list.title}»?`,
      description:
        "Прайс-лист и набранные в нём скидочные цены удалятся. Основные и закупочные цены товаров останутся как были.",
      confirmText: "Удалить",
      cancelText: "Отмена",
    })

    if (!confirmed) {
      return
    }

    try {
      await sdk.client.fetch(`/admin/price-book/${list.id}`, { method: "DELETE" })
      toast.success("Прайс-лист удалён")
      await load()
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const system = lists.filter((list) => list.system)
  const discounts = lists.filter((list) => !list.system)

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Прайс-листы</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Закупочная и основная цены — всегда, скидочные — по акциям.
          </Text>
        </div>
        <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
          Создать скидочный
        </Button>
      </div>

      {loading ? (
        <div className="px-6 py-4">
          <Text size="small">Загружаем…</Text>
        </div>
      ) : null}

      {system.map((list) => (
        <div key={list.id} className="flex items-center justify-between gap-x-4 px-6 py-4">
          <div>
            <div className="flex items-center gap-x-2">
              <Text weight="plus">{list.title}</Text>
              <Badge size="2xsmall" color="grey">
                системный
              </Badge>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {list.description}
            </Text>
          </div>
          <Link to={listHref(list)}>
            <Button size="small" variant="secondary">
              Открыть
            </Button>
          </Link>
        </div>
      ))}

      {!loading && !discounts.length ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            Скидочных прайс-листов нет. В них задаётся цена на время акции, и действуют они
            только у товаров с включённым тумблером «Со скидкой».
          </Text>
        </div>
      ) : null}

      {discounts.map((list) => (
        <div key={list.id} className="flex items-center justify-between gap-x-4 px-6 py-4">
          <div>
            <div className="flex items-center gap-x-2">
              <Text weight="plus">{list.title}</Text>
              <Badge size="2xsmall" color={isRunning(list) ? "green" : "grey"}>
                {isRunning(list) ? "действует" : list.status === "active" ? "вне срока" : "черновик"}
              </Badge>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              с {formatDate(list.starts_at)} по {formatDate(list.ends_at)}
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Link to={listHref(list)}>
              <Button size="small" variant="secondary">
                Открыть
              </Button>
            </Link>
            <Button size="small" variant="danger" onClick={() => remove(list)}>
              Удалить
            </Button>
          </div>
        </div>
      ))}

      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Новый скидочный прайс-лист</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4">
            <div className="flex flex-col gap-y-2">
              <Label size="small">Название</Label>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Например: Чёрная пятница"
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small">Начало</Label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small">Окончание</Label>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              Лист создаётся черновиком: сначала наберите цены, потом включите его на странице
              листа. Пустой включённый лист выглядел бы как сломанная акция.
            </Text>
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button onClick={create} isLoading={creating}>
              Создать
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Прайс-листы",
  icon: CurrencyDollar,
})

export default PriceBookPage
