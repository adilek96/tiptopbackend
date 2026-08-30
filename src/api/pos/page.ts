/**
 * Страница кассы.
 *
 * Живёт отдельно от админки: кассир открывает /pos, входит своей учёткой и
 * видит только кассу — ни товаров, ни заказов, ни настроек. Права на это
 * даёт роль «Кассир» (см. src/scripts/setup-roles.ts), а проверяют их
 * политики ресурса `pos` на самих эндпоинтах.
 *
 * Страница намеренно без сборщика и внешних библиотек: один файл, который
 * отдаётся как есть. Бэкенд может стоять в закрытом контуре, где CDN
 * недоступен, а касса должна открываться всегда.
 *
 * Внутри скрипта нет обратных кавычек и подстановок ${...}: файл целиком
 * лежит в шаблонной строке TypeScript, и они бы её разорвали.
 */
export const POS_PAGE_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Касса TipTop</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f4f4f5;
    color: #18181b;
  }
  button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid transparent; }
  input, select { font: inherit; border-radius: 8px; border: 1px solid #d4d4d8; padding: 12px; width: 100%; }
  input:focus, select:focus { outline: 2px solid #f59e0b; outline-offset: 1px; }
  .hidden { display: none !important; }

  .login { max-width: 380px; margin: 12vh auto; padding: 28px; background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.08); }
  .login h1 { margin: 0 0 4px; font-size: 24px; }
  .login p { margin: 0 0 20px; color: #71717a; font-size: 14px; }
  .login label { display: block; margin-bottom: 14px; }
  .login span { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 600; }

  .primary { background: #f59e0b; color: #fff; padding: 14px 20px; font-weight: 600; width: 100%; }
  .primary:hover { background: #d97706; }
  .primary:disabled { background: #d4d4d8; cursor: not-allowed; }

  .topbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #18181b; color: #fff; }
  .topbar strong { font-size: 18px; }
  .topbar .who { margin-left: auto; font-size: 14px; color: #a1a1aa; }
  .topbar button { background: #3f3f46; color: #fff; padding: 8px 14px; }

  .layout { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
  .col { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .col-search { flex: 1 1 420px; }
  .col-cart { flex: 1 1 380px; }

  .found { list-style: none; margin: 12px 0 0; padding: 0; max-height: 46vh; overflow-y: auto; }
  .found li { display: flex; gap: 12px; align-items: center; padding: 10px; border-radius: 8px; cursor: pointer; }
  .found li:hover { background: #fafafa; }
  .found img { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; background: #f4f4f5; flex: none; }
  .found .name { font-weight: 600; }
  .found .meta { font-size: 13px; color: #71717a; }
  .price { margin-left: auto; text-align: right; white-space: nowrap; font-weight: 700; }
  .stock-ok { color: #15803d; font-size: 13px; font-weight: 600; }
  .stock-out { color: #b91c1c; font-size: 13px; font-weight: 600; }
  .stock-any { color: #71717a; font-size: 13px; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 13px; color: #71717a; padding: 6px 4px; }
  td { padding: 8px 4px; border-top: 1px solid #f4f4f5; vertical-align: middle; }
  .qty { display: flex; align-items: center; gap: 6px; }
  .qty button { width: 34px; height: 34px; background: #f4f4f5; }
  .qty span { min-width: 28px; text-align: center; font-weight: 600; }
  .line-discount { width: 90px; padding: 6px; }
  .drop { background: none; color: #b91c1c; padding: 4px 8px; }

  .totals { margin-top: 14px; border-top: 2px solid #18181b; padding-top: 12px; }
  .totals div { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .totals .grand { font-size: 24px; font-weight: 700; }
  .field { margin-top: 10px; }
  .field span { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .row2 { display: flex; gap: 10px; }
  .row2 > * { flex: 1; }
  .change { margin-top: 8px; font-size: 18px; font-weight: 700; color: #15803d; }

  .msg { padding: 12px; border-radius: 8px; margin-top: 12px; font-size: 14px; }
  .msg-error { background: #fef2f2; color: #991b1b; }
  .msg-ok { background: #f0fdf4; color: #166534; }
  .empty { color: #a1a1aa; padding: 20px 0; text-align: center; }

  .receipt { max-width: 420px; margin: 4vh auto; background: #fff; padding: 24px; border-radius: 12px; }
  .receipt h2 { margin: 0 0 4px; }
  .receipt .sub { color: #71717a; font-size: 14px; margin-bottom: 16px; }
  .receipt table { margin-bottom: 12px; }
  .receipt .actions { display: flex; gap: 10px; margin-top: 18px; }

  @media print {
    .topbar, .receipt .actions { display: none; }
    body { background: #fff; }
    .receipt { margin: 0; box-shadow: none; }
  }
</style>
</head>
<body>

<div id="login" class="login">
  <h1>Касса TipTop</h1>
  <p>Вход для кассира</p>
  <form id="login-form">
    <label><span>Почта</span><input id="email" type="email" autocomplete="username" required></label>
    <label><span>Пароль</span><input id="password" type="password" autocomplete="current-password" required></label>
    <button class="primary" type="submit" id="login-button">Войти</button>
  </form>
  <div id="login-error" class="msg msg-error hidden"></div>
</div>

<div id="app" class="hidden">
  <div class="topbar">
    <strong>Касса</strong>
    <span class="who" id="who"></span>
    <button id="logout">Выйти</button>
  </div>

  <div class="layout">
    <div class="col col-search">
      <label><span style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Товар: название, артикул или штрихкод</span>
        <input id="term" autocomplete="off" placeholder="Отсканируйте или введите название">
      </label>
      <ul class="found" id="found"></ul>
      <div class="empty" id="found-empty">Отсканируйте штрихкод или начните вводить название</div>
    </div>

    <div class="col col-cart">
      <table>
        <thead><tr><th>Позиция</th><th>Кол-во</th><th>Скидка</th><th>Сумма</th><th></th></tr></thead>
        <tbody id="cart"></tbody>
      </table>
      <div class="empty" id="cart-empty">Чек пуст</div>

      <div class="totals">
        <div><span>Подытог</span><span id="subtotal">0.00</span></div>
        <div><span>Скидки</span><span id="discounts">0.00</span></div>
        <div class="grand"><span>Итого</span><span id="total">0.00</span></div>
      </div>

      <div class="field"><span>Скидка на чек</span><input id="order-discount" inputmode="decimal" placeholder="0"></div>
      <div class="field"><span>Оплата</span>
        <select id="payment">
          <option value="cash">Наличные</option>
          <option value="card">Карта</option>
          <option value="transfer">Перевод</option>
        </select>
      </div>
      <div class="field" id="cash-field"><span>Получено наличными</span><input id="cash" inputmode="decimal" placeholder="0">
        <div class="change hidden" id="change"></div>
      </div>
      <div class="row2 field">
        <label><span>Покупатель</span><input id="customer-name" placeholder="Необязательно"></label>
        <label><span>Телефон</span><input id="customer-phone" placeholder="Необязательно"></label>
      </div>

      <div class="field"><button class="primary" id="sell">Провести продажу</button></div>
      <div id="error" class="msg msg-error hidden"></div>
    </div>
  </div>
</div>

<div id="receipt-view" class="receipt hidden"></div>

<script>
(function () {
  "use strict";

  var TOKEN_KEY = "tiptop_pos_token";
  var token = null;
  var cart = [];
  var currency = "";
  var searchTimer = null;
  var lastFound = [];

  var el = function (id) { return document.getElementById(id); };
  var round2 = function (v) { return Math.round(v * 100) / 100; };
  var num = function (value) {
    var parsed = parseFloat(String(value).replace(",", "."));
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  var money = function (value) {
    return value.toFixed(2) + " " + (currency ? currency.toUpperCase() : "");
  };

  // --- Запросы -------------------------------------------------------------

  function api(path, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };
    if (token) { headers.Authorization = "Bearer " + token; }

    return fetch(path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      // Срок действия токена вышел или роль сняли — возвращаем к входу,
      // иначе кассир будет тыкать в кнопку без объяснений.
      if (response.status === 401) {
        signOut();
        throw new Error("Сессия истекла, войдите заново");
      }
      if (response.status === 403) {
        throw new Error("Нет прав на кассу. Попросите администратора выдать роль «Кассир» и войдите заново.");
      }
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          throw new Error(data && data.message ? data.message : "Ошибка " + response.status);
        }
        return data;
      });
    });
  }

  // --- Вход ----------------------------------------------------------------

  function signIn(event) {
    event.preventDefault();
    var button = el("login-button");
    var error = el("login-error");
    button.disabled = true;
    error.classList.add("hidden");

    fetch("/auth/user/emailpass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: el("email").value.trim(), password: el("password").value })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.token) {
          throw new Error(data && data.message ? data.message : "Неверная почта или пароль");
        }
        return data.token;
      });
    }).then(function (received) {
      token = received;
      try { localStorage.setItem(TOKEN_KEY, received); } catch (e) { /* приватный режим */ }
      showApp();
    }).catch(function (err) {
      error.textContent = err.message;
      error.classList.remove("hidden");
    }).then(function () {
      button.disabled = false;
    });
  }

  function signOut() {
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* приватный режим */ }
    cart = [];
    el("app").classList.add("hidden");
    el("receipt-view").classList.add("hidden");
    el("login").classList.remove("hidden");
    el("password").value = "";
  }

  function showApp() {
    el("login").classList.add("hidden");
    el("receipt-view").classList.add("hidden");
    el("app").classList.remove("hidden");
    el("term").focus();
    render();
  }

  // --- Поиск ---------------------------------------------------------------

  function search() {
    var term = el("term").value.trim();
    if (!term) {
      lastFound = [];
      renderFound();
      return;
    }

    api("/admin/pos/search?q=" + encodeURIComponent(term)).then(function (data) {
      lastFound = data.variants || [];
      renderFound();
    }).catch(showError);
  }

  function renderFound() {
    var list = el("found");
    list.innerHTML = "";
    el("found-empty").classList.toggle("hidden", lastFound.length > 0);

    lastFound.forEach(function (variant) {
      var item = document.createElement("li");

      var image = document.createElement("img");
      image.src = variant.thumbnail || "";
      image.alt = "";
      item.appendChild(image);

      var box = document.createElement("div");
      var name = document.createElement("div");
      name.className = "name";
      name.textContent = variant.product_title;
      box.appendChild(name);

      var meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = [variant.variant_title, variant.sku].filter(Boolean).join(" · ");
      box.appendChild(meta);

      var stock = document.createElement("div");
      if (variant.stock === null || variant.stock === undefined) {
        stock.className = "stock-any";
        stock.textContent = "Остаток не отслеживается";
      } else if (variant.stock > 0) {
        stock.className = "stock-ok";
        stock.textContent = "На складе: " + variant.stock;
      } else {
        stock.className = "stock-out";
        stock.textContent = "Нет на складе";
      }
      box.appendChild(stock);
      item.appendChild(box);

      var price = document.createElement("div");
      price.className = "price";
      price.textContent = variant.unit_price === null
        ? "Нет цены"
        : variant.unit_price.toFixed(2) + " " + String(variant.currency_code || "").toUpperCase();
      item.appendChild(price);

      item.addEventListener("click", function () { addToCart(variant); });
      list.appendChild(item);
    });
  }

  // --- Чек -----------------------------------------------------------------

  function addToCart(variant) {
    if (variant.unit_price === null) {
      showError("У товара «" + variant.product_title + "» нет цены — продать его нельзя.");
      return;
    }

    currency = variant.currency_code || currency;

    var existing = null;
    cart.forEach(function (line) {
      if (line.variant_id === variant.variant_id) { existing = line; }
    });

    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({
        variant_id: variant.variant_id,
        title: variant.product_title,
        variant_title: variant.variant_title,
        unit_price: variant.unit_price,
        stock: variant.stock,
        quantity: 1,
        discount: 0
      });
    }

    el("term").value = "";
    lastFound = [];
    renderFound();
    el("term").focus();
    hideError();
    render();
  }

  function changeQuantity(index, delta) {
    var line = cart[index];
    line.quantity += delta;
    if (line.quantity < 1) { cart.splice(index, 1); }
    render();
  }

  function render() {
    var body = el("cart");
    body.innerHTML = "";
    el("cart-empty").classList.toggle("hidden", cart.length > 0);

    cart.forEach(function (line, index) {
      var lineTotal = round2(line.unit_price * line.quantity);
      var row = document.createElement("tr");

      var titleCell = document.createElement("td");
      titleCell.appendChild(document.createTextNode(line.title));
      if (line.variant_title) {
        var sub = document.createElement("div");
        sub.className = "meta";
        sub.textContent = line.variant_title;
        titleCell.appendChild(sub);
      }
      // Остаток проверяет и сервер, но предупредить лучше до продажи.
      if (line.stock !== null && line.stock !== undefined && line.quantity > line.stock) {
        var warn = document.createElement("div");
        warn.className = "stock-out";
        warn.textContent = "Больше, чем на складе (" + line.stock + ")";
        titleCell.appendChild(warn);
      }
      row.appendChild(titleCell);

      var qtyCell = document.createElement("td");
      var qty = document.createElement("div");
      qty.className = "qty";
      var minus = document.createElement("button");
      minus.textContent = "−";
      minus.addEventListener("click", function () { changeQuantity(index, -1); });
      var count = document.createElement("span");
      count.textContent = String(line.quantity);
      var plus = document.createElement("button");
      plus.textContent = "+";
      plus.addEventListener("click", function () { changeQuantity(index, 1); });
      qty.appendChild(minus);
      qty.appendChild(count);
      qty.appendChild(plus);
      qtyCell.appendChild(qty);
      row.appendChild(qtyCell);

      var discountCell = document.createElement("td");
      var discountInput = document.createElement("input");
      discountInput.className = "line-discount";
      discountInput.value = line.discount ? String(line.discount) : "";
      discountInput.placeholder = "0";
      discountInput.inputMode = "decimal";
      discountInput.addEventListener("input", function () {
        line.discount = Math.min(num(discountInput.value), lineTotal);
        renderTotals();
      });
      discountCell.appendChild(discountInput);
      row.appendChild(discountCell);

      var totalCell = document.createElement("td");
      totalCell.textContent = money(round2(lineTotal - line.discount));
      row.appendChild(totalCell);

      var dropCell = document.createElement("td");
      var drop = document.createElement("button");
      drop.className = "drop";
      drop.textContent = "✕";
      drop.addEventListener("click", function () { cart.splice(index, 1); render(); });
      dropCell.appendChild(drop);
      row.appendChild(dropCell);

      body.appendChild(row);
    });

    renderTotals();
  }

  function totals() {
    var subtotal = 0;
    var lineDiscounts = 0;

    cart.forEach(function (line) {
      subtotal += round2(line.unit_price * line.quantity);
      lineDiscounts += line.discount || 0;
    });

    var orderDiscount = num(el("order-discount").value);
    var discountTotal = Math.min(round2(lineDiscounts + orderDiscount), subtotal);

    return {
      subtotal: round2(subtotal),
      discountTotal: discountTotal,
      total: round2(subtotal - discountTotal)
    };
  }

  function renderTotals() {
    var sums = totals();
    el("subtotal").textContent = money(sums.subtotal);
    el("discounts").textContent = money(sums.discountTotal);
    el("total").textContent = money(sums.total);

    var isCash = el("payment").value === "cash";
    el("cash-field").classList.toggle("hidden", !isCash);

    var given = num(el("cash").value);
    var change = el("change");
    if (isCash && given > 0) {
      change.textContent = given >= sums.total
        ? "Сдача: " + money(round2(given - sums.total))
        : "Не хватает: " + money(round2(sums.total - given));
      change.classList.remove("hidden");
    } else {
      change.classList.add("hidden");
    }
  }

  // --- Продажа -------------------------------------------------------------

  function sell() {
    if (!cart.length) {
      showError("Чек пуст");
      return;
    }

    var button = el("sell");
    button.disabled = true;
    hideError();

    api("/admin/pos/sale", {
      method: "POST",
      body: {
        items: cart.map(function (line) {
          return { variant_id: line.variant_id, quantity: line.quantity, discount: line.discount || 0 };
        }),
        order_discount: num(el("order-discount").value),
        payment_method: el("payment").value,
        customer: {
          name: el("customer-name").value.trim(),
          phone: el("customer-phone").value.trim()
        }
      }
    }).then(function (data) {
      showReceipt(data);
      cart = [];
      el("order-discount").value = "";
      el("cash").value = "";
      el("customer-name").value = "";
      el("customer-phone").value = "";
      render();
    }).catch(showError).then(function () {
      button.disabled = false;
    });
  }

  function showReceipt(data) {
    var receipt = data.receipt;
    var view = el("receipt-view");
    view.innerHTML = "";

    var title = document.createElement("h2");
    title.textContent = "Чек №" + (data.order.display_id || "—");
    view.appendChild(title);

    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = new Date(data.order.created_at).toLocaleString("ru-RU") + " · " + receipt.payment_method;
    view.appendChild(sub);

    var table = document.createElement("table");
    receipt.items.forEach(function (item) {
      var row = document.createElement("tr");
      var name = document.createElement("td");
      name.textContent = item.title + (item.variant_title ? " (" + item.variant_title + ")" : "");
      var qty = document.createElement("td");
      qty.textContent = "×" + item.quantity;
      var sum = document.createElement("td");
      sum.textContent = (item.line_total - item.discount).toFixed(2);
      row.appendChild(name);
      row.appendChild(qty);
      row.appendChild(sum);
      table.appendChild(row);
    });
    view.appendChild(table);

    var totalsBox = document.createElement("div");
    totalsBox.className = "totals";
    [["Подытог", receipt.subtotal], ["Скидки", receipt.discount_total], ["Итого", receipt.total]].forEach(function (pair, index) {
      var line = document.createElement("div");
      if (index === 2) { line.className = "grand"; }
      var label = document.createElement("span");
      label.textContent = pair[0];
      var value = document.createElement("span");
      value.textContent = pair[1].toFixed(2) + " " + String(receipt.currency_code).toUpperCase();
      line.appendChild(label);
      line.appendChild(value);
      totalsBox.appendChild(line);
    });
    view.appendChild(totalsBox);

    // Продажу могло записать не полностью: заказ создан, а оплата или
    // списание остатков не прошли. Кассир должен об этом узнать сразу.
    if (!data.payment_recorded || !data.stock_deducted) {
      var warn = document.createElement("div");
      warn.className = "msg msg-error";
      warn.textContent = "Заказ создан, но " +
        (!data.payment_recorded ? "оплата не отмечена. " : "") +
        (!data.stock_deducted ? "остатки не списаны. " : "") +
        "Передайте номер чека администратору.";
      view.appendChild(warn);
    }

    var actions = document.createElement("div");
    actions.className = "actions";
    var printButton = document.createElement("button");
    printButton.className = "primary";
    printButton.textContent = "Печать";
    printButton.addEventListener("click", function () { window.print(); });
    var nextButton = document.createElement("button");
    nextButton.className = "primary";
    nextButton.textContent = "Новая продажа";
    nextButton.addEventListener("click", showApp);
    actions.appendChild(printButton);
    actions.appendChild(nextButton);
    view.appendChild(actions);

    el("app").classList.add("hidden");
    view.classList.remove("hidden");
  }

  // --- Сообщения -----------------------------------------------------------

  function showError(err) {
    var box = el("error");
    box.textContent = typeof err === "string" ? err : err.message;
    box.classList.remove("hidden");
  }

  function hideError() {
    el("error").classList.add("hidden");
  }

  // --- Обработчики ---------------------------------------------------------

  el("login-form").addEventListener("submit", signIn);
  el("logout").addEventListener("click", signOut);
  el("sell").addEventListener("click", sell);
  el("order-discount").addEventListener("input", renderTotals);
  el("cash").addEventListener("input", renderTotals);
  el("payment").addEventListener("change", renderTotals);

  el("term").addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 250);
  });

  // Сканер штрихкодов работает как клавиатура: набирает код и жмёт Enter.
  // Если нашлась ровно одна позиция, она сразу падает в чек — кассиру не
  // нужно ничего дожимать мышью.
  el("term").addEventListener("keydown", function (event) {
    if (event.key !== "Enter") { return; }
    event.preventDefault();
    clearTimeout(searchTimer);

    var term = el("term").value.trim();
    if (!term) { return; }

    api("/admin/pos/search?q=" + encodeURIComponent(term)).then(function (data) {
      var variants = data.variants || [];
      if (variants.length === 1) {
        addToCart(variants[0]);
      } else {
        lastFound = variants;
        renderFound();
      }
    }).catch(showError);
  });

  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }
  if (token) { showApp(); } else { el("email").focus(); }
})();
</script>
</body>
</html>
`
