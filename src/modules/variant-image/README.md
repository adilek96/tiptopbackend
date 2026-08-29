# Модуль изображений вариаций товаров

Этот модуль позволяет загружать и управлять изображениями для каждой вариации товара отдельно.

## Использование

### 1. Загрузка изображения для вариации

Сначала загрузите файл через стандартный API Medusa `/admin/uploads`, затем привяжите его к вариации:

```bash
POST /admin/variants/{variantId}/image
Content-Type: application/json

{
  "file_id": "file_xxx"
}
```

### 2. Получение изображения вариации

```bash
GET /admin/variants/{variantId}/image
```

Или через публичный API:

```bash
GET /store/variants/{variantId}/image
```

### 3. Удаление изображения вариации

```bash
DELETE /admin/variants/{variantId}/image
```

## Автоматическое добавление в API

Middleware автоматически добавляет поле `image_url` в ответы API вариаций:

- `/admin/products/*/variants`
- `/store/products/*/variants`
- `/admin/products/*` (если продукт содержит вариации)
- `/store/products/*` (если продукт содержит вариации)

## Пример ответа

```json
{
  "variant": {
    "id": "variant_xxx",
    "title": "Вариация товара",
    "image_url": "https://s3.example.com/variant-image.jpg",
    ...
  }
}
```

