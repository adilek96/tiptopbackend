# Поиск по товарам (Meilisearch)

Готового плагина здесь нет намеренно: `@rokmohar/medusa-plugin-meilisearch`
требует Medusa `^2.19`, а проект работает на `2.0.7`. К тому же в 2.0.7
система плагинов подключает из плагина только роуты, подписчики и задачи —
зарегистрировать модуль оттуда нельзя. Поэтому интеграция сделана обычным
модулем внутри проекта.

## Из чего состоит

| Файл | Назначение |
|---|---|
| `service.ts` | обёртка над HTTP-API Meilisearch |
| `../../subscribers/product-changed.ts` | синхронизация индекса при изменении товара |
| `../../api/store/search/route.ts` | публичный endpoint `GET /store/search` |
| `../../scripts/sync-search.ts` | полная переиндексация |

## Настройки

```
MEILISEARCH_HOST=http://tiptop-meilisearch:7700
MEILISEARCH_API_KEY=<admin key>
MEILISEARCH_INDEX=products
```

Без `MEILISEARCH_HOST` или `MEILISEARCH_API_KEY` модуль молча выключается:
подписчики ничего не делают, `/store/search` отдаёт пустой результат.
Приложение при этом поднимается нормально.

## Переиндексация

```bash
npx medusa exec ./src/scripts/sync-search.js
```

В индекс попадают только опубликованные товары. Снятый с публикации товар
подписчик удаляет из индекса.
