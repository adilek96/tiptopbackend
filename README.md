<p align="center">
  <a href="https://www.medusajs.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://user-images.githubusercontent.com/59018053/229103275-b5e482bb-4601-46e6-8142-244f531cebdb.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    <img alt="Medusa logo" src="https://user-images.githubusercontent.com/59018053/229103726-e5b529a3-9b3f-4970-8a1f-c6af37f087bf.svg">
    </picture>
  </a>
</p>
<h1 align="center">
  Medusa
</h1>

<h4 align="center">
  <a href="https://docs.medusajs.com">Documentation</a> |
  <a href="https://www.medusajs.com">Website</a>
</h4>

<p align="center">
  Building blocks for digital commerce
</p>
<p align="center">
  <a href="https://github.com/medusajs/medusa/blob/master/CONTRIBUTING.md">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat" alt="PRs welcome!" />
  </a>
    <a href="https://www.producthunt.com/posts/medusa"><img src="https://img.shields.io/badge/Product%20Hunt-%231%20Product%20of%20the%20Day-%23DA552E" alt="Product Hunt"></a>
  <a href="https://discord.gg/xpCwq3Kfn8">
    <img src="https://img.shields.io/badge/chat-on%20discord-7289DA.svg" alt="Discord Chat" />
  </a>
  <a href="https://twitter.com/intent/follow?screen_name=medusajs">
    <img src="https://img.shields.io/twitter/follow/medusajs.svg?label=Follow%20@medusajs" alt="Follow @medusajs" />
  </a>
</p>

## Compatibility

This starter is compatible with versions >= 1.8.0 of `@medusajs/medusa`. 

## Getting Started

Visit the [Quickstart Guide](https://docs.medusajs.com/learn) to set up a server.

Visit the [Docs](https://docs.medusajs.com/learn#get-started) to learn more about our system requirements.

## What is Medusa

Medusa is a set of commerce modules and tools that allow you to build rich, reliable, and performant commerce applications without reinventing core commerce logic. The modules can be customized and used to build advanced ecommerce stores, marketplaces, or any product that needs foundational commerce primitives. All modules are open-source and freely available on npm.

Learn more about [Medusa’s architecture](https://docs.medusajs.com/learn/advanced-development/architecture/overview) and [commerce modules](https://docs.medusajs.com/learn/basics/commerce-modules) in the Docs.

## Roadmap, Upgrades & Plugins

You can view the planned, started and completed features in the [Roadmap discussion](https://github.com/medusajs/medusa/discussions/categories/roadmap).

Follow the [Upgrade Guides](https://docs.medusajs.com/upgrade-guides/) to keep your Medusa project up-to-date.

Check out all [available Medusa plugins](https://medusajs.com/plugins/).

## Community & Contributions

The community and core team are available in [GitHub Discussions](https://github.com/medusajs/medusa/discussions), where you can ask for support, discuss roadmap, and share ideas.

Join our [Discord server](https://discord.com/invite/medusajs) to meet other community members.

## Other channels

- [GitHub Issues](https://github.com/medusajs/medusa/issues)
- [Twitter](https://twitter.com/medusajs)
- [LinkedIn](https://www.linkedin.com/company/medusajs)
- [Medusa Blog](https://medusajs.com/blog/)

---

## Разработка

Зависимости ставятся через `npm ci` — `package-lock.json` в репозитории должен
оставаться согласованным.

**Важно:** npm версий 11.0–11.3 генерирует для дерева зависимостей Medusa 2.19
битый lock: он сам же потом отвергается командой `npm ci` с ошибкой про
`ajv-formats` и `picomatch`, и сборка в Docker падает. Если после `npm install`
`npm ci` перестал работать — обнови npm:

```bash
npm i -g npm@11.19.1
rm -rf node_modules package-lock.json
npm install
npm ci --dry-run   # должно пройти без ошибок
```

### Полезные команды

```bash
npm run dev            # локальный запуск
npm run seed           # первичное наполнение пустой базы
npm run sync-search    # полная переиндексация поиска
```

---

## Прайс-листы

Цены магазина разложены на три вида списков. Раздел «Прайс-листы» в админке —
единственное место, где они заводятся; штатные экраны Medusa оставлены только
на чтение (`src/api/middlewares.ts`).

**Закупочный** — сколько магазин заплатил поставщику. Лежит своей таблицей в
модуле `price-book`, а не прайс-листом Medusa: любой прайс-лист участвует в
расчёте цены, и себестоимость рано или поздно уехала бы покупателю в
`/store/products`. Из своей таблицы это невозможно — движок цен её не видит.

**Основной** — цена продажи вне акций. Это базовая цена вариации в ядре,
поэтому список нельзя ни удалить, ни просрочить: без него товар не продаётся.
В таблице рядом стоит закупочная и надбавка — в манатах и процентах от
закупочной.

**Скидочные** — их заводит продавец, у них есть статус и срок. Это настоящие
прайс-листы Medusa типа `sale`: движок цен подставляет скидочную цену как
действующую, а основную оставляет как старую, и витрина рисует её зачёркнутой.
Срок и статус проверяет сам движок — в коде их проверять не нужно.

Скидка действует на товар, только когда в его карточке включён тумблер
«Со скидкой». Набранная цена хранится черновиком в модуле, а в прайс-лист ядра
попадает через `src/workflows/sync-discount-prices.ts` — при сохранении цен и
при переключении тумблера. Так цену видят одинаково витрина, корзина и касса:
подменять её на чтении нельзя, иначе покупатель увидел бы одну сумму, а
заплатил другую.

Прайс-листы, заведённые до этого раздела, синхронизация не трогает: удаляются
только цены напротив известных ей черновиков.

После деплоя нужны миграции модуля:

```bash
npx medusa db:migrate
```

---

## Разделы админки: свои вместо штатных

Остатки и цены заводятся только в наших разделах — «Склад» и «Прайс-листы».
Штатные экраны Medusa «Inventory» и «Price Lists» делают то же самое, но мимо
нашей логики: цена из штатного прайс-листа действовала бы у всех товаров
подряд, минуя тумблер «Со скидкой», а остаток правился бы построчно по
складским позициям без названий товара.

Убрать их совсем нельзя и не нужно: **на них стоят наши же разделы**. Скидка
действует потому, что лежит в настоящем прайс-листе Medusa, а остаток
списывается отгрузкой заказа через модуль inventory. Поэтому закрыт вход, а не
механизм.

**Из меню** разделы убирает `npm run hide-core-sections`. Раскладка боковой
панели хранится в модуле settings, скрипт правит общую для магазина и
дописывает «спрятать» в личные раскладки тех, кто настраивал панель под себя, —
личная перекрывает общую, иначе у такого пользователя разделы остались бы.
Порядок пунктов, который он себе выставил, сохраняется. Скрипт идемпотентен;
гонять после каждого деплоя не нужно, только если разделы вернули обратно.

**На запись** штатные маршруты закрыты в `src/api/middlewares.ts`:
`/admin/price-lists*` и `/admin/inventory-items*` с `/admin/reservations*`
отвечают 409 на `POST` и `DELETE`. Чтение оставлено — оно нужно самой админке и
нашим разделам; выгрузку остатков в файл (`/admin/inventory-items/export`)
мидлварь пропускает, хотя маршрут и `POST`.

Правка остатка живёт в собственном `POST /admin/stock/level`. Он же решает,
заводить строку остатка или править существующую: товар из импорта приезжает со
складской позицией, но без строки — Medusa создаёт её не при создании товара, а
когда остаток впервые проставили. Маршрут закрыт политикой `stock:write`
(`src/policies/stock.ts`) — без объявленной политики он был бы открыт всякому,
кто вошёл в админку, включая кассира.

Списание при продаже ничего этого не касается: и касса, и заказы с сайта
списывают остаток отгрузкой через рабочий процесс ядра, до HTTP-маршрутов дело
не доходит.

После деплоя:

```bash
npm run hide-core-sections
```
