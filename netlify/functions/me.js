// ============================================================
//  ME — trả trạng thái tài khoản cho frontend: gói, hạn, số lượt còn lại từng tính năng.
//  (Chỉ đọc, không trừ.) Dùng để hiển thị thanh người dùng + banner nhắc gia hạn.
//  Người trong allowlist -> trả plan="unlimited".
// ============================================================

import { getUserEmail, isAllowlisted, deny } from "./authlib.js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export default async (req) => {
  const u = await getUserEmail(req);
  if (u.error) return u.error;
  const email = u.email;

  // Allowlist -> không giới hạn
  if (await isAllowlisted(email)) {
    return json({ ok: true, email, plan: "unlimited", expires_at: null,
      ideas_left: null, para_left: null, score_left: null });
  }

  if (!SUPABASE_URL || !SERVICE_KEY)
    return json({ ok: true, email, plan: "free", expires_at: null, ideas_left: 0, para_left: 0, score_left: 0, configError: true });

  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/get_status", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY },
      body: JSON.stringify({ p_email: email }),
    });
    const s = await r.json().catch(() => ({}));
    return json({ ok: true, email, plan: s.plan || "free", expires_at: s.expires_at || null,
      ideas_left: s.ideas_left, para_left: s.para_left, score_left: s.score_left });
  } catch (e) {
    return json({ ok: true, email, plan: "free", expires_at: null });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
