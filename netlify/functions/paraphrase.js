// ============================================================
//  Công cụ PARAPHRASE / NÂNG CẤP CÂU (IELTS Writing Task 2).
//  Netlify Functions 2.0 + STREAMING. 2 LƯỢT ngắn + tự nối tiếp.
//  PHẦN 2: kiểm gói/quota (1 lần dùng = 1 lượt 'para', chỉ trừ ở lượt MỞ ĐẦU) + ghi cost thật (Sonnet).
// ============================================================

import { getUserEmail, isAllowlisted, useQuota, addCost, costMicroFromUsage, deny, quotaMessage } from "./authlib.js";

const MODEL = "claude-sonnet-4-6";
// Giá Sonnet 4.6 (micro-USD / token): in $3, cache write $3.75, cache read $0.30, out $15.
const RATES = { in: 3, cacheWrite: 3.75, cacheRead: 0.30, out: 15 };
const FEATURE = "para";

const SYSTEM_PROMPT = `Bạn là chuyên gia luyện IELTS Writing Task 2 cho học viên người Việt.
Học viên gửi một (vài) câu họ tự viết, kèm ĐỀ BÀI để bạn hiểu bối cảnh, và BAND MỤC TIÊU họ muốn.
Nhiệm vụ: VIẾT LẠI câu/đoạn đó sao cho đạt đúng band mục tiêu, rồi giải thích.

NGUYÊN TẮC:
- GIỮ ĐÚNG Ý ĐỊNH của học viên; bám sát bối cảnh ĐỀ BÀI (không lạc đề).
- Nếu câu gốc thiếu logic, thiếu ý, từ vựng/ngữ pháp yếu hoặc sai -> sửa và nâng cấp cho mạch lạc, thuyết phục.
- HIỆU CHỈNH ĐÚNG BAND MỤC TIÊU: dùng từ vựng, collocation, độ phức tạp ngữ pháp ĐẶC TRƯNG của band đó (không thấp hơn, cũng không "lố" quá band yêu cầu). Ví dụ Band 6.5 khác Band 8 về độ tinh tế.
- Tiếng Anh phải tự nhiên, chính xác.

ĐẦU RA (markdown; giải thích bằng TIẾNG VIỆT, bản viết lại bằng tiếng Anh; KHÔNG dùng bảng):
## Bản viết lại (mục tiêu Band X)
[câu/đoạn tiếng Anh đã viết lại — viết liền mạch, KHÔNG bọc {{ }} ở đây]

## Vì sao bản này đạt Band X — theo 4 tiêu chí
### Task Response (ý & lập luận)
[bản mới tốt hơn gì về ý/độ liên quan/độ thuyết phục so với bản gốc — cụ thể]
### Coherence & Cohesion (mạch lạc & liên kết)
[cải thiện gì về logic, liên từ, tham chiếu]
### Lexical Resource (từ vựng)
[từ/collocation band cao đã dùng; vì sao hợp band X]
### Grammatical Range & Accuracy (ngữ pháp)
[cấu trúc đã nâng cấp/sửa lỗi]

CÁCH TRÍCH CỤM (BẮT BUỘC — TUYỆT ĐỐI KHÔNG dùng ngoặc vuông [], ngoặc kép "" hay dấu *):
- BỌC cụm NGUYÊN VĂN của HỌC VIÊN (bản gốc / chỗ còn yếu) trong {{s:...}}  -> sẽ hiển thị màu ĐỎ.
- BỌC cụm MỚI / ĐÃ NÂNG CẤP trong bản viết lại của bạn trong {{n:...}}      -> sẽ hiển thị màu XANH.
- Ví dụ: {{s:make pollution}} → {{n:give rise to pollution}}; cấu trúc mới {{n:not only ... but also ...}}.

QUY TẮC TRÌNH BÀY (để dễ đọc):
- Với mỗi tiêu chí, dùng 2-3 GẠCH ĐẦU DÒNG ngắn (KHÔNG viết đoạn dài liền mạch). Mỗi gạch so sánh rõ TRƯỚC → SAU, có trích {{s:...}} (gốc) và {{n:...}} (mới) làm dẫn chứng.
- Cần GIẢI THÍCH CHI TIẾT HƠN thì thêm GẠCH ĐẦU DÒNG PHỤ: thụt vào 2 khoảng trắng rồi "- " (mỗi ý phụ một dòng) — sẽ hiển thị thành chấm tròn tím nhạt thụt vào.
- IN ĐẬM chỉ dùng cho NHÃN/kết luận quan trọng. KHÔNG dùng dấu * để trích cụm (chỉ dùng {{s:}}/{{n:}}).
- Không nói chung chung, không từ chối; luôn đưa ra bản viết lại và giải thích đầy đủ, dễ đọc.

VIẾT GỌN & HOÀN TẤT: mỗi tiêu chí 2-3 gạch đầu dòng chính (kèm vài ý phụ nếu cần), mỗi gạch 1-2 câu, đi thẳng vào ý.
XUẤT THEO TỪNG LƯỢT: chỉ xuất ĐÚNG các mục được liệt kê trong tin nhắn của lượt đó; KHÔNG lặp lại mục/đoạn đã có ở phần "ĐÃ XUẤT"; giữ NHẤT QUÁN với bản viết lại đã tạo (đúng một bản, không viết lại khác đi). Không thêm mở đầu/kết thừa.`;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // --- CỔNG (1): xác thực ---
  const u = await getUserEmail(req);
  if (u.error) return u.error;
  const email = u.email;

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return new Response("Chưa cấu hình ANTHROPIC_API_KEY trên Netlify.", { status: 500 });

  let text = "", prompt = "", targetBand = "", part = 1, prev = "", cont = false, partial = "";
  try {
    const body = await req.json();
    text = (body.text || "").toString().trim();
    prompt = (body.prompt || "").toString().trim();
    targetBand = (body.targetBand || "").toString().trim();
    part = parseInt(body.part, 10) || 1;
    prev = (body.prev || "").toString().slice(0, 6000);
    cont = body.cont === true || body.cont === "true";
    partial = (body.partial || "").toString().slice(0, 6000);
  } catch (e) {
    return new Response("Dữ liệu gửi lên không hợp lệ.", { status: 400 });
  }

  // 1 lần nâng cấp = nhiều lượt gọi. KIỂM quota ở lượt mở đầu (part 1); chỉ TRỪ ở lượt CUỐI (part 2)
  // khi đã hoàn thành -> lỗi giữa chừng KHÔNG bị trừ.
  const isStart = (part === 1 && !cont);
  const isFinal = (part === 2 && !cont);

  // --- CỔNG (2): gói/quota (bỏ qua nếu allowlisted) ---
  const allow = await isAllowlisted(email);
  if (!allow && isStart) {
    const c = await useQuota(email, FEATURE, false);
    if (c.reason === "config")
      return deny(500, "Hệ thống gói chưa cấu hình (thiếu SUPABASE_SERVICE_ROLE_KEY trên Netlify).");
    if (!c.allowed) return deny(402, quotaMessage(FEATURE, c));
  }

  if (!text) return new Response("Vui lòng nhập câu/đoạn bạn muốn nâng cấp.", { status: 400 });
  if (!targetBand) return new Response("Vui lòng chọn band điểm mong muốn.", { status: 400 });
  if (text.length > 4000) return new Response("Đoạn văn quá dài (tối đa ~4000 ký tự).", { status: 400 });

  const SECTIONS = {
    1: "LƯỢT 1/2 — CHỈ xuất các mục sau:\n" +
       "## Bản viết lại (mục tiêu Band " + targetBand + ")\n" +
       "[câu/đoạn tiếng Anh đã viết lại — ĐẦY ĐỦ]\n\n" +
       "## Vì sao bản này đạt Band " + targetBand + " — theo 4 tiêu chí\n" +
       "### Task Response (ý & lập luận)\n" +
       "### Coherence & Cohesion (mạch lạc & liên kết)\n" +
       "(mỗi tiêu chí 2-3 gạch đầu dòng theo khung TRƯỚC→SAU, trích {{s:...}} gốc / {{n:...}} mới)",
    2: "LƯỢT 2/2 — CHỈ xuất các mục sau (bám ĐÚNG bản viết lại ở 'ĐÃ XUẤT', KHÔNG lặp lại bản viết lại):\n" +
       "### Lexical Resource (từ vựng)\n" +
       "### Grammatical Range & Accuracy (ngữ pháp)\n" +
       "(mỗi tiêu chí 2-3 gạch đầu dòng; trích {{s:...}} gốc / {{n:...}} mới làm dẫn chứng)",
  };

  // Khối CỐ ĐỊNH (đề + band + câu HV) -> cache: lượt 2 đọc lại từ cache (rẻ + không tính rate limit).
  const fixedBlock =
    "ĐỀ BÀI (bối cảnh):\n" + (prompt || "(học viên không cung cấp đề — hãy suy luận bối cảnh hợp lý)") + "\n\n" +
    "BAND MỤC TIÊU: " + targetBand + "\n\n" +
    "CÂU/ĐOẠN CỦA HỌC VIÊN:\n" + text;

  const varBlock = cont
    ? ((prev ? ("BẢN VIẾT LẠI ĐÃ TẠO (bám đúng, KHÔNG lặp lại):\n" + prev + "\n\n") : "") +
       "MỤC ĐANG VIẾT bị NGẮT giữa chừng. Phần ĐÃ VIẾT của mục này:\n" + partial + "\n\n" +
       "Hãy VIẾT TIẾP NGAY TỪ CHỖ DỪNG để hoàn tất ĐÚNG mục đang dở: nối liền mạch, KHÔNG lặp lại chữ đã có, KHÔNG viết lại tiêu đề, KHÔNG quay lại mục trước, KHÔNG mở đầu/kết. Xong mục thì DỪNG.")
    : ((prev ? ("BẢN VIẾT LẠI ĐÃ TẠO (bám đúng, KHÔNG lặp lại):\n" + prev + "\n\n") : "") +
       (SECTIONS[part] || SECTIONS[1]) +
       "\n\nQUAN TRỌNG: Chỉ xuất ĐÚNG (các) mục của lượt này theo markdown rồi DỪNG. KHÔNG xuất sang mục/tiêu chí khác, KHÔNG viết lại bản viết lại nếu đã có ở 'ĐÃ XUẤT'.");

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1400,
      stream: true,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [
        { type: "text", text: fixedBlock, cache_control: { type: "ephemeral" } },
        { type: "text", text: varBlock },
      ] }],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let msg = "Lỗi khi gọi AI.";
    if (upstream.status === 401) msg = "API key không đúng. Kiểm tra ANTHROPIC_API_KEY trên Netlify.";
    else if (upstream.status === 429) msg = "Đang quá tải hoặc hết hạn mức. Thử lại sau ít phút.";
    return new Response(msg + (detail ? " " + detail.slice(0, 300) : ""), { status: 502 });
  }

  // Việc TRỪ lượt được dời vào trong stream, CHỈ thực hiện khi AI đã trả được nội dung
  // (xem streamAnthropicText) -> gọi AI lỗi/không trả gì thì học viên KHÔNG bị trừ lượt.
  return new Response(streamAnthropicText(upstream.body, { email, consume: (!allow && isFinal), isStart, isFinal }), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
};

function streamAnthropicText(upstreamBody, ctx) {
  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      let stopReason = "";
      let usage = null, outTokens = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]" || !data) continue;
            try {
              const evt = JSON.parse(data);
              if (evt.type === "content_block_delta" && evt.delta && evt.delta.type === "text_delta") {
                controller.enqueue(encoder.encode(evt.delta.text));
              } else if (evt.type === "message_start" && evt.message && evt.message.usage) {
                usage = Object.assign({}, evt.message.usage);
              } else if (evt.type === "message_delta") {
                if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
                if (evt.usage && typeof evt.usage.output_tokens === "number") outTokens = evt.usage.output_tokens;
              }
            } catch (e) { /* skip */ }
          }
        }
        if (stopReason === "end_turn") controller.enqueue(encoder.encode("[[[DONE]]]"));
      } catch (e) {
        controller.enqueue(new TextEncoder().encode("\n\n[Lỗi truyền dữ liệu: " + (e.message || e) + "]"));
      } finally {
        const produced = outTokens > 0;   // lượt gọi này có sinh nội dung không
        if (ctx && ctx.email && usage && produced) {
          usage.output_tokens = outTokens || usage.output_tokens || 0;
          try { await addCost(ctx.email, FEATURE, costMicroFromUsage(usage, RATES), ctx.isStart, ctx.isFinal); } catch (e) { /* bỏ qua */ }
        }
        // Trừ lượt CHỈ ở lượt CUỐI & khi đã có nội dung -> lỗi giữa chừng KHÔNG bị trừ.
        if (ctx && ctx.consume && produced) { try { await useQuota(ctx.email, FEATURE, true); } catch (e) { /* bỏ qua */ } }
        controller.close();
      }
    },
  });
}
