// ============================================================
//  Công cụ TÌM Ý TƯỞNG (IELTS Writing Task 2) — song ngữ.
//  Netlify Functions 2.0 + STREAMING (tránh timeout với đề 2 hướng).
//  Nhận: chủ đề -> trả JSON ý tưởng theo NHÓM (1 hoặc 2 hướng), stream về.
//  API key đọc từ biến môi trường ANTHROPIC_API_KEY.
// ============================================================

// Haiku: nhanh ~3 lần, đủ tốt cho dạng có cấu trúc + tránh bị timeout/cắt cụt.
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `Bạn là huấn luyện viên IELTS Writing Task 2 cho người Việt, nhắm Band 8.0+.
Người học nhập một CHỦ ĐỀ (tiếng Việt hoặc tiếng Anh). Hãy brainstorm ý tưởng song ngữ.

BƯỚC 1 — XÁC ĐỊNH SỐ HƯỚNG cần triển khai:
- Nếu chủ đề chỉ MỘT hướng (vd "lợi ích của A", "nguyên nhân của B", một quan điểm) -> tạo 1 NHÓM gồm ĐÚNG 3 ý.
- Nếu là đề HAI PHẦN hoàn chỉnh (lợi ích & hạn chế; nguyên nhân & giải pháp; vấn đề & giải pháp;
  thảo luận hai quan điểm; agree/disagree có khai thác cả hai mặt) -> tạo 2 NHÓM, MỖI nhóm ĐÚNG 3 ý
  (vd 3 lợi ích + 3 hạn chế). Đặt nhãn hướng cho mỗi nhóm (side_vi + side_en).

BƯỚC 2 — MỖI Ý gồm 5 phần:
- "idea_vi": câu ĐƠN, ngắn gọn, chung chung, đi thẳng giới thiệu luận điểm; RÕ RÀNG thuộc về chủ đề.
- "support_vi": MỘT câu PHỨC dài hơn, ngữ pháp cao cấp, theo logic NGUYÊN NHÂN -> KẾT QUẢ
  ("từ đó", "nhờ vậy", "do đó"), làm rõ cho idea.
- "idea_en" + "support_en": bản tiếng Anh SÁT NGHĨA bản Việt, Band 8.0+, tự nhiên, chính xác.
- "vocab": 3-5 từ/cụm Band cao XUẤT HIỆN NGUYÊN VĂN trong idea_en/support_en của ý đó, kèm nghĩa Việt ngắn gọn.

QUY TẮC TỪ KHOÁ (RẤT QUAN TRỌNG):
- TUYỆT ĐỐI KHÔNG lặp y nguyên cụm từ khoá của chủ đề ở mọi câu tiếng Anh.
- Hãy GIỮ ĐÚNG NÉT NGHĨA của từ khoá nhưng PARAPHRASE nó KHÁC NHAU ở mỗi ý, dùng từ vựng đa dạng để
  người học học thêm nhiều cách diễn đạt.
  Ví dụ chủ đề "working from home": ý 1 dùng "working from home", ý 2 "remote work",
  ý 3 "the remote working model" / "telecommuting" / "working remotely"...
- Mỗi ý nên dùng MỘT cách diễn đạt khác nhau cho từ khoá (đồng nghĩa/diễn giải), không trùng nhau.

QUY TẮC CHUNG:
- Tối đa hoá paraphrase: không lặp từ vựng, collocation hay cấu trúc ngữ pháp giữa các ý.
- Tiếng Anh tự nhiên, chính xác (không dùng từ hiếm chỉ để cho "kêu").

Cũng cung cấp: "topic_en", "topic_vi", "essay_type" (đoán dạng bài Task 2, ghi tiếng Việt).

CHỈ trả về JSON THUẦN (không markdown, không code fence, không lời dẫn), đúng cấu trúc:
{
  "topic_en":"string","topic_vi":"string","essay_type":"string",
  "groups":[
    {
      "side_vi":"nhãn hướng tiếng Việt, vd Lợi ích (để CHUỖI RỖNG nếu chỉ 1 hướng chung)",
      "side_en":"nhãn hướng tiếng Anh, vd Advantages (rỗng nếu không có)",
      "ideas":[
        {"idea_vi":"string","support_vi":"string","idea_en":"string","support_en":"string","vocab":[{"en":"string","vi":"string"}]}
      ]
    }
  ]
}`;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return new Response("Chưa cấu hình ANTHROPIC_API_KEY trên Netlify.", { status: 500 });

  let topic = "";
  try { topic = ((await req.json()).topic || "").toString().trim(); }
  catch (e) { return new Response("Dữ liệu gửi lên không hợp lệ.", { status: 400 }); }
  if (!topic) return new Response("Vui lòng nhập một chủ đề.", { status: 400 });
  if (topic.length > 600) return new Response("Chủ đề/đề bài quá dài (tối đa ~600 ký tự).", { status: 400 });

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3500,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: "Chủ đề / Đề bài: " + topic }],
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
              }
            } catch (e) { /* skip */ }
          }
        }
      } catch (e) {
        controller.enqueue(new TextEncoder().encode(" "));
      } finally {
        controller.close();
      }
    },
  });
}
