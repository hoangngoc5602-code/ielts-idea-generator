// ============================================================
//  PayOS — WEBHOOK nhận thông tin thanh toán.
//  PayOS POST tới đây khi học viên trả tiền xong. Ta:
//   1) Xác thực CHỮ KÝ (HMAC_SHA256 trên object data với checksum key).
//   2) Tra đơn (orders) theo orderCode -> biết email + gói.
//   3) Kích hoạt gói (activate_subscription) + đánh dấu đơn 'paid' (chống cộng dồn 2 lần).
//  LUÔN trả 200 để PayOS biết đã nhận (kể cả khi bỏ qua) -> tránh gửi lại liên tục.
//
//  ĐĂNG KÝ: dán URL function này vào my.payos.vn (Kênh thanh toán -> Webhook):
//    https://<tên-site>.netlify.app/.netlify/functions/payos-webhook
// ============================================================

import crypto from "node:crypto";

const CHECKSUM = process.env.PAYOS_CHECKSUM_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function ok(obj) {
  return new Response(JSON.stringify(obj || { success: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

// Chuỗi ký từ object data (payment-requests): sort key alphabet, "key=value&...",
// null/undefined -> "", object/array -> JSON. KHÔNG encode (theo chuẩn payment-requests của PayOS).
function buildDataString(data) {
  return Object.keys(data).sort().map((k) => {
    let v = data[k];
    if (v === null || v === undefined) v = "";
    else if (typeof v === "object") v = JSON.stringify(v);
    return k + "=" + v;
  }).join("&");
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch (e) { return ok({ success: false }); }

  const data = body && body.data;
  const sig = body && body.signature;
  if (!data || !sig || !CHECKSUM) return ok({ success: true }); // không đủ dữ liệu -> ack, bỏ qua

  // 1) Xác thực chữ ký
  const expected = crypto.createHmac("sha256", CHECKSUM).update(buildDataString(data)).digest("hex");
  if (expected !== sig) return ok({ success: true }); // chữ ký sai -> bỏ qua (vẫn ack)

  // 2) Chỉ xử lý khi thanh toán thành công
  const paid = body.success === true || data.code === "00";
  const orderCode = data.orderCode;
  if (!paid || !orderCode || !SUPABASE_URL || !SERVICE_KEY) return ok({ success: true });

  try {
    const hdr = { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY };
    // Tra đơn
    const q = await fetch(
      SUPABASE_URL + "/rest/v1/orders?order_code=eq." + orderCode + "&select=email,plan,kind,feature,qty,amount_vnd,status",
      { headers: hdr }
    );
    const rows = await q.json().catch(() => []);
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order) return ok({ success: true });               // đơn lạ (vd webhook test) -> bỏ qua
    if (order.status === "paid") return ok({ success: true }); // đã xử lý -> tránh cộng dồn 2 lần

    const jhdr = { ...hdr, "Content-Type": "application/json" };
    const amt = order.amount_vnd || data.amount || 0;
    if (order.kind === "credits") {
      // 3a) MUA LẺ: cộng lượt + ghi doanh thu
      await fetch(SUPABASE_URL + "/rest/v1/rpc/add_credits", {
        method: "POST", headers: jhdr,
        body: JSON.stringify({ p_email: order.email, p_feature: order.feature, p_qty: order.qty }),
      });
      await fetch(SUPABASE_URL + "/rest/v1/payments", {
        method: "POST", headers: { ...jhdr, Prefer: "return=minimal" },
        body: JSON.stringify({ email: order.email, plan: (order.feature || "") + "/" + (order.qty || 0) + " luot", amount_vnd: amt, order_code: orderCode, raw: data }),
      });
    } else {
      // 3b) GÓI THÁNG: kích hoạt gói (hàm này tự ghi doanh thu)
      await fetch(SUPABASE_URL + "/rest/v1/rpc/activate_subscription", {
        method: "POST", headers: jhdr,
        body: JSON.stringify({ p_email: order.email, p_plan: order.plan, p_amount_vnd: amt, p_order_code: orderCode, p_raw: data }),
      });
    }
    // Đánh dấu đơn đã trả
    await fetch(SUPABASE_URL + "/rest/v1/orders?order_code=eq." + orderCode, {
      method: "PATCH",
      headers: { ...hdr, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "paid" }),
    });
  } catch (e) { /* nuốt lỗi, vẫn ack để PayOS không spam gửi lại */ }

  return ok({ success: true });
};
