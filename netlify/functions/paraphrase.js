// ============================================================
//  Công cụ PARAPHRASE / NÂNG CẤP CÂU (IELTS Writing Task 2).
//  Netlify Functions 2.0 + STREAMING.
//  Nhận: câu của học viên + đề bài (bối cảnh) + band mong muốn
//  -> viết lại đúng band đó + giải thích theo 4 tiêu chí.
// ============================================================

import { requireAllowedUser } from "./authlib.js";

// Sonnet cho chất lượng cao. Chia 2 LƯỢT NGẮN (frontend gọi 2 lần: lượt 1 = bản viết lại + TR + CC;
// lượt 2 = LR + GRA) để mỗi lượt xong gọn trong ~26s của Netlify -> không bị cắt giữa chừng.
const MODEL = "claude-sonnet-4-6";

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
[câu/đoạn tiếng Anh đã viết lại]

## Vì sao bản này đạt Band X — theo 4 tiêu chí
### Task Response (ý & lập luận)
[bản mới làm tốt hơn gì về ý/độ liên quan/độ thuyết phục so với bản gốc — cụ thể]
### Coherence & Cohesion (mạch lạc & liên kết)
[cải thiện gì về logic, liên từ, tham chiếu — trích dẫn cụ thể]
### Lexical Resource (từ vựng)
[từ/collocation band cao đã dùng, trích nguyên văn; vì sao hợp band X]
### Grammatical Range & Accuracy (ngữ pháp)
[cấu trúc đã nâng cấp/sửa lỗi, trích nguyên văn]

QUY TẮC TRÌNH BÀY (để dễ đọc): với mỗi tiêu chí, dùng 2-3 GẠCH ĐẦU DÒNG ngắn (KHÔNG viết đoạn dài liền mạch), IN ĐẬM thay đổi chính. Mỗi gạch đầu dòng so sánh rõ TRƯỚC (bản gốc yếu chỗ nào) → SAU (bản mới nâng thế nào) và TRÍCH nguyên văn từ/cụm/cấu trúc trong bản mới làm dẫn chứng. Không nói chung chung, không từ chối; luôn đưa ra bản viết lại và giải thích đầy đủ, dễ đọc.
VIẾT GỌN & HOÀN TẤT: mỗi tiêu chí tối đa 3 gạch đầu dòng, mỗi gạch 1-2 câu, đi thẳng vào ý.
XUẤT THEO TỪNG LƯỢT: chỉ xuất ĐÚNG các mục được liệt kê trong tin nhắn của lượt đó; KHÔNG lặp lại mục/đoạn đã có ở phần "ĐÃ XUẤT"; giữ NHẤT QUÁN với bản viết lại đã tạo (đúng một bản, không viết lại khác đi). Không thêm mở đầu/kết thừa.`;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // CỔNG: chỉ người đã đăng nhập & nằm trong danh sách cho phép mới được dùng (chặn TRƯỚC khi tốn API).
  const gate = await requireAllowedUser(req);
  if (!gate.ok) return gate.response;

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
    cont = body.cont === true || body.cont === "true";   // lượt VIẾT TIẾP phần đang dở
    partial = (body.partial || "").toString().slice(0, 6000);
  } catch (e) {
    return new Response("Dữ liệu gửi lên không hợp lệ.", { status: 400 });
  }
  if (!text) return new Response("Vui lòng nhập câu/đoạn bạn muốn nâng cấp.", { status: 400 });
  if (!targetBand) return new Response("Vui lòng chọn band điểm mong muốn.", { status: 400 });
  if (text.length > 4000) return new Response("Đoạn văn quá dài (tối đa ~4000 ký tự).", { status: 400 });

  // 2 LƯỢT NGẮN để không chạm giới hạn ~26s (Sonnet chậm hơn Haiku ~3 lần).
  const SECTIONS = {
    1: "LƯỢT 1/2 — CHỈ xuất các mục sau:\n" +
       "## Bản viết lại (mục tiêu Band " + targetBand + ")\n" +
       "[câu/đoạn tiếng Anh đã viết lại — ĐẦY ĐỦ]\n\n" +
       "## Vì sao bản này đạt Band " + targetBand + " — theo 4 tiêu chí\n" +
       "### Task Response (ý & lập luận)\n" +
       "### Coherence & Cohesion (mạch lạc & liên kết)\n" +
       "(mỗi tiêu chí 2-3 gạch đầu dòng theo khung TRƯỚC→SAU kèm trích dẫn)",
    2: "LƯỢT 2/2 — CHỈ xuất các mục sau (bám ĐÚNG bản viết lại ở 'ĐÃ XUẤT', KHÔNG lặp lại bản viết lại):\n" +
       "### Lexical Resource (từ vựng)\n" +
       "### Grammatical Range & Accuracy (ngữ pháp)\n" +
       "(mỗi tiêu chí 2-3 gạch đầu dòng; trích nguyên văn từ/cấu trúc trong bản viết lại)",
  };

  const base =
    "ĐỀ BÀI (bối cảnh):\n" + (prompt || "(học viên không cung cấp đề — hãy suy luận bối cảnh hợp lý)") + "\n\n" +
    "BAND MỤC TIÊU: " + targetBand + "\n\n" +
    "CÂU/ĐOẠN CỦA HỌC VIÊN:\n" + text + "\n\n" +
    (prev ? ("PHẦN ĐÃ XUẤT (giữ nhất quán, KHÔNG lặp lại):\n" + prev + "\n\n") : "");
  const userMsg = cont
    ? (base +
       "MỤC ĐANG VIẾT bị NGẮT giữa chừng. Phần ĐÃ VIẾT của mục này:\n" + partial + "\n\n" +
       "Hãy VIẾT TIẾP NGAY TỪ CHỖ DỪNG để hoàn tất ĐÚNG mục đang dở: nối liền mạch, KHÔNG lặp lại chữ đã có, KHÔNG viết lại tiêu đề, KHÔNG mở đầu/kết. Khi xong mục thì DỪNG.")
    : (base +
       (SECTIONS[part] || SECTIONS[1]) +
       "\n\nChỉ xuất đúng các mục trên (markdown), không thêm lời dẫn/kết.");

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1400,
      stream: true,
      // Prompt caching: phần system cố định -> cache để lượt 2 nhanh & rẻ hơn (tự bỏ qua nếu chưa bật).
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let msg = "Lỗi khi gọi AI.";
    if (upstream.status === 401) msg = "API key không đúng. Kiểm tra ANTHROPIC_API_KEY trên Netlify.";
    else if (upstream.status === 429) msg = "Đang quá tải hoặc hết hạn mức. Thử lại sau ít phút.";
    return new Response(msg + (detail ? " " + detail.slice(0, 300) : ""), { status: 502 });
  }

  return new Response(streamAnthropicText(upstream.body), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
};

function streamAnthropicText(upstreamBody) {
  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      let stopReason = "";
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
              } else if (evt.type === "message_delta" && evt.delta && evt.delta.stop_reason) {
                stopReason = evt.delta.stop_reason;
              }
            } catch (e) { /* skip */ }
          }
        }
        // Báo cho frontend: viết XONG (end_turn) hay bị cắt. Sentinel sẽ được frontend bóc bỏ.
        if (stopReason === "end_turn") controller.enqueue(encoder.encode("[[[DONE]]]"));
      } catch (e) {
        controller.enqueue(new TextEncoder().encode("\n\n[Lỗi truyền dữ liệu: " + (e.message || e) + "]"));
      } finally {
        controller.close();
      }
    },
  });
}
