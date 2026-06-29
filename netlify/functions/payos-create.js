// ============================================================
//  PayOS — TẠO LINK/QR THANH TOÁN theo gói (Standard / Pro).
//  Frontend (đã đăng nhập) gọi function này -> trả về qrCode + checkoutUrl để hiển thị.
//  Lưu "đơn chờ" vào Supabase (orders) để webhook biết ai trả & gói gì.
//
//  BIẾN MÔI TRƯỜNG (Netlify): PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY,
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. (Tuỳ chọn) SITE_URL nếu không lấy được origin.
// ============================================================

import crypto from "node:crypto";
import { getUserEmail, deny } from "./authlib.js";

const PAYOS_BASE = "https://api-merchant.payos.vn";
const CLIENT_ID = process.env.PAYOS_CLIENT_ID || "";
const API_KEY = process.env.PAYOS_API_KEY || "";
const CHECKSUM = process.env.PAYOS_CHECKSUM_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Giá gói tháng (VND) — quyết định ở SERVER, không tin số tiền từ client.
const PRICES = { standard: 99000, pro: 199000 };
// Bảng giá MUA LẺ theo lượt (VND). Server là nguồn giá chuẩn.
const PACKS = {
  score: { 5: 27500, 10: 50000, 20: 90000, 50: 200000, 100: 370000, 200: 700000 },
  para:  { 10: 25000, 20: 46000, 50: 100000, 100: 180000, 200: 320000, 500: 700000 },
};

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!CLIENT_ID || !API_KEY || !CHECKSUM)
    return deny(500, "Chưa cấu hình PayOS (PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY).");
  if (!SUPABASE_URL || !SERVICE_KEY)
    return deny(500, "Chưa cấu hình Supabase service key (SUPABASE_SERVICE_ROLE_KEY).");

  // Phải đăng nhập (để gắn đơn với email học viên)
  const u = await getUserEmail(req);
  if (u.error) return u.error;
  const email = u.email;

  let body;
  try { body = await req.json(); } catch (e) { return deny(400, "Dữ liệu không hợp lệ."); }
  const kind = (body.kind || "plan").toString();

  let amount, description, orderRow;
  if (kind === "credits") {
    // MUA LẺ theo lượt
    const feature = (body.feature || "").toString().trim().toLowerCase();
    const qty = parseInt(body.qty, 10) || 0;
    if (!PACKS[feature] || !PACKS[feature][qty]) return deny(400, "Gói lẻ không hợp lệ.");
    amount = PACKS[feature][qty];
    description = ((feature === "score" ? "Cham bai " : "Paraphrase ") + qty + " luot").slice(0, 25);
    orderRow = { email, kind: "credits", plan: "", feature, qty, amount_vnd: amount, status: "pending" };
  } else {
    // GÓI THÁNG
    const plan = (body.plan || "").toString().trim().toLowerCase();
    if (!PRICES[plan]) return deny(400, "Gói không hợp lệ (chỉ 'standard' hoặc 'pro').");
    amount = PRICES[plan];
    description = ("IELTS " + plan.toUpperCase()).slice(0, 25);
    orderRow = { email, kind: "plan", plan, amount_vnd: amount, status: "pending" };
  }

  const origin = ((req.headers.get("origin") || process.env.SITE_URL || "")).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(origin)) return deny(500, "Không xác định được địa chỉ web.");
  const returnUrl = origin + "/?pay=return";
  const cancelUrl = origin + "/?pay=cancel";
  const orderCode = Date.now(); // duy nhất theo mili-giây
  orderRow.order_code = orderCode;

  // Chữ ký: HMAC_SHA256 trên chuỗi 5 trường, ĐÚNG thứ tự alphabet (theo tài liệu PayOS).
  const sigData =
    "amount=" + amount +
    "&cancelUrl=" + cancelUrl +
    "&description=" + description +
    "&orderCode=" + orderCode +
    "&returnUrl=" + returnUrl;
  const signature = crypto.createHmac("sha256", CHECKSUM).update(sigData).digest("hex");

  // Lưu đơn chờ
  try {
    const ins = await fetch(SUPABASE_URL + "/rest/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, Prefer: "return=minimal",
      },
      body: JSON.stringify(orderRow),
    });
    if (!ins.ok) {
      const t = await ins.text().catch(() => "");
      return deny(500, "Không lưu được đơn hàng. " + t.slice(0, 200));
    }
  } catch (e) { return deny(500, "Lỗi lưu đơn hàng."); }

  // Gọi PayOS tạo link/QR
  let j = {};
  try {
    const r = await fetch(PAYOS_BASE + "/v2/payment-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-id": CLIENT_ID, "x-api-key": API_KEY },
      body: JSON.stringify({ orderCode, amount, description, cancelUrl, returnUrl, signature }),
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok || j.code !== "00" || !j.data)
      return deny(502, "PayOS báo lỗi: " + (j.desc || ("HTTP " + r.status)));
  } catch (e) { return deny(502, "Không gọi được PayOS."); }

  return new Response(JSON.stringify({
    ok: true,
    kind, amount, orderCode,
    qrCode: j.data.qrCode,            // chuỗi VietQR -> frontend vẽ thành mã QR
    checkoutUrl: j.data.checkoutUrl,  // hoặc mở trang thanh toán của PayOS
    bin: j.data.bin,
    accountNumber: j.data.accountNumber,
    accountName: j.data.accountName,
    description,
  }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
};
