// ============================================================
//  CỔNG + QUOTA + COST (Phần 2) — dùng chung cho 3 function AI.
//  Luồng mỗi lần dùng:
//   1) getUserEmail(req)            -> xác thực token Supabase, lấy email.
//   2) isAllowlisted(email)         -> email trong Google Sheet "cho dùng free KHÔNG giới hạn" (cấp tay).
//   3) useQuota(email, feature, consume) -> RPC Supabase: kiểm (và trừ) lượt theo gói. (Bỏ qua nếu allowlisted.)
//   4) (sau khi gọi AI) addCost(...) -> cộng chi phí THẬT (từ token usage) vào học viên + ghi nhật ký.
//
//  BIẾN MÔI TRƯỜNG (Netlify):
//    SUPABASE_URL, SUPABASE_ANON_KEY            (đã có từ Giai đoạn 1)
//    SUPABASE_SERVICE_ROLE_KEY                  (MỚI — bí mật, chỉ ở server; để gọi RPC ghi dữ liệu)
//    ALLOWLIST_SHEET_CSV_URL                    (đã có)
//
//  GHI CHÚ: file này nằm trong thư mục functions nên Netlify cũng tạo 1 endpoint cho nó.
//  Endpoint đó không dùng -> default export trả 404.
// ============================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ALLOWLIST_CSV_URL = process.env.ALLOWLIST_SHEET_CSV_URL || "";

const LABELS = { ideas: "Tìm ý tưởng", para: "Paraphrase", score: "Chấm điểm" };

export function deny(status, msg) {
  return new Response(msg, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ---- 1) Xác thực token -> email ----
export async function getUserEmail(req) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
    return { error: deny(500, "Chưa cấu hình đăng nhập (SUPABASE_URL / SUPABASE_ANON_KEY).") };
  const auth = req.headers.get("authorization") || "";
  const token = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : "";
  if (!token) return { error: deny(401, "Cậu cần đăng nhập để dùng công cụ này nha.") };
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return { error: deny(401, "Phiên đăng nhập đã hết hạn. Cậu đăng nhập lại nhé.") };
    const u = await r.json();
    const email = ((u && (u.email || (u.user && u.user.email))) || "").toString().trim().toLowerCase();
    if (!email) return { error: deny(401, "Không lấy được email từ tài khoản. Đăng nhập lại nhé.") };
    return { email };
  } catch (e) {
    return { error: deny(401, "Lỗi xác thực đăng nhập, thử lại nhé.") };
  }
}

// ---- 2) Allowlist (Google Sheet, cấp tay free không giới hạn) — có cache 60s ----
let _cache = { at: 0, set: null };
const CACHE_MS = 60 * 1000;
async function allowSet() {
  const now = Date.now();
  if (_cache.set && now - _cache.at < CACHE_MS) return _cache.set;
  const set = new Set();
  if (ALLOWLIST_CSV_URL) {
    try {
      const r = await fetch(ALLOWLIST_CSV_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) {
        const rows = parseCSV(await r.text());
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        for (const row of rows) for (const cell of row) {
          const e = (cell || "").trim().toLowerCase();
          if (e && isEmail.test(e)) set.add(e);
        }
      }
    } catch (e) { /* fail-safe: set rỗng */ }
  }
  _cache = { at: now, set };
  return set;
}
export async function isAllowlisted(email) {
  return (await allowSet()).has(email);
}

// ---- 3) Quota qua RPC Supabase (service_role) ----
async function rpc(name, args) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
    },
    body: JSON.stringify(args),
  });
  return r;
}

// consume=false: chỉ KIỂM (để chặn sớm khi hết lượt). consume=true: TRỪ 1 lượt (gọi sau khi chắc chắn dùng).
export async function useQuota(email, feature, consume) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { allowed: false, reason: "config" };
  try {
    const r = await rpc("use_quota", { p_email: email, p_feature: feature, p_consume: !!consume });
    if (!r.ok) return { allowed: false, reason: "rpc_error" };
    return await r.json(); // { allowed, plan, remaining, reason }
  } catch (e) {
    return { allowed: false, reason: "exception" };
  }
}

// ---- 4) Ghi chi phí thật (best-effort, không làm hỏng luồng nếu lỗi) ----
export async function addCost(email, feature, costMicro) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !costMicro || costMicro <= 0) return;
  try {
    await rpc("add_cost", { p_email: email, p_feature: feature, p_cost_micro: Math.round(costMicro) });
  } catch (e) { /* bỏ qua */ }
}

// Tính chi phí (micro-USD) từ token usage. rates tính theo micro-USD / 1 token (= USD/triệu token).
export function costMicroFromUsage(usage, rates) {
  if (!usage) return 0;
  const i = usage.input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const o = usage.output_tokens || 0;
  return i * rates.in + cw * rates.cacheWrite + cr * rates.cacheRead + o * rates.out;
}

// Thông báo khi hết lượt (frontend hiển thị, status 402).
export function quotaMessage(feature, info) {
  const label = LABELS[feature] || "công cụ này";
  const plan = (info && info.plan) || "free";
  if (feature === "ideas")
    return "Bạn đã hết lượt " + label + " hôm nay (gói " + plan + "). Quay lại ngày mai, hoặc nâng gói để dùng nhiều hơn nhé.";
  return "Bạn đã dùng hết lượt " + label + " của gói " + plan + " trong kỳ này. Nâng gói hoặc gia hạn để tiếp tục nhé.";
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++; continue;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export default async () => new Response("Not found", { status: 404 });
