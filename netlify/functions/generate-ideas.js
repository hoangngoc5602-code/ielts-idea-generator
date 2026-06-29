// ============================================================
//  Công cụ TÌM Ý TƯỞNG (IELTS Writing Task 2) — song ngữ.
//  Netlify Functions 2.0 + STREAMING. MỘT lần gọi -> JSON ý tưởng theo NHÓM (1 hoặc 2 hướng).
//  PHẦN 2: kiểm gói/quota (mỗi lần dùng = 1 lượt 'ideas') + ghi chi phí thật (Haiku).
// ============================================================

import { getUserEmail, isAllowlisted, useQuota, addCost, costMicroFromUsage, deny, quotaMessage } from "./authlib.js";

const MODEL = "claude-haiku-4-5-20251001";
// Giá Haiku 4.5 (micro-USD / token = USD / triệu token): in $1, cache write $1.25, cache read $0.10, out $5.
const RATES = { in: 1, cacheWrite: 1.25, cacheRead: 0.10, out: 5 };
const FEATURE = "ideas";

const SYSTEM_PROMPT = `Bạn là huấn luyện viên IELTS Writing Task 2 cho người Việt, nhắm Band 8.0+.
Người học nhập một CHỦ ĐỀ (tiếng Việt hoặc tiếng Anh). Hãy brainstorm ý tưởng song ngữ CHẤT LƯỢNG CAO.

BƯỚC 1 — XÁC ĐỊNH SỐ HƯỚNG cần triển khai:
- Nếu chủ đề chỉ MỘT hướng (vd "lợi ích của A", "nguyên nhân của B", một quan điểm) -> tạo 1 NHÓM gồm ĐÚNG 3 ý.
- Nếu là đề HAI PHẦN hoàn chỉnh (lợi ích & hạn chế; nguyên nhân & giải pháp; vấn đề & giải pháp;
  thảo luận hai quan điểm; agree/disagree có khai thác cả hai mặt) -> tạo 2 NHÓM, MỖI nhóm ĐÚNG 3 ý
  (vd 3 lợi ích + 3 hạn chế). Đặt nhãn hướng cho mỗi nhóm (side_vi + side_en).
- TỐI ĐA 2 NHÓM. Nếu đề có NHIỀU HƠN 2 hướng (vd vừa hỏi nguyên nhân, vừa hỏi tốt/xấu = 3 vế),
  CHỈ chọn 2 hướng QUAN TRỌNG NHẤT để triển khai; TUYỆT ĐỐI không tạo quá 2 nhóm (tránh output quá dài bị cắt).

BƯỚC 2 — MỖI Ý gồm 5 phần:
- "idea_vi": câu ĐƠN, ngắn gọn, chung chung, đi thẳng giới thiệu luận điểm; RÕ RÀNG thuộc về chủ đề.
- "support_vi": ĐÚNG MỘT câu PHỨC (KHÔNG tách thành 2 câu), nhưng phải GIẢI THÍCH SÂU & CỤ THỂ để đạt chuẩn Band 8.0+:
  nêu rõ CƠ CHẾ "vì sao" rồi dẫn tới KẾT QUẢ/HỆ QUẢ cụ thể theo logic NGUYÊN NHÂN -> KẾT QUẢ
  ("từ đó", "nhờ vậy", "do đó", "khiến cho"); BẮT BUỘC lồng MỘT chi tiết hoặc ví dụ cụ thể (đối tượng/bối cảnh/kết quả đo được)
  để luận điểm thuyết phục thay vì nói chung chung; dùng ngữ pháp cao cấp (mệnh đề quan hệ/phụ thuộc/phân từ).
- "idea_en" + "support_en": bản tiếng Anh phải SÁT NGHĨA và NGANG ĐỘ CHI TIẾT với bản Việt — KHÔNG thêm/bớt ý,
  KHÔNG đơn giản hoá; support_en cũng là MỘT câu phức ngữ pháp cao cấp (thereby, which in turn, as a result,
  enabling ... to, thus -ing). Tiếng Anh chuẩn Band 8.0+: tự nhiên, chính xác, KHÔNG dịch word-by-word.
- "vocab": 4-6 từ/cụm Band cao, BẮT BUỘC xuất hiện NGUYÊN VĂN trong idea_en/support_en của ý đó, kèm nghĩa Việt ngắn gọn.
  CHỈ chọn collocation/academic lexis trình độ Band 7.5-8+ (chính xác, tự nhiên, ít phổ thông);
  TUYỆT ĐỐI tránh từ cơ bản/chung chung ("important", "good", "many", "people", "very", "help"...).
  Ưu tiên CỤM (collocation) hơn từ đơn (vd "alleviate traffic congestion", "foster critical thinking").

VÍ DỤ MẪU (chủ đề "Lợi ích của robot" — học theo CHẤT LƯỢNG & ĐỘ KHỚP EN-VI này, KHÔNG chép lại):
- idea_vi: "Robot giúp con người làm việc an toàn hơn."
- support_vi: "Vì được lập trình để vận hành hoàn toàn tự động và chế tạo từ vật liệu siêu bền, robot có thể thay con người đảm nhận những tác vụ nguy hiểm như xử lý hoá chất độc hại hay sửa chữa dưới đáy biển, từ đó giảm mạnh số vụ tai nạn lao động."
- idea_en: "Robots help humans carry out their work far more safely."
- support_en: "Because they are programmed to operate fully autonomously and are built from highly durable materials, robots can take over hazardous tasks such as handling toxic chemicals or carrying out repairs on the seabed, thereby drastically reducing the number of workplace accidents."
- vocab: operate autonomously; highly durable materials; take over hazardous tasks; handle toxic chemicals; workplace accidents.

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
- Tối đa hoá paraphrase: KHÔNG lặp từ vựng, collocation hay cấu trúc ngữ pháp giữa các ý (kể cả giữa 2 nhóm).
- Mỗi ý là một LUẬN ĐIỂM KHÁC HẲN nhau (không trùng ý, không diễn đạt lại cùng một ý bằng từ khác).
- Tiếng Anh tự nhiên, chính xác (không dùng từ hiếm chỉ để cho "kêu").

TỰ KIỂM trước khi trả (BẮT BUỘC, không in phần kiểm tra ra ngoài):
1) Mỗi mục "vocab" có XUẤT HIỆN NGUYÊN VĂN trong idea_en/support_en không? Nếu không -> sửa lại.
2) support_vi & support_en có đúng MỘT câu phức, có đủ CƠ CHẾ + KẾT QUẢ + chi tiết cụ thể không?
3) EN và VI có khớp ý & ngang độ chi tiết không?
4) Các ý (và 2 nhóm) có bị lặp từ vựng/cấu trúc không? Nếu có -> đổi cho đa dạng.

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

  // --- CỔNG: xác thực + gói/quota ---
  const u = await getUserEmail(req);
  if (u.error) return u.error;
  const email = u.email;

  const allow = await isAllowlisted(email);              // allowlist = dùng free KHÔNG giới hạn
  if (!allow) {
    const c = await useQuota(email, FEATURE, false);     // chỉ KIỂM trước khi gọi AI
    if (c.reason === "config")
      return deny(500, "Hệ thống gói chưa cấu hình (thiếu SUPABASE_SERVICE_ROLE_KEY trên Netlify).");
    if (!c.allowed) return deny(402, quotaMessage(FEATURE, c));
  }

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
      max_tokens: 4096,
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

  // Việc TRỪ lượt được dời vào trong stream, CHỈ thực hiện khi AI đã trả được nội dung
  // (xem streamAnthropicText) -> gọi AI lỗi/không trả gì thì học viên KHÔNG bị trừ lượt.
  return new Response(streamAnthropicText(upstream.body, { email, consume: !allow }), {
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
      let usage = null, outTokens = 0, stopReason = "";
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
      } catch (e) {
        controller.enqueue(new TextEncoder().encode(" "));
      } finally {
        try {
          // CHỈ trừ lượt khi JSON sinh XONG trọn vẹn (end_turn). Bị cắt do đề nặng/đứt mạng -> JSON lỗi -> KHÔNG trừ.
          if (ctx && ctx.consume && stopReason === "end_turn") await useQuota(ctx.email, FEATURE, true);
        } catch (e) { /* bỏ qua */ }
        try {
          if (ctx && ctx.email && usage) {
            usage.output_tokens = outTokens || usage.output_tokens || 0;
            await addCost(ctx.email, FEATURE, costMicroFromUsage(usage, RATES));
          }
        } catch (e) { /* bỏ qua */ }
        controller.close();
      }
    },
  });
}
