/* =========================
   assets/admin.js (完整重寫 v2.1)
   - 修正：主列表改用 /orders/paged 分頁（300/頁）
   - 修正：日期篩選「看起來沒作用」：補齊 enabled 開關 + 套用後強制重算 + 顯示篩選摘要
   - 修正：工具列按鈕集中到 listActions（避免按鈕散落）
   - 保留：手機互動事件代理、ID/買家彈窗、編輯/刪除/重印、同步 .env
   ========================= */

const $ = (id) => document.getElementById(id);

const STATUS_ZH = {
  queued: "排隊中",
  printing: "列印中",
  printed: "已完成",
  failed: "失敗",
  canceled: "已取消",
};

const LS_KEY = "shopee_admin_config_v1";
const LS_USER_RANGE_DAYS = "shopee_admin_user_range_days_v1";
const LS_LIST_DATE_FILTER = "shopee_admin_list_date_filter_v1";
const LS_LIST_ONLY_VALID = "shopee_admin_list_only_valid_v1";

const STATE = {
  ordersAll: [], // 當前頁 raw data（mapped）
  ordersView: [], // 套用前端篩選後的視圖（顯示用）
  currentUser: null,
  currentUserFiltered: [],
  currentUserTotal: 0,
  lastRangeDays: 7,

  // 主列表日期篩選（前端）
  listDateFilter: { enabled: false, start: null, end: null }, // YYYY-MM-DD

  // 主列表：是否僅顯示有效訂單（前端）
  listOnlyValid: false, // 預設 false：避免舊資料被隱藏

  // 伺服器分頁狀態（/orders/paged）
  pager: { page: 1, pageSize: 300, total: 0, hasPrev: false, hasNext: false },
};

/* ========= 裝置判斷 ========= */
/**
 * 功能說明：讀取使用者明細預設查詢天數（7/30）。
 */
function loadLastRangeDays() {
  const raw = localStorage.getItem(LS_USER_RANGE_DAYS);
  const n = Number(raw);
  if (!isNaN(n) && (n === 7 || n === 30)) STATE.lastRangeDays = n;
}

/**
 * 功能說明：儲存使用者明細預設查詢天數（7/30）。
 */
function saveLastRangeDays(days) {
  if (days !== 7 && days !== 30) return;
  STATE.lastRangeDays = days;
  localStorage.setItem(LS_USER_RANGE_DAYS, String(days));
}

/**
 * 功能說明：儲存主列表日期篩選設定到 localStorage。
 */
function saveListDateFilterToLocal() {
  localStorage.setItem(LS_LIST_DATE_FILTER, JSON.stringify(STATE.listDateFilter));
}

/**
 * 功能說明：從 localStorage 讀取主列表日期篩選設定。
 */
function loadListDateFilterFromLocal() {
  const raw = localStorage.getItem(LS_LIST_DATE_FILTER);
  if (!raw) return;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") {
      STATE.listDateFilter = {
        enabled: !!v.enabled,
        start: v.start || null,
        end: v.end || null,
      };
    }
  } catch {}
}

/**
 * 功能說明：讀取主列表「僅有效」開關（localStorage）。
 */
function loadListOnlyValidFromLocal() {
  const raw = localStorage.getItem(LS_LIST_ONLY_VALID);
  if (raw === "1") STATE.listOnlyValid = true;
  if (raw === "0") STATE.listOnlyValid = false;
}

/**
 * 功能說明：儲存主列表「僅有效」開關（localStorage）。
 */
function saveListOnlyValidToLocal() {
  localStorage.setItem(LS_LIST_ONLY_VALID, STATE.listOnlyValid ? "1" : "0");
}

/* ========= API ========= */
/**
 * 功能說明：取得 API 設定（Base URL 與 API Key），不足則拋錯。
 */
function getApiConfig() {
  const base = ($("baseUrl")?.value || "").trim();
  const key = ($("apiKey")?.value || "").trim();
  if (!base) throw new Error("Base URL 空白（例：http://YOUR_HOST:8000）");
  if (!key) throw new Error("API Key 空白：請填入後按「儲存設定」");
  return { base, key };
}

/**
 * 功能說明：統一 API 請求封裝（帶 API Key、避免快取、標準化錯誤處理）。
 */
async function apiFetch(path, options = {}) {
  const { base, key } = getApiConfig();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${base}${path}${sep}_ts=${Date.now()}`;

  let res;
  try {
    res = await fetch(url, {
      ...options,
      cache: "no-store",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    throw new Error(`Fetch 失敗（可能是 CORS/連線/網址錯）：${e.message || e}`);
  }

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}：${t}`);
  }

  const txt = await res.text();
  return txt ? JSON.parse(txt) : { ok: true };
}

/* ========= 日期/時間 ========= */
/**
 * 功能說明：數字補零到兩位（日期格式用）。
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * 功能說明：Date 轉 YYYY-MM-DD，供 input[type=date] 使用。
 */
function toDateInputValue(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

/**
 * 功能說明：Date 轉 YYYY-MM-DD（僅日期，不含時間）。
 */
function dateOnlyStrFromDate(d) {
  if (!d || isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 功能說明：從訂單資料解析時間（comment_ts 優先，其次 created_at）。
 */
function parseOrderTime(o) {
  if (!o) return null;

  if (o.comment_ts != null) {
    const t = Number(o.comment_ts);
    if (!isNaN(t) && t > 0) {
      const ms = t < 2e12 ? t * 1000 : t; // 支援秒/毫秒
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
  }

  if (o.created_at) {
    const d = new Date(o.created_at);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * 功能說明：YYYY-MM-DD 轉 Date（00:00:00）。
 */
function parseYmdToDate(ymd) {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 功能說明：判斷日期是否落在起迄日區間內（含端點）。
 */
function inDateRangeInclusive(d, startYmd, endYmd) {
  if (!d || isNaN(d.getTime())) return false;
  const start = parseYmdToDate(startYmd);
  const end = parseYmdToDate(endYmd);
  if (!start || !end) return true;

  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return x.getTime() >= s.getTime() && x.getTime() <= e.getTime();
}

/* ========= 訂單處理 ========= */
/**
 * 功能說明：依時間由新到舊排序訂單。
 */
function sortOrdersNewestFirst(items) {
  return (items || []).slice().sort((a, b) => {
    const ta = parseOrderTime(a)?.getTime?.() ?? 0;
    const tb = parseOrderTime(b)?.getTime?.() ?? 0;
    return tb - ta;
  });
}

/* ========= Modal 工具（動態） ========= */
/**
 * 功能說明：確保指定 id 的 modal 存在（不存在則建立）並綁定關閉行為。
 */
function ensureModal(id, titleText) {
  let mask = $(id);
  if (mask) return mask;

  mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.id = id;
  mask.innerHTML = `
    <div class="modal">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div style="font-weight:700;" data-role="title">${escapeHtml(titleText || "")}</div>
        <button class="btn secondary" type="button" data-role="close">關閉</button>
      </div>
      <div data-role="body" style="margin-top:10px;"></div>
    </div>
  `;
  document.body.appendChild(mask);

  mask.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.role === "close") hideModal(id);
    if (t === mask) hideModal(id);
  });

  return mask;
}

/**
 * 功能說明：顯示指定 modal。
 */
function showModal(id) {
  const m = $(id);
  if (m) m.style.display = "block";
}

/**
 * 功能說明：隱藏指定 modal。
 */
function hideModal(id) {
  const m = $(id);
  if (m) m.style.display = "none";
}

/* ========= 主列表工具列（集中按鈕用） ========= */
/**
 * 功能說明：取得主列表 header 的 actions 容器（不存在則建立）。
 */
function getListActionsWrap() {
  const panel = $("panelList");
  if (!panel) return null;

  const headerRow = panel.querySelector(".row");
  if (!headerRow) return null;

  let wrap = $("listActions");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "listActions";
    wrap.className = "row";
    wrap.style.gap = "6px";
    wrap.style.alignItems = "center";
    headerRow.appendChild(wrap);
  }
  return wrap;
}

/* ========= 列表日期篩選 ========= */
/**
 * 功能說明：套用主列表篩選條件（僅有效/日期範圍）並重新渲染列表與摘要。
 * 重要：目前分頁是後端做的；前端篩選只影響「當前頁」顯示。
 */
function applyListDateFilter() {
  const f = STATE.listDateFilter;
  let out = STATE.ordersAll.slice();

  // 前端：僅有效
  if (STATE.listOnlyValid) out = out.filter((o) => o && o.is_valid_order);

  // 前端：日期範圍（含端點）
  if (f.enabled && f.start && f.end) {
    out = out.filter((o) => inDateRangeInclusive(parseOrderTime(o), f.start, f.end));
  }

  STATE.ordersView = out;
  renderList(STATE.ordersView);
  renderListMeta();
  renderPager(); // 分頁資訊（伺服器回傳的 total/page）
}

/**
 * 功能說明：渲染主列表的筆數與篩選條件摘要。
 */
function renderListMeta() {
  const meta = $("listMeta");
  if (!meta) return;

  const f = STATE.listDateFilter;
  const validTxt = STATE.listOnlyValid ? "僅有效" : "含無效/歷史";
  const base = `本頁顯示 ${STATE.ordersView.length} 筆（${validTxt}）`;

  meta.textContent =
    f.enabled && f.start && f.end ? `${base}｜日期：${f.start} ~ ${f.end}` : base;
}

/**
 * 功能說明：渲染分頁控制（上一頁/下一頁）與頁碼資訊。
 */
function renderPager() {
  const panel = $("panelList");
  if (!panel) return;

  let pager = $("pager");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "pager";
    pager.className = "row";
    pager.style.justifyContent = "space-between";
    pager.style.alignItems = "center";
    pager.style.marginTop = "10px";
    panel.appendChild(pager);
  }

  const p = STATE.pager;
  const totalPages = p.total ? Math.max(1, Math.ceil(p.total / p.pageSize)) : 1;

  pager.innerHTML = `
    <div class="small">第 ${p.page} / ${totalPages} 頁（後端總計 ${p.total} 筆）</div>
    <div class="row" style="gap:6px;">
      <button class="btn secondary" type="button" id="btnPrevPage" ${p.hasPrev ? "" : "disabled"}>上一頁</button>
      <button class="btn secondary" type="button" id="btnNextPage" ${p.hasNext ? "" : "disabled"}>下一頁</button>
    </div>
  `;

  $("btnPrevPage")?.addEventListener("click", () => {
    pauseAutoRefresh();
    if (!STATE.pager.hasPrev) return;
    STATE.pager.page = Math.max(1, STATE.pager.page - 1);
    refreshAll();
  });

  $("btnNextPage")?.addEventListener("click", () => {
    pauseAutoRefresh();
    if (!STATE.pager.hasNext) return;
    STATE.pager.page += 1;
    refreshAll();
  });
}

/**
 * 功能說明：在主列表工具列插入「篩選日期」按鈕並綁定事件。
 */
function injectListFilterButton() {
  if ($("btnListDateFilter")) return;

  const wrap = getListActionsWrap();
  if (!wrap) return;

  const btn = document.createElement("button");
  btn.className = "btn secondary";
  btn.id = "btnListDateFilter";
  btn.type = "button";
  btn.textContent = "篩選日期";
  wrap.appendChild(btn);

  btn.addEventListener("click", () => {
    pauseAutoRefresh();
    openListDateFilterModal();
  });
}

/**
 * 功能說明：主列表「僅顯示有效」切換按鈕（前端篩選，不影響 DB）。
 */
function injectListOnlyValidToggle() {
  if ($("btnListOnlyValid")) return;

  const wrap = getListActionsWrap();
  if (!wrap) return;

  const btn = document.createElement("button");
  btn.className = "btn secondary";
  btn.id = "btnListOnlyValid";
  btn.type = "button";

  function syncText() {
    btn.textContent = STATE.listOnlyValid ? "僅有效：ON" : "僅有效：OFF";
  }
  syncText();

  wrap.appendChild(btn);

  btn.addEventListener("click", () => {
    pauseAutoRefresh();
    STATE.listOnlyValid = !STATE.listOnlyValid;
    saveListOnlyValidToLocal();
    syncText();
    applyListDateFilter();
  });
}

/**
 * 功能說明：開啟主列表日期篩選 modal（啟用開關 + 起迄日 + 清除/套用）。
 */
function openListDateFilterModal() {
  const mask = ensureModal("listDateMask", "抓單列表：日期篩選");
  const body = mask.querySelector('[data-role="body"]');

  const today = new Date();
  const defaultEnd = toDateInputValue(today);
  const defaultStart = toDateInputValue(new Date(today.getTime() - 7 * 86400000));

  const f = STATE.listDateFilter;
  const startVal = f.start || defaultStart;
  const endVal = f.end || defaultEnd;
  const enabled = !!f.enabled;

  body.innerHTML = `
    <div class="panel">
      <div class="panel-body">
        <div class="hint">只影響「當前頁」抓單列表顯示（後端分頁仍以全量計算）。</div>

        <div class="row" style="margin-top:10px; align-items:center;">
          <label class="pill" style="display:flex; gap:8px; align-items:center;">
            <input id="listFilterEnable" type="checkbox" ${enabled ? "checked" : ""} />
            啟用日期篩選
          </label>
        </div>

        <div class="row" style="margin-top:10px;">
          <div class="col">
            <label class="label">日期起</label>
            <div class="datefield">
              <input id="listFilterStart" type="date" value="${escapeAttr(startVal)}" />
              <button class="iconbtn mini" type="button" data-pick="listFilterStart" title="選擇開始日期">📅</button>
            </div>
          </div>

          <div class="col">
            <label class="label">日期迄</label>
            <div class="datefield">
              <input id="listFilterEnd" type="date" value="${escapeAttr(endVal)}" />
              <button class="iconbtn mini" type="button" data-pick="listFilterEnd" title="選擇結束日期">📅</button>
            </div>
            <div class="errorline" id="listDateErr" style="display:none;">截止日不能早於開始日</div>
          </div>
        </div>

        <div class="footer">
          <button class="btn secondary" type="button" id="btnListFilterClear">清除篩選</button>
          <button class="btn" type="button" id="btnListFilterApply">套用</button>
        </div>
      </div>
    </div>
  `;

  body.querySelectorAll("[data-pick]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.pick;
      const el = $(id);
      if (el) el.showPicker ? el.showPicker() : el.focus();
    });
  });

  const err = $("listDateErr");
  const startEl = $("listFilterStart");
  const endEl = $("listFilterEnd");

  /**
   * 功能說明：驗證起迄日（e >= s），並顯示/隱藏錯誤提示。
   */
  function validate() {
    if (!startEl || !endEl) return true;
    if (!startEl.value || !endEl.value) return true;
    if (endEl.value < startEl.value) {
      if (err) err.style.display = "block";
      return false;
    }
    if (err) err.style.display = "none";
    return true;
  }

  startEl?.addEventListener("change", validate);
  endEl?.addEventListener("change", validate);

  /**
   * 功能說明：清除日期篩選（關閉 enabled + 清空日期）。
   */
  $("btnListFilterClear")?.addEventListener("click", () => {
    STATE.listDateFilter = { enabled: false, start: null, end: null };
    saveListDateFilterToLocal();
    hideModal("listDateMask");
    applyListDateFilter();
  });

  /**
   * 功能說明：套用日期篩選（enabled + start/end），並即時重繪列表。
   */
  $("btnListFilterApply")?.addEventListener("click", () => {
    if (!validate()) return;

    const en = !!$("listFilterEnable")?.checked;
    const s = startEl?.value || null;
    const e = endEl?.value || null;

    // 重點：enabled 必須搭配完整日期才會生效
    STATE.listDateFilter.enabled = en && !!s && !!e;
    STATE.listDateFilter.start = s;
    STATE.listDateFilter.end = e;

    saveListDateFilterToLocal();
    hideModal("listDateMask");
    applyListDateFilter();
  });

  showModal("listDateMask");
}

/* ========= 列表渲染 ========= */
/**
 * 功能說明：將訂單清單渲染到主列表 UI。
 */
function renderList(items) {
  const box = $("stream");
  if (!box) return;

  box.innerHTML = "";
  if (!items || !items.length) {
    box.innerHTML = "<div class='hint'>沒有訂單</div>";
    return;
  }

  for (const o of items) {
    const st = o.status || "queued";
    const pillClass =
      st === "failed"
        ? "bad"
        : st === "canceled"
        ? "cancel"
        : st === "queued" || st === "printing"
        ? "warn"
        : "ok";

    const d = parseOrderTime(o);
    const dateStr = dateOnlyStrFromDate(d);

    box.insertAdjacentHTML(
      "beforeend",
      `
      <div class="msg" data-id="${escapeAttr(o.id)}" data-status="${escapeAttr(st)}" data-user="${escapeAttr(o.user)}">
        <div class="avatar">${escapeHtml((o.user || "?")[0])}</div>

        <div class="content">
          <div class="meta">
            <span class="pill">ID
              <span class="userlink" data-action="openOrder" style="margin-left:6px; text-decoration:underline;">
                #${escapeHtml(o.id)}
              </span>
            </span>
            <span class="pill">日期 ${escapeHtml(dateStr)}</span>
            <span class="userlink" data-action="openUser">${escapeHtml(o.user ?? "")}</span>
            <span class="pill ${pillClass}">${escapeHtml(STATUS_ZH[st] ?? st)}</span>
            <span class="pill">重印次數 ${Number(o.reprint_count ?? 0)}</span>
            <span class="pill">金額 ${Number(o.amount ?? 0)}</span>
          </div>

          <div class="text">${escapeHtml(o.msg || "")}</div>
          ${o.error ? `<div class="error">提示：${escapeHtml(o.error)}</div>` : ""}
        </div>

        <div class="actions">
          <div class="iconbtn" title="編輯" data-action="edit">✏️</div>
          <div class="iconbtn" title="刪除" data-action="delete">🗑️</div>
          <div class="iconbtn" title="重印" data-action="reprint">🖨</div>
        </div>
      </div>
    `
    );
  }
}

/* ========= 列表事件代理（手機互動無反應的核心修正） ========= */
/**
 * 功能說明：主列表事件代理：處理點擊買家/ID/編輯/刪除/重印等操作。
 */
function bindListEvents() {
  const box = $("stream");
  if (!box) return;

  box.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      const row = t?.closest?.(".msg");
      if (!row) return;

      pauseAutoRefresh();

      const id = row.dataset.id;
      const status = row.dataset.status;
      const user = row.dataset.user;

      const action = t?.dataset?.action || t?.closest?.("[data-action]")?.dataset?.action;
      if (!action) return;

      if (action === "openUser") return openUserModal(user);
      if (action === "openOrder") return openOrderModal(id);
      if (action === "edit") return openEditModal(id);
      if (action === "delete") return openDeleteModal(id, status);
      if (action === "reprint") return openReprintConfirm(id);
    },
    { passive: true }
  );
}

/* ========= ID 明細（含 print-jobs） ========= */
/**
 * 功能說明：開啟訂單明細 modal（含 print-jobs 歷史）。
 */
async function openOrderModal(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return;

  const mask = ensureModal("orderMask", `訂單 #${id} 明細`);
  const title = mask.querySelector('[data-role="title"]');
  if (title) title.textContent = `訂單 #${id} 明細`;

  const body = mask.querySelector('[data-role="body"]');
  body.innerHTML = `<div class="hint">載入中…</div>`;
  showModal("orderMask");

  try {
    const order = await apiFetch(`/orders/${encodeURIComponent(id)}`);
    const jobs = await apiFetch(`/orders/${encodeURIComponent(id)}/print-jobs`);

    const od = parseOrderTime({ comment_ts: order.comment_ts, created_at: order.created_at });
    const orderDate = dateOnlyStrFromDate(od);

    const jobRows = (jobs || [])
      .map((j) => {
        const cd = j.created_at ? dateOnlyStrFromDate(new Date(j.created_at)) : "-";
        const ud = j.updated_at ? dateOnlyStrFromDate(new Date(j.updated_at)) : "-";
        const st = j.status || "-";
        const pillClass =
          st === "failed"
            ? "bad"
            : st === "canceled"
            ? "cancel"
            : st === "queued" || st === "printing"
            ? "warn"
            : "ok";

        return `
        <tr>
          <td>#${escapeHtml(j.id)}</td>
          <td><span class="pill ${pillClass}">${escapeHtml(STATUS_ZH[st] ?? st)}</span></td>
          <td>${escapeHtml(String(j.attempts ?? 0))}</td>
          <td>${escapeHtml(cd)}</td>
          <td>${escapeHtml(ud)}</td>
          <td>${escapeHtml(j.last_error || "")}</td>
        </tr>
      `;
      })
      .join("");

    body.innerHTML = `
      <div class="panel">
        <div class="panel-body">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <div style="font-weight:700;">基本資訊</div>
            <div class="row" style="gap:8px;">
              <button class="btn secondary" type="button" id="btnOrderEdit">編輯</button>
              <button class="btn secondary" type="button" id="btnOrderDelete">刪除</button>
              <button class="btn" type="button" id="btnOrderReprint">重印</button>
            </div>
          </div>

          <div class="meta" style="margin-top:10px;">
            <span class="pill">日期 ${escapeHtml(orderDate)}</span>
            <span class="pill">買家 ${escapeHtml(order.username || "")}</span>
            <span class="pill">金額 ${escapeHtml(String(order.amount ?? 0))}</span>
          </div>

          <div class="text" style="margin-top:8px;">${escapeHtml(order.raw_message || "")}</div>
        </div>
      </div>

      <div class="panel" style="margin-top:12px;">
        <div class="panel-body">
          <div style="font-weight:700;">列印工作（print-jobs）歷史</div>
          ${
            jobRows
              ? `
                <table class="table">
                  <thead>
                    <tr>
                      <th>Job ID</th><th>狀態</th><th>嘗試</th><th>建立日</th><th>更新日</th><th>錯誤</th>
                    </tr>
                  </thead>
                  <tbody>${jobRows}</tbody>
                </table>
              `
              : `<div class="hint" style="margin-top:8px;">尚無 print-jobs</div>`
          }
        </div>
      </div>
    `;

    $("btnOrderEdit")?.addEventListener("click", () => openEditModal(id));
    $("btnOrderDelete")?.addEventListener("click", () => openDeleteModal(id, order.latest_print_status || "queued"));
    $("btnOrderReprint")?.addEventListener("click", () => openReprintConfirm(id));
  } catch (e) {
    body.innerHTML = `<div class="error">載入失敗：${escapeHtml(e.message)}</div>`;
  }
}

/* ========= 編輯 ========= */
/**
 * 功能說明：開啟訂單編輯 modal，支援更新金額與留言內容。
 */
async function openEditModal(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return;

  const mask = ensureModal("editMask", `編輯訂單 #${id}`);
  const title = mask.querySelector('[data-role="title"]');
  if (title) title.textContent = `編輯訂單 #${id}`;

  const body = mask.querySelector('[data-role="body"]');
  body.innerHTML = `<div class="hint">載入中…</div>`;
  showModal("editMask");

  try {
    const order = await apiFetch(`/orders/${encodeURIComponent(id)}`);

    body.innerHTML = `
      <div class="panel">
        <div class="panel-body">
          <div class="hint">僅更新：金額 / 內容（raw_message）。</div>

          <div class="row" style="margin-top:10px;">
            <div class="col">
              <label class="label">金額</label>
              <input id="editAmount" inputmode="numeric" value="${escapeAttr(String(order.amount ?? 0))}" />
            </div>
          </div>

          <div class="row" style="margin-top:10px;">
            <div class="col">
              <label class="label">內容</label>
              <textarea id="editMsg" rows="4">${escapeHtml(order.raw_message || "")}</textarea>
            </div>
          </div>

          <div class="footer">
            <button class="btn secondary" type="button" id="btnEditCancel">取消</button>
            <button class="btn" type="button" id="btnEditSave">儲存</button>
          </div>
        </div>
      </div>
    `;

    $("btnEditCancel")?.addEventListener("click", () => hideModal("editMask"));

    $("btnEditSave")?.addEventListener("click", async () => {
      pauseAutoRefresh();

      const amtRaw = ($("editAmount")?.value || "").trim();
      const msg = ($("editMsg")?.value || "").trim();

      const amt = Number(amtRaw);
      if (!Number.isFinite(amt) || amt < 0) {
        setMsg("金額格式不正確", true);
        return;
      }

      try {
        await apiFetch(`/orders/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ amount: Math.trunc(amt), raw_message: msg }),
        });

        setMsg(`已更新：#${id}`);
        hideModal("editMask");
        await refreshAll();
      } catch (e) {
        setMsg(e.message, true);
      }
    });
  } catch (e) {
    body.innerHTML = `<div class="error">載入失敗：${escapeHtml(e.message)}</div>`;
  }
}

/* ========= 刪除（作廢） ========= */
/**
 * 功能說明：開啟刪除（作廢）確認 modal，將訂單標記為無效。
 */
function openDeleteModal(orderId, status) {
  const id = String(orderId || "").trim();
  if (!id) return;

  const mask = ensureModal("deleteMask", `刪除訂單 #${id}`);
  const title = mask.querySelector('[data-role="title"]');
  if (title) title.textContent = `刪除訂單 #${id}`;

  const body = mask.querySelector('[data-role="body"]');

  let warn = "確定要刪除（作廢）此訂單？（不會刪除歷史紀錄）";
  if (status === "printing") warn = "此訂單正在列印中，仍要刪除（作廢）嗎？（可能仍會印出）";
  if (status === "printed") warn = "此訂單已完成列印，仍要刪除（作廢）嗎？（僅做紀錄）";

  body.innerHTML = `
    <div class="panel">
      <div class="panel-body">
        <div class="hint">${escapeHtml(warn)}</div>

        <div class="footer">
          <button class="btn secondary" type="button" id="btnDeleteCancel">取消</button>
          <button class="btn" type="button" id="btnDeleteOk">確認刪除</button>
        </div>
      </div>
    </div>
  `;

  $("btnDeleteCancel")?.addEventListener("click", () => hideModal("deleteMask"));

  $("btnDeleteOk")?.addEventListener("click", async () => {
    pauseAutoRefresh();
    try {
      await apiFetch(`/orders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_valid_order: 0 }),
      });
      setMsg(`已刪除（作廢）：#${id}`);
      hideModal("deleteMask");
      await refreshAll();
    } catch (e) {
      setMsg(e.message, true);
    }
  });

  showModal("deleteMask");
}

/* ========= 重印 ========= */
/**
 * 功能說明：開啟重印確認 modal，送出重印 job。
 */
function openReprintConfirm(orderId) {
  const id = String(orderId || "").trim();
  if (!id) return;

  const mask = ensureModal("reprintMask", `重印確認 #${id}`);
  const title = mask.querySelector('[data-role="title"]');
  if (title) title.textContent = `重印確認 #${id}`;

  const body = mask.querySelector('[data-role="body"]');
  body.innerHTML = `
    <div class="panel">
      <div class="panel-body">
        <div class="hint">確定要重印訂單 #${escapeHtml(id)}？（可能造成多張列印）</div>
        <div class="footer">
          <button class="btn secondary" type="button" id="btnReprintCancel">取消</button>
          <button class="btn" type="button" id="btnReprintOk">確認重印</button>
        </div>
      </div>
    </div>
  `;

  $("btnReprintCancel")?.addEventListener("click", () => hideModal("reprintMask"));

  $("btnReprintOk")?.addEventListener("click", async () => {
    pauseAutoRefresh();
    try {
      await apiFetch(`/orders/${encodeURIComponent(id)}/reprint`, { method: "POST" });
      setMsg(`已送出重印：#${id}`);
      hideModal("reprintMask");
      await refreshAll();
    } catch (e) {
      setMsg(e.message, true);
    }
  });

  showModal("reprintMask");
}

/* ========= 使用者查詢（userModalMask） ========= */
/**
 * 功能說明：更新使用者明細 modal 標題文字。
 */
function updateUserModalTitle() {
  const t = $("userModalTitle");
  if (!t) return;
  const u = STATE.currentUser || "";
  t.textContent = u ? `客戶訂單查詢：${u}` : "客戶訂單查詢";
}

/**
 * 功能說明：驗證使用者明細日期起迄是否合法（結束不可早於開始）。
 */
function validateDateRange() {
  const s = $("filterStartDate")?.value || "";
  const e = $("filterEndDate")?.value || "";
  const err = $("dateError");
  if (!s || !e) {
    if (err) err.style.display = "none";
    return true;
  }
  if (e < s) {
    if (err) err.style.display = "block";
    return false;
  }
  if (err) err.style.display = "none";
  return true;
}

/**
 * 功能說明：依買家與日期範圍篩選該買家的訂單，並更新合計。
 * 注意：此處資料來源是 STATE.ordersAll（當前頁），若你想查全量需改後端 API。
 */
function applyUserFilter() {
  if (!STATE.currentUser) return;
  if (!validateDateRange()) return;

  const s = $("filterStartDate")?.value || null;
  const e = $("filterEndDate")?.value || null;

  const orders = STATE.ordersAll.filter((o) => (o.user || "").trim() === STATE.currentUser);
  const filtered = orders.filter((o) => {
    const d = parseOrderTime(o);
    if (!s || !e) return true;
    return inDateRangeInclusive(d, s, e);
  });

  const sorted = sortOrdersNewestFirst(filtered);
  STATE.currentUserFiltered = sorted;
  STATE.currentUserTotal = sorted.reduce((acc, x) => acc + Number(x.amount ?? 0), 0);

  renderUserTable();
}

/**
 * 功能說明：渲染使用者明細表格與統計。
 */
function renderUserTable() {
  const wrap = $("userTableWrap");
  if (!wrap) return;

  const items = STATE.currentUserFiltered || [];
  if (!items.length) {
    wrap.innerHTML = "<div class='hint'>沒有資料</div>";
  } else {
    const rows = items
      .map((o) => {
        const ds = dateOnlyStrFromDate(parseOrderTime(o));
        return `
        <tr>
          <td>${escapeHtml(ds)}</td>
          <td>${escapeHtml(o.user || "")}</td>
          <td>${escapeHtml(String(o.amount ?? 0))}</td>
        </tr>
      `;
      })
      .join("");

    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr><th>日期</th><th>買家名稱</th><th>金額</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  const sum = $("userSummary");
  if (sum) {
    sum.textContent = items.length ? `筆數：${items.length}｜合計：${STATE.currentUserTotal}` : "尚未篩選";
  }

  buildCopyText();
}

/**
 * 功能說明：生成可複製的客服用訂單明細文字（含合計）。
 */
function buildCopyText() {
  const ta = $("copyText");
  if (!ta) return;

  const items = STATE.currentUserFiltered || [];
  if (!items.length) {
    ta.value = "";
    return;
  }

  const lines = [];
  lines.push("親愛的客人您好，");
  lines.push("");

  const buyerId = (items[0].user || "").trim();
  lines.push(`買家 ID：${buyerId}`);
  lines.push("訂單明細如下：");

  let totalAmount = 0;

  items.forEach((o, idx) => {
    const ds = dateOnlyStrFromDate(parseOrderTime(o));
    const amount = Number(o.amount ?? 0);
    lines.push(`${idx + 1}. ${ds}　$${amount}`);
    totalAmount += amount;
  });

  lines.push("");
  lines.push(`總共 ${items.length} 筆`);
  lines.push(`總金額：$${totalAmount}`);

  ta.value = lines.join("\n");
}


/* ========= 匯出：買家彙總 / 客服明細 ========= */
/**
 * 功能說明：將清單依買家分組，回傳 Map<buyerId, orders[]>。
 * @param {Array} items - 訂單陣列（建議用 STATE.ordersView 或 STATE.ordersAll）
 */
function groupOrdersByBuyer(items) {
  const m = new Map();
  for (const o of items || []) {
    const buyer = String(o?.user || "").trim();
    if (!buyer) continue;
    if (!m.has(buyer)) m.set(buyer, []);
    m.get(buyer).push(o);
  }
  return m;
}

/**
 * 功能說明：將某買家的 orders 依日期排序（新到舊），並生成客服明細文字（你指定的格式）。
 * @param {string} buyerId
 * @param {Array} orders
 */
function buildBuyerSummaryText(buyerId, orders) {
  const sorted = sortOrdersNewestFirst(orders || []);
  const lines = [];

  lines.push("親愛的客人您好，");
  lines.push("");
  lines.push(`買家 ID：${buyerId}`);
  lines.push("訂單明細如下：");

  let total = 0;
  sorted.forEach((o, idx) => {
    const ds = dateOnlyStrFromDate(parseOrderTime(o));
    const amt = Number(o?.amount ?? 0) || 0;
    total += amt;
    lines.push(`${idx + 1}. ${ds}　$${amt}`);
  });

  lines.push("");
  lines.push(`總共 ${sorted.length} 筆`);
  lines.push(`總金額：$${total}`);

  return lines.join("\n");
}

/**
 * 功能說明：下載檔案（純前端 Blob），不需要後端。
 * @param {string} filename
 * @param {string} content
 * @param {string} mime
 */
function downloadTextFile(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 功能說明：匯出 TXT（每個買家一段客服明細）。
 * 來源預設用 STATE.ordersView（也就是你目前畫面套過日期/僅有效後的資料）。
 */
function exportBuyerSummariesTxt() {
  pauseAutoRefresh();

  const source = (STATE.ordersView && STATE.ordersView.length) ? STATE.ordersView : STATE.ordersAll;
  const groups = groupOrdersByBuyer(source);

  if (!groups.size) {
    setMsg("沒有可匯出的資料（請先載入訂單）", true);
    return;
  }

  // 為了輸出穩定：買家 ID 排序
  const buyers = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

  const chunks = buyers.map((buyerId) => buildBuyerSummaryText(buyerId, groups.get(buyerId)));
  const content = chunks.join("\n\n--------------------\n\n");

  const ymd = toDateInputValue(new Date());
  downloadTextFile(`buyer_summaries_${ymd}.txt`, content, "text/plain;charset=utf-8");
  setMsg(`已匯出 TXT（${buyers.length} 位買家）`);
}

/**
 * 功能說明：匯出 CSV（每個買家一列彙總）。
 * 欄位：buyer_id, order_count, total_amount, date_start, date_end
 */
function exportBuyerSummaryCsv() {
  pauseAutoRefresh();

  const source = (STATE.ordersView && STATE.ordersView.length) ? STATE.ordersView : STATE.ordersAll;
  const groups = groupOrdersByBuyer(source);

  if (!groups.size) {
    setMsg("沒有可匯出的資料（請先載入訂單）", true);
    return;
  }

  const rows = [];
  rows.push(["buyer_id", "order_count", "total_amount", "date_start", "date_end"].join(","));

  const buyers = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  for (const buyerId of buyers) {
    const orders = sortOrdersNewestFirst(groups.get(buyerId));
    const count = orders.length;
    const total = orders.reduce((acc, o) => acc + (Number(o?.amount ?? 0) || 0), 0);

    // date range
    const dates = orders.map((o) => parseOrderTime(o)).filter((d) => d && !isNaN(d.getTime()));
    const onlyDates = dates.map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
    const minT = onlyDates.length ? Math.min(...onlyDates) : null;
    const maxT = onlyDates.length ? Math.max(...onlyDates) : null;
    const dateStart = minT != null ? dateOnlyStrFromDate(new Date(minT)) : "";
    const dateEnd = maxT != null ? dateOnlyStrFromDate(new Date(maxT)) : "";

    // CSV escape: 只要有逗號/引號/換行就用雙引號包，內部引號要 double
    const safeBuyer = /[,"\n]/.test(buyerId) ? `"${buyerId.replaceAll('"', '""')}"` : buyerId;

    rows.push([safeBuyer, String(count), String(total), dateStart, dateEnd].join(","));
  }

  const content = "\uFEFF" + rows.join("\n"); // BOM：Excel 開中文不會亂碼
  const ymd = toDateInputValue(new Date());
  downloadTextFile(`buyer_summary_${ymd}.csv`, content, "text/csv;charset=utf-8");
  setMsg(`已匯出 CSV（${buyers.length} 位買家）`);
}


/**
 * 功能說明：開啟買家明細 modal，並套用預設日期範圍。
 */
function openUserModal(username) {
  STATE.currentUser = (username || "").trim();
  if (!STATE.currentUser) return;

  const mask = $("userModalMask");
  if (mask) mask.style.display = "block";

  const days = STATE.lastRangeDays || 7;
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);

  if ($("filterStartDate")) $("filterStartDate").value = toDateInputValue(start);
  if ($("filterEndDate")) $("filterEndDate").value = toDateInputValue(end);

  updateUserModalTitle();
  validateDateRange();
  applyUserFilter();
}

/**
 * 功能說明：關閉買家明細 modal 並清空狀態。
 */
function closeUserModal() {
  const mask = $("userModalMask");
  if (mask) mask.style.display = "none";

  STATE.currentUser = null;
  STATE.currentUserFiltered = [];
  STATE.currentUserTotal = 0;

  const wrap = $("userTableWrap");
  if (wrap) wrap.innerHTML = "";
  const sum = $("userSummary");
  if (sum) sum.textContent = "尚未篩選";
  const ta = $("copyText");
  if (ta) ta.value = "";

  updateUserModalTitle();
}

/* ========= 主刷新（後端分頁） ========= */
/**
 * 功能說明：重新載入「當前頁」訂單清單（/orders/paged）並刷新主列表顯示。
 * 注意：目前 query 固定 only_valid=0（讓舊/無效也可看），再由前端 listOnlyValid 控制顯示。
 */
async function refreshAll() {
  try {
    setMsg("載入訂單中…");    const p = STATE.pager;
    const res = await apiFetch(`/orders/paged?page=${p.page}&page_size=${p.pageSize}&only_valid=0`);
    const items = res?.items || [];

    // 更新分頁狀態（來自後端）
    STATE.pager.total = Number(res?.total ?? 0);
    STATE.pager.hasPrev = !!res?.has_prev;
    STATE.pager.hasNext = !!res?.has_next;

    // 映射欄位（前端統一命名）
    const mapped = (items || []).map((x) => {
      const printJobCount = Number(x.print_job_count ?? 0);
      const reprintCount = Math.max(0, isNaN(printJobCount) ? 0 : printJobCount - 1);

      return {
        id: x.live_comment_id,
        user: x.username,
        msg: x.raw_message,
        amount: Number(x.amount ?? 0),
        is_valid_order: !!x.is_valid_order,
        status: x.latest_print_status || "queued",
        error: x.latest_error,
        reprint_count: reprintCount,
        created_at: x.created_at || null,
        comment_ts: x.comment_ts ?? null,
      };
    });

    // 當前頁 raw data
    STATE.ordersAll = sortOrdersNewestFirst(mapped);

    // 套用前端篩選並渲染
    applyListDateFilter();
    setMsg("資料已更新");
  } catch (e) {
    setMsg(`抓單失敗：${e.message}`, true);
    const stream = $("stream");
    if (stream) stream.innerHTML = "<div class='hint warn'>尚未載入資料</div>";
  }
}

/* ========= Auto refresh ========= */
let PAUSE_UNTIL_MS = 0;
let REFRESH_IN_FLIGHT = false;
const USER_PAUSE_MS = 8000;

/**
 * 功能說明：取得目前時間（毫秒）。
 */
function nowMs() {
  return Date.now();
}

/**
 * 功能說明：暫停自動刷新一段時間（避免使用者操作時被刷新干擾）。
 */
function pauseAutoRefresh() {
  PAUSE_UNTIL_MS = Math.max(PAUSE_UNTIL_MS, nowMs() + USER_PAUSE_MS);
}

/**
 * 功能說明：判斷是否有 modal 開啟中（避免自動刷新）。
 */
function isUserBusy() {
  const masks = [
    "userModalMask",
        "demoMask",
    "listDateMask",
    "orderMask",
    "editMask",
    "deleteMask",
    "reprintMask",
  ];
  for (const id of masks) {
    const el = $(id);
    if (el && el.style.display && el.style.display !== "none") return true;
  }
  return false;
}

/**
 * 功能說明：判斷目前是否可自動刷新（開關/忙碌/節流/避免重入）。
 */
function canAutoRefresh() {
  if (!$("autoRefresh") || !$("autoRefresh").checked) return false;
  if (REFRESH_IN_FLIGHT) return false;
  if (isUserBusy()) return false;
  if (nowMs() < PAUSE_UNTIL_MS) return false;
  return true;
}

/**
 * 功能說明：安全執行自動刷新（避免重入，並保留捲動位置）。
 */
async function safeAutoRefresh() {
  if (!canAutoRefresh()) return;
  REFRESH_IN_FLIGHT = true;
  const y = window.scrollY;
  try {
    await refreshAll();
  } finally {
    window.scrollTo({ top: y, left: 0, behavior: "auto" });
    REFRESH_IN_FLIGHT = false;
  }
}

/* ========= 設定區收合/展開 ========= */
/**
 * 功能說明：切換設定區顯示/收合。
 */
function toggleSettings() {
  const panel = $("settingsPanel");
  const btn = $("btnToggleSettings");
  if (!panel) return;

  const isCollapsed = panel.classList.contains("collapsed");
  if (isCollapsed) {
    panel.classList.remove("collapsed");
    panel.classList.add("manual-open");
    if (btn) btn.textContent = "收合";
  } else {
    panel.classList.add("collapsed");
    panel.classList.remove("manual-open");
    if (btn) btn.textContent = "展開";
  }
}

/* ========= 手機：保持收合按鈕，預設收合設定區 ========= */
/**
 * 功能說明：手機版 UI 初始調整（預設收合設定區、隱藏桌機元素）。
 */
function applyMobileLayout() {
  if (!isMobileUI()) return;

  const hideIds = ["btnDemo", "testModeWrap"];
  hideIds.forEach((id) => {
    const el = $(id);
    if (el) el.style.display = "none";
  });

  const panel = $("settingsPanel");
  const btn = $("btnToggleSettings");
  if (panel && !panel.classList.contains("manual-open")) {
    panel.classList.add("collapsed");
    if (btn) btn.textContent = "展開";
  }
}

/* ========= 使用者 modal：按鈕 ========= */
/**
 * 功能說明：綁定使用者明細 modal 相關按鈕與日期事件。
 */
function bindUserModalEvents() {
  $("btnCloseUserModal")?.addEventListener("click", () => {
    pauseAutoRefresh();
    closeUserModal();
  });

  document.querySelectorAll("#userModalMask [data-pick]").forEach((b) => {
    b.addEventListener("click", () => {
      pauseAutoRefresh();
      const id = b.dataset.pick;
      const el = $(id);
      if (el) el.showPicker ? el.showPicker() : el.focus();
    });
  });

  $("filterStartDate")?.addEventListener("change", () => {
    pauseAutoRefresh();
    applyUserFilter();
  });
  $("filterEndDate")?.addEventListener("change", () => {
    pauseAutoRefresh();
    applyUserFilter();
  });

  $("btnQuick7d")?.addEventListener("click", () => {
    pauseAutoRefresh();
    saveLastRangeDays(7);
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400000);
    if ($("filterStartDate")) $("filterStartDate").value = toDateInputValue(start);
    if ($("filterEndDate")) $("filterEndDate").value = toDateInputValue(end);
    applyUserFilter();
  });

  $("btnQuick30d")?.addEventListener("click", () => {
    pauseAutoRefresh();
    saveLastRangeDays(30);
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    if ($("filterStartDate")) $("filterStartDate").value = toDateInputValue(start);
    if ($("filterEndDate")) $("filterEndDate").value = toDateInputValue(end);
    applyUserFilter();
  });

  $("btnApplyFilter")?.addEventListener("click", () => {
    pauseAutoRefresh();
    applyUserFilter();
  });

  $("btnSelectText")?.addEventListener("click", () => {
    pauseAutoRefresh();
    const ta = $("copyText");
    if (!ta) return;
    ta.focus();
    ta.select();
  });

  $("btnCopyText")?.addEventListener("click", async () => {
    pauseAutoRefresh();
    const ta = $("copyText");
    if (!ta) return;
    try {
      await navigator.clipboard.writeText(ta.value || "");
      setMsg("已複製明細");
    } catch {
      setMsg("複製失敗（可能瀏覽器權限限制）", true);
    }
  });
}


/* ========= 初始化 ========= */
document.addEventListener("DOMContentLoaded", () => {
  safeSetText("jsAlive", "JS LOADED");

  loadConfigFromLocal();
  loadLastRangeDays();
  loadListDateFilterFromLocal();
  loadListOnlyValidFromLocal();

  applyMobileLayout();

  // 設定區按鈕
  $("btnToggleSettings")?.addEventListener("click", () => {
    pauseAutoRefresh();
    toggleSettings();
  });
  $("btnSaveConfig")?.addEventListener("click", () => {
    pauseAutoRefresh();
    saveConfigToLocal(true);
  });
  $("btnRefresh")?.addEventListener("click", () => {
    pauseAutoRefresh();
    refreshAll();
  });

  // 展示版：Demo 假資料（不呼叫後端）
  $("btnDemo")?.addEventListener("click", () => {
    pauseAutoRefresh();
    try {
      const now = Date.now();
      const sample = [
        { order_id: "DEMO-001", username: "王小明", raw_message: "250+2 手圍14", amount: 250, is_valid_order: true, status: "queued", created_at: new Date(now-2*60000).toISOString() },
        { order_id: "DEMO-002", username: "陳美麗", raw_message: "199", amount: 199, is_valid_order: true, status: "printed", created_at: new Date(now-25*60000).toISOString() },
        { order_id: "DEMO-003", username: "測試帳號", raw_message: "0+N（無效示例）", amount: 0, is_valid_order: false, status: "ignored", created_at: new Date(now-60*60000).toISOString(), error: "示例：規則判定不成立" },
      ];
      // 對齊既有渲染欄位
      STATE.ordersAll = sortOrdersNewestFirst(sample.map(x => ({
        order_id: x.order_id,
        username: x.username,
        raw_message: x.raw_message,
        amount: x.amount,
        is_valid_order: x.is_valid_order,
        status: x.status,
        error: x.error,
        reprint_count: 0,
        created_at: x.created_at,
        comment_ts: null,
      })));
      applyListDateFilter();
      setMsg("已載入 Demo 假資料（展示版）");
    } catch (e) {
      setMsg(`Demo 載入失敗：${e.message}`, true);
    }
  });

    // 匯出：買家彙總 / 客服明細
  (function injectExportButtons(){
    const wrap = getListActionsWrap();
    if (!wrap) return;

    if (!$("btnExportBuyerTxt")) {
      const b1 = document.createElement("button");
      b1.id = "btnExportBuyerTxt";
      b1.type = "button";
      b1.className = "btn secondary";
      b1.textContent = "匯出買家明細TXT";
      b1.addEventListener("click", exportBuyerSummariesTxt);
      wrap.appendChild(b1);
    }

    if (!$("btnExportBuyerCsv")) {
      const b2 = document.createElement("button");
      b2.id = "btnExportBuyerCsv";
      b2.type = "button";
      b2.className = "btn secondary";
      b2.textContent = "匯出買家彙總CSV";
      b2.addEventListener("click", exportBuyerSummaryCsv);
      wrap.appendChild(b2);
    }
  })();
  // 主列表功能
  injectListFilterButton();
  injectListOnlyValidToggle();
  bindListEvents();

  // 使用者 modal
  bindUserModalEvents();

  // Auto refresh
  setInterval(safeAutoRefresh, 1500);
  // 首次載入：展示版不自動連後端
  const stream = $("stream");
  if (stream) stream.innerHTML = "<div class='hint'>尚未連線後端。可點「刷新」測試 API，或點「Demo 假資料」查看 UI 展示。</div>";
});
