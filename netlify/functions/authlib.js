// ============================================================
//  CỔNG KIỂM QUYỀN DÙNG CHUNG (Giai đoạn 1 — chặn người chưa được phép).
//  3 function AI (generate-ideas / paraphrase / score) import requireAllowedUser(req)
//  và gọi nó TRƯỚC khi gọi Anthropic:
//   1) Xác thực "vé đăng nhập" (token Supabase) -> lấy email người dùng.
//   2) Đối chiếu email với DANH SÁCH CHO PHÉP đọc từ Google Sheet (cột email).
//  Hợp lệ  -> { ok:true, email }.
//  Không   -> { ok:false, response }  (function trả luôn response này, KHÔNG gọi AI -> không tốn tiền API).
//
//  BIẾN MÔI TRƯỜNG cần đặt trên Netlify (Site configuration -> Environment variables):
//    SUPABASE_URL             vd: https://abcdxyz.supabase.co
//    SUPABASE_ANON_KEY        khoá "anon public" của project Supabase
//    ALLOWLIST_SHEET_CSV_URL  link CSV của Google Sheet danh sách email cho phép
// ============================================================

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const ALLOWLIST_CSV_URL = process.env.ALLOWLIST_SHEET_CSV_URL || "";

// Cache danh sách email trong RAM của function (mỗi instance) ~60s,
// để không phải đọc Google Sheet lại ở mỗi lần gọi.
let _cache = { at: 0, set: null };
const CACHE_MS = 60 * 1000;

function deny(status, msg) {
  return {
    ok: false,
    response: new Response(msg, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }),
  };
}

// Lấy email từ token đăng nhập Supabase (gọi endpoint /auth/v1/user).
async function emailFromToken(token) {
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const u = await r.json();
    const email = ((u && (u.email || (u.user && u.user.email))) || "").toString().trim().toLowerCase();
    return email || null;
  } catch (e) {
    return null;
  }
}

// Đọc Google Sheet -> Set các email cho phép (đã hạ chữ thường).
// Quét MỌI ô trong sheet, ô nào trông giống email thì thêm vào -> không phụ thuộc
// vị trí cột hay dòng tiêu đề, rất dễ cho người dùng (gõ email vào đâu cũng nhận).
async function loadAllowSet() {
  const now = Date.now();
  if (_cache.set && now - _cache.at < CACHE_MS) return _cache.set;

  const set = new Set();
  try {
    const r = await fetch(ALLOWLIST_CSV_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (r.ok) {
      const rows = parseCSV(await r.text());
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const row of rows) {
        for (const cell of row) {
          const e = (cell || "").trim().toLowerCase();
          if (e && isEmail.test(e)) set.add(e);
        }
      }
    }
  } catch (e) {
    /* để set rỗng -> fail closed (an toàn: chặn hết nếu không đọc được sheet) */
  }
  _cache = { at: now, set };
  return set;
}

// Kiểm tra quyền. Trả { ok:true, email } hoặc { ok:false, response }.
export async function requireAllowedUser(req) {
  // 0) Chưa cấu hình đủ -> fail closed (chặn) để không vô tình mở cho mọi người.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
    return deny(500, "Chưa cấu hình đăng nhập trên Netlify (thiếu SUPABASE_URL / SUPABASE_ANON_KEY).");
  if (!ALLOWLIST_CSV_URL)
    return deny(500, "Chưa cấu hình danh sách cho phép trên Netlify (thiếu ALLOWLIST_SHEET_CSV_URL).");

  // 1) Lấy token từ header: Authorization: Bearer <token>
  const authHeader = req.headers.get("authorization") || "";
  const token = /^bearer\s+/i.test(authHeader) ? authHeader.replace(/^bearer\s+/i, "").trim() : "";
  if (!token) return deny(401, "Cậu cần đăng nhập để dùng công cụ này nha.");

  // 2) Xác thực token -> email
  const email = await emailFromToken(token);
  if (!email)
    return deny(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Cậu đăng nhập lại giúp tớ nhé.");

  // 3) Đối chiếu danh sách cho phép
  const allow = await loadAllowSet();
  if (!allow.has(email))
    return deny(
      403,
      "Tài khoản " + email + " chưa được cấp quyền dùng công cụ này. Liên hệ admin để được thêm vào danh sách nhé."
    );

  return { ok: true, email };
}

// CSV parser nhỏ — xử lý dấu ngoặc kép, dấu phẩy & xuống dòng trong ô (giống exam-questions.js).
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
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

// File này nằm trong thư mục functions nên Netlify cũng tạo một endpoint cho nó.
// Endpoint đó KHÔNG dùng tới -> trả 404 cho gọn (default export bắt buộc với Functions 2.0).
export default async () => new Response("Not found", { status: 404 });
