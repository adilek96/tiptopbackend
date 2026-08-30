import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import { PriceTable } from "../../../../components/price-table"
import { errorText, sdk } from "../../../../lib/sdk"

type PriceList = {
  id: string
  title: string
  description: string | null
  status: string
  starts_at: string | null
  ends_at: string | null
}

/**
 * Поле «дата и время» показывает местное время без часового пояса,
 * поэтому приводим ISO к местному вручную: toISOString сдвинул бы
 * значение на разницу с UTC, и акция начиналась бы не тогда, когда её
 * назначили.
 */
function toLocalInput(value: string | null): string {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60000

  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

/**
 * Скидочный прайс-лист.
 *
 * Сверху — срок и включатель, снизу — цены. Цена из этого списка попадает
 * в API магазина, только когда лист включён, срок не истёк и у товара
 * включён тумблер «Со скидкой» в карточке. Состояние тумблера видно в
 * последней колонке таблицы.
 */
const DiscountPriceListPage = () => {
  const { id } = useParams<{ id: string }>()
  const listId = id ?? ""

  const [list, setList] = useState<PriceList | null>(null)
  const [title, setTitle] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [active, setActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!listId) {
      return
    }

    setLoading(true)

    try {
      const response = await sdk.client.fetch<{ price_list: PriceList }>(
        `/admin/price-book/${listId}`
      )

      setList(response.price_list)
      setTitle(response.price_list.title)
      setStartsAt(toLocalInput(response.price_list.starts_at))
      setEndsAt(toLocalInput(response.price_list.ends_at))
      setActive(response.price_list.status === "active")
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setLoading(false)
    }
  }, [listId])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setSaving(true)

    try {
      await sdk.client.fetch(`/admin/price-book/${listId}`, {
        method: "POST",
        body: {
          title: title.trim(),
          status: active ? "active" : "draft",
          starts_at: fromLocalInput(startsAt),
          ends_at: fromLocalInput(endsAt),
        },
      })

      toast.success("Настройки прайс-листа сохранены")
      await load()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  const expired = Boolean(list?.ends_at && new Date(list.ends_at).getTime() < Date.now())
  const notStarted = Boolean(list?.starts_at && new Date(list.starts_at).getTime() > Date.now())
  const running = active && !expired && !notStarted

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-x-2">
              <Heading level="h2">{list?.title ?? "Скидочный прайс-лист"}</Heading>
              {loading ? null : (
                <Badge size="2xsmall" color={running ? "green" : "grey"}>
                  {running
                    ? "действует"
                    : expired
                      ? "срок истёк"
                      : notStarted
                        ? "ещё не начался"
                        : "черновик"}
                </Badge>
              )}
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              Скидка применяется только к товарам с включённым тумблером «Со скидкой».
            </Text>
          </div>
          <Link to="/price-book">
            <Button size="small" variant="secondary">
              Все прайс-листы
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-4">
          <div className="flex flex-col gap-y-2">
            <Label size="small">Название</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
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
          <div className="flex flex-col justify-between gap-y-2">
            <Label size="small">Акция включена</Label>
            <div className="flex items-center justify-between gap-x-2">
              <Switch checked={active} onCheckedChange={setActive} />
              <Button size="small" onClick={save} isLoading={saving} disabled={loading}>
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      </Container>

      <Container className="p-0">
        <div className="px-6 py-4">
          <PriceTable listId={listId} kind="discount" />
        </div>
      </Container>
    </div>
  )
}

export default DiscountPriceListPage
