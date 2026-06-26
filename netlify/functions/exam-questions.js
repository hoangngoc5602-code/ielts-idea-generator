// ============================================================
//  Nguồn ĐỀ THI THẬT — đọc từ Google Sheet (cập nhật hàng tuần).
//  Netlify Functions 2.0, trả JSON cho website.
//  Sheet cần ở chế độ chia sẻ "Bất kỳ ai có liên kết: Người xem".
//  Cột hiển thị: question (đề) + essay_type (dạng đề).
// ============================================================

// URL xuất CSV của sheet (dùng gviz để đọc server-side, không vướng CORS).
// Có thể override bằng biến môi trường EXAM_SHEET_CSV_URL trên Netlify.
const SHEET_CSV_URL =
  process.env.EXAM_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/12C-R51nZ4dWheAXWhAY7XRGG82jv6mnEnryTfIaAc2k/gviz/tq?tqx=out:csv&gid=794225480";

// Tên cột trong sheet (đổi tại đây nếu sau này bạn đổi tên cột)
const COL_QUESTION = "question";
const COL_TYPE = "essay_type";

export default async (req) => {
  try {
    const resp = await fetch(SHEET_CSV_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) {
      return json(200, {
        ok: false,
        error:
          "Không đọc được Google Sheet (mã " + resp.status + "). Hãy đặt sheet ở chế độ 'Bất kỳ ai có liên kết: Người xem'.",
      });
    }
    const text = await resp.text();
    const rows = parseCSV(text).filter((r) => r.some((c) => (c || "").trim() !== ""));
    if (!rows.length) return json(200, { ok: false, error: "Sheet trống." });

    const headers = rows[0].map((h) => (h || "").trim().toLowerCase());
    const qi = headers.indexOf(COL_QUESTION);
    const ti = headers.indexOf(COL_TYPE);
    if (qi === -1) {
      return json(200, {
        ok: false,
        error: "Không tìm thấy cột '" + COL_QUESTION + "' trong sheet. Cột hiện có: " + headers.join(", "),
      });
    }

    const items = [];
    const typesSet = new Set();
    for (let r = 1; r < rows.length; r++) {
      const question = (rows[r][qi] || "").trim();
      if (!question) continue;
      const essay_type = ti !== -1 ? (rows[r][ti] || "").trim() : "";
      if (essay_type) typesSet.add(essay_type);
      items.push({ question, essay_type });
    }

    // Đề mới nhất ở cuối sheet -> đảo để hiện mới trước
    items.reverse();

    return json(200, {
      ok: true,
      count: items.length,
      essayTypes: Array.from(typesSet).sort(),
      items,
    });
  } catch (e) {
    return json(200, { ok: false, error: "Lỗi khi tải đề: " + (e.message || e) });
  }
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

// CSV parser nhỏ, xử lý dấu ngoặc kép, dấu phẩy & xuống dòng trong ô.
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
