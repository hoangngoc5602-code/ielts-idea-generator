// ============================================================
//  report.js — Netlify Function (CHỈ ĐỌC) cấp dữ liệu cho dashboard admin.
//   - Xác thực token Google (Supabase) của người gọi -> lấy email.
//   - CHỈ email trong ADMIN_EMAILS mới được xem (chống lộ số liệu/PII).
//   - Gọi RPC admin_report() bằng service_role (server-side) -> trả JSON.
//  Đặt file này ở: netlify/functions/report.js
//  Biến môi trường Netlify cần có (đa số đã có sẵn, chỉ THÊM ADMIN_EMAILS):
//    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS
//    ADMIN_EMAILS = email Google admin, nhiều email cách nhau bởi dấu phẩy.
// ============================================================

const URL     = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON    = process.env.SUPABASE_ANON_KEY || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMINS  = (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

const J = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export default async (req) => {
  try {
    if (!URL || !SERVICE) return J(500, { error: "Máy chủ thiếu cấu hình Supabase." });
    if (ADMINS.length === 0) return J(500, { error: "Chưa cấu hình ADMIN_EMAILS trong Netlify." });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return J(401, { error: "Chưa đăng nhập." });

    // 1) Xác thực token -> email
    const ures = await fetch(URL + "/auth/v1/user", {
      headers: { apikey: ANON || SERVICE, Authorization: "Bearer " + token },
    });
    if (!ures.ok) return J(401, { error: "Phiên đăng nhập không hợp lệ. Đăng nhập lại nhé." });
    const user = await ures.json().catch(() => ({}));
    const email = ((user && user.email) || "").toLowerCase();
    if (!email) return J(401, { error: "Không đọc được tài khoản." });

    // 2) Chặn quyền: chỉ admin
    if (!ADMINS.includes(email)) return J(403, { error: "Tài khoản " + email + " không có quyền xem báo cáo." });

    // 3) Lấy báo cáo (service_role gọi RPC)
    const r = await fetch(URL + "/rest/v1/rpc/admin_report", {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" },
      body: "{}",
    });
    const txt = await r.text();
    if (!r.ok) return J(502, { error: "Lỗi truy vấn báo cáo.", detail: txt });

    return new Response(txt, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return J(500, { error: "Lỗi máy chủ: " + (e && e.message || e) });
  }
};
