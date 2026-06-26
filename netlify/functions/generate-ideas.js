// ============================================================
//  Công cụ TÌM Ý TƯỞNG (IELTS Writing Task 2) — song ngữ.
//  Netlify Functions 2.0 + STREAMING (tránh timeout với đề 2 hướng).
//  Nhận: chủ đề -> trả JSON ý tưởng theo NHÓM (1 hoặc 2 hướng), stream về.
//  API key đọc từ biến môi trường ANTHROPIC_API_KEY.
// ============================================================

// Sonnet cho chất lượng cao. Chia theo HƯỚNG để không bị cắt: đề 1 hướng = 1 lượt;
// đề 2 phần = 2 lượt (mỗi lượt 1 nhóm 3 ý). Mỗi lượt đủ ngắn để xong trong ~26s của Netlify.
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `Bạn là huấn luyện viên IELTS Writing Task 2 cho người Việt, nhắm Band 8.0+.
Người học nhập một CHỦ ĐỀ (tiếng Việt hoặc tiếng Anh). Hãy brainstorm ý tưởng song ngữ.

BƯỚC 1 — XÁC ĐỊNH SỐ HƯỚNG của đề:
- Đề MỘT hướng (vd "lợi ích của A", "nguyên nhân của B", một quan điểm) -> total_groups = 1; nhóm để side_vi/side_en RỖNG.
- Đề HAI PHẦN hoàn chỉnh (lợi ích & hạn chế; nguyên nhân & giải pháp; vấn đề & giải pháp;
  thảo luận hai quan điểm; agree/disagree khai thác cả hai mặt) -> total_groups = 2; có 2 nhóm,
  MỖI nhóm ĐÚNG 3 ý, đặt nhãn hướng (side_vi + side_en) cho từng nhóm (vd 3 lợi ích + 3 hạn chế).

CHIA LƯỢT (QUAN TRỌNG — để output không bị cắt):
- Mỗi lần gọi CHỈ trả ĐÚNG MỘT nhóm trong "groups".
- LƯỢT 1: trả "total_groups" (1 hoặc 2) + "topic_en/topic_vi/essay_type" + NHÓM THỨ NHẤT (đủ 3 ý).
- LƯỢT 2 (chỉ khi đề 2 phần): trả NHÓM THỨ HAI (đủ 3 ý). Tin nhắn kèm "ĐÃ TẠO" là nhóm 1 ->
  TUYỆT ĐỐI KHÔNG lặp lại từ vựng/collocation/cấu trúc đã dùng ở nhóm 1.

BƯỚC 2 — MỖI Ý gồm 5 phần:
- "idea_vi": câu ĐƠN, ngắn gọn, chung chung, đi thẳng giới thiệu luận điểm; RÕ RÀNG thuộc về chủ đề.
- "support_vi": ĐÚNG MỘT câu PHỨC (KHÔNG tách thành 2 câu), nhưng phải GIẢI THÍCH SÂU & CỤ THỂ để đạt chuẩn Band 8.0+:
  nêu rõ CƠ CHẾ "vì sao" rồi dẫn tới KẾT QUẢ/HỆ QUẢ cụ thể theo logic NGUYÊN NHÂN -> KẾT QUẢ
  ("từ đó", "nhờ vậy", "do đó", "khiến cho"); nên lồng MỘT chi tiết hoặc ví dụ cụ thể (đối tượng/bối cảnh/kết quả đo được)
  để luận điểm thuyết phục thay vì nói chung chung; dùng ngữ pháp cao cấp (mệnh đề quan hệ/phụ thuộc/phân từ).
- "idea_en" + "support_en": bản tiếng Anh phải SÁT NGHĨA và NGANG ĐỘ CHI TIẾT với bản Việt — KHÔNG thêm/bớt ý,
  KHÔNG đơn giản hoá; support_en cũng là MỘT câu phức ngữ pháp cao cấp (thereby, which in turn, as a result,
  enabling ... to, thus -ing). Band 8.0+, tự nhiên, chính xác.
- "vocab": 4-6 từ/cụm Band cao, BẮT BUỘC xuất hiện NGUYÊN VĂN trong idea_en/support_en của ý đó, kèm nghĩa Việt ngắn gọn.
  Ưu tiên collocation & academic lexis thật sự "đáng học" (chính xác, tự nhiên, ít phổ thông);
  TRÁNH từ cơ bản/chung chung (không liệt kê "important", "good", "many", "people"...). Trong khoảng 4-6, càng nhiều cụm hay càng tốt.

QUY TẮC TỪ KHOÁ (RẤT QUAN TRỌNG):
- TUYỆT ĐỐI KHÔNG lặp y nguyên cụm từ khoá của chủ đề ở mọi câu tiếng Anh.
- Hãy GIỮ ĐÚNG NÉT NGHĨA của từ khoá nhưng PARAPHRASE nó KHÁC NHAU ở mỗi ý, dùng từ vựng đa dạng để
  người học học thêm nhiều cách diễn đạt.
  Ví dụ chủ đề "working from home": ý 1 dùng "working from home", ý 2 "remote work",
  ý 3 "the remote working model" / "telecommuting" / "working remotely"...
- Mỗi ý nên dùng MỘT cách diễn đạt khác nhau cho từ khoá (đồng nghĩa/diễn giải), không trùng nhau.

QUY TẮC CHUNG:
- BÁM SÁT SONG NGỮ: idea_en phải khớp idea_vi, support_en phải khớp support_vi về cả Ý lẫn ĐỘ CHI TIẾT —
  người đọc đối chiếu hai bản phải thấy trùng khớp, không bản nào thừa/thiếu ý hay nông/sâu hơn bản kia.
- Tối đa hoá paraphrase: không lặp từ vựng, collocation hay cấu trúc ngữ pháp giữa các ý.
- Tiếng Anh tự nhiên, chính xác (không dùng từ hiếm chỉ để cho "kêu").

Cũng cung cấp: "topic_en", "topic_vi", "essay_type" (đoán dạng bài Task 2, ghi tiếng Việt).

CHỈ trả về JSON THUẦN (không markdown, không code fence, không lời dẫn), đúng cấu trúc:
{
  "total_groups":1,
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
}
(LƯỢT 2 có thể bỏ total_groups & topic_*; "groups" LUÔN chỉ chứa MỘT nhóm của lượt hiện tại.)`;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return new Response("Chưa cấu hình ANTHROPIC_API_KEY trên Netlify.", { status: 500 });

  let topic = "", part = 1, prev = "";
  try {
    const body = await req.json();
    topic = (body.topic || "").toString().trim();
    part = parseInt(body.part, 10) || 1;
    prev = (body.prev || "").toString().slice(0, 6000);
  } catch (e) { return new Response("Dữ liệu gửi lên không hợp lệ.", { status: 400 }); }
  if (!topic) return new Response("Vui lòng nhập một chủ đề.", { status: 400 });
  if (topic.length > 600) return new Response("Chủ đề/đề bài quá dài (tối đa ~600 ký tự).", { status: 400 });

  // Hướng dẫn từng lượt (chia theo hướng để JSON mỗi lượt nhỏ, không bị cắt).
  const SECTIONS = {
    1: "LƯỢT 1: Phân loại số hướng của đề. Trả \"total_groups\" (1 hoặc 2) + \"topic_en\"/\"topic_vi\"/\"essay_type\" + trong \"groups\" CHỈ NHÓM THỨ NHẤT (đủ 3 ý; side_vi/side_en rỗng nếu đề 1 hướng).",
    2: "LƯỢT 2: Đề này có 2 hướng. Trong \"groups\" CHỈ trả NHÓM THỨ HAI (đủ 3 ý, kèm side_vi/side_en). KHÔNG lặp lại từ vựng/cấu trúc của nhóm 1 ở 'ĐÃ TẠO'. Không cần trả lại topic/essay_type/total_groups.",
  };
  const userMsg =
    "Chủ đề / Đề bài: " + topic + "\n\n" +
    (prev ? ("ĐÃ TẠO (nhóm 1 — KHÔNG lặp lại từ vựng/cấu trúc):\n" + prev + "\n\n") : "") +
    (SECTIONS[part] || SECTIONS[1]) +
    "\n\nCHỈ trả JSON thuần đúng cấu trúc đã quy định (không markdown, không lời dẫn).";

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1800,
      stream: true,
      // Prompt caching: phần system (luật nội dung) cố định -> cache để lượt 2 nhanh & rẻ hơn (tự bỏ qua nếu chưa bật).
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
