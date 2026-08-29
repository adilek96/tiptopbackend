import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowDownTray } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  Alert,
} from "@medusajs/ui"
import { useState } from "react"

type ImportResult = {
  product: { id: string; title: string; handle: string }
  images_uploaded: number
  video_uploaded: boolean
  ai_generated: boolean
  failed_media: string[]
}

/**
 * Страница импорта товара — ручной путь.
 *
 * Основной способ — расширение для Chrome: оно снимает со страницы товара
 * фото, текст и настоящие варианты продавца и присылает их сюда же, в
 * POST /admin/product-import. Эта страница остаётся для площадок, которых
 * расширение не знает: там текст и ссылки на фото продавец копирует руками,
 * файлы качает бэкенд, а варианты восстанавливает модель.
 */
const ProductImportPage = () => {
  const [sourceUrl, setSourceUrl] = useState("")
  const [rawText, setRawText] = useState("")
  const [imageUrls, setImageUrls] = useState("")
  const [videoUrl, setVideoUrl] = useState("")

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/admin/product-import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_url: sourceUrl,
          raw_text: rawText,
          video_url: videoUrl,
          image_urls: imageUrls
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data?.message ?? "Не удалось импортировать товар")
        return
      }

      setResult(data as ImportResult)
      setRawText("")
      setImageUrls("")
      setVideoUrl("")
      setSourceUrl("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось импортировать товар")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Импорт товара</Heading>
      </div>

      <div className="px-6 py-4">
        <Text className="text-ui-fg-subtle" size="small">
          Для Taobao, Tmall, 1688, AliExpress и Amazon поставьте расширение
          «TipTop: импорт товаров» — оно снимает со страницы фото, текст и
          настоящие варианты продавца в одно нажатие. Эта форма нужна для
          остальных площадок: скопируйте описание и ссылки на изображения и
          вставьте их сюда. Товар будет создан черновиком: фото и видео
          перенесутся в наше хранилище, описание и варианты сгенерируются на
          русском. Цены проставьте сами перед публикацией.
        </Text>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-y-4 px-6 py-4">
        <div className="flex flex-col gap-y-2">
          <Label htmlFor="source_url" size="small" weight="plus">
            Ссылка на товар
          </Label>
          <Input
            id="source_url"
            placeholder="https://item.taobao.com/..."
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
          />
          <Text size="small" className="text-ui-fg-muted">
            Сохранится в карточке и подставляется как источник при скачивании
            картинок — многие CDN без этого их не отдают.
          </Text>
        </div>

        <div className="flex flex-col gap-y-2">
          <Label htmlFor="raw_text" size="small" weight="plus">
            Текст со страницы товара
          </Label>
          <Textarea
            id="raw_text"
            rows={10}
            placeholder="Вставьте название и описание товара как есть — на китайском или английском"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-y-2">
          <Label htmlFor="image_urls" size="small" weight="plus">
            Ссылки на изображения, по одной в строке
          </Label>
          <Textarea
            id="image_urls"
            rows={6}
            placeholder={"https://img.alicdn.com/...jpg\nhttps://img.alicdn.com/...jpg"}
            value={imageUrls}
            onChange={(e) => setImageUrls(e.target.value)}
          />
          <Text size="small" className="text-ui-fg-muted">
            До 15 файлов. Первое изображение станет обложкой товара.
          </Text>
        </div>

        <div className="flex flex-col gap-y-2">
          <Label htmlFor="video_url" size="small" weight="plus">
            Ссылка на видео (необязательно)
          </Label>
          <Input
            id="video_url"
            placeholder="https://cloud.video.taobao.com/...mp4"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
          />
        </div>

        <div>
          <Button type="submit" isLoading={loading} disabled={loading}>
            Импортировать
          </Button>
        </div>
      </form>

      {error ? (
        <div className="px-6 py-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-y-3 px-6 py-4">
          <Alert variant="success">
            Черновик «{result.product.title}» создан. Загружено изображений:{" "}
            {result.images_uploaded}
            {result.video_uploaded ? ", видео перенесено" : ""}
            {result.ai_generated
              ? ", описание сгенерировано"
              : ", описание взято из вставленного текста"}
            .
          </Alert>

          <div>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.href = `/app/products/${result.product.id}`
              }}
            >
              Открыть товар
            </Button>
          </div>

          {result.failed_media.length ? (
            <Alert variant="warning">
              Не удалось скачать {result.failed_media.length} файл(ов). Обычно
              это значит, что CDN отдаёт их только по ссылке со своей страницы —
              скачайте вручную и загрузите в карточке товара.
            </Alert>
          ) : null}
        </div>
      ) : null}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Импорт товара",
  icon: ArrowDownTray,
})

export default ProductImportPage
