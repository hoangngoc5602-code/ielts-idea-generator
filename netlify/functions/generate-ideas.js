// ============================================================
//  "Máy chủ nhỏ" (serverless function) — chạy trên Netlify.
//  Nhiệm vụ: nhận chủ đề từ website -> gắn API key BÍ MẬT ->
//  gọi Claude -> trả ý tưởng song ngữ về cho website.
//
//  API key KHÔNG nằm trong file này. Bạn sẽ đặt nó trong
//  phần "Environment variables" của Netlify (xem HUONG-DAN.md).
// ============================================================

// >>> Muốn ý tưởng chất lượng cao hơn: dùng "claude-sonnet-4-6"
// >>> Muốn rẻ hơn (rẻ ~3 lần): dùng "claude-haiku-4-5-20251001"
const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are an expert IELTS Writing Task 2 coach for Vietnamese learners, aiming at Band 8.0+.
Given a topic (written in Vietnamese OR English), brainstorm EXACTLY 5 strong, distinct ideas a
student can use in an argumentative / discussion essay.

For EACH of the 5 ideas, produce these fields:

1) "idea_vi" — THE IDEA, in Vietnamese.
   - A SIMPLE sentence (one independent clause): short, general and direct.
   - It only introduces the point in relation to the topic (like an opening topic sentence).
   - It MUST contain the main keyword of the topic.
   - Example (topic "Lợi ích của robots"): "Robots giúp con người làm việc an toàn hơn."

2) "support_vi" — THE SUPPORTING IDEA, in Vietnamese.
   - EXACTLY ONE sentence, but a COMPLEX sentence: longer and more detailed than the idea,
     using sophisticated grammar (subordinate / relative / participle clauses).
   - It explains and develops the idea with a clear CAUSE -> EFFECT logic (use connectors such as
     "từ đó", "nhờ vậy", "do đó") so the later part follows from the earlier part, maximizing cohesion.
   - Example: "Robots được lập trình để vận hành hoàn toàn tự động mà không cần sự can thiệp của con
     người và được chế tạo từ những vật liệu bền hơn cơ thể người, từ đó chúng có thể làm việc trong
     môi trường hoá chất độc hại hay những nơi khắc nghiệt như đáy biển và ngoài không gian."

3) "idea_en" — the English version of idea_vi.
   - It MUST FAITHFULLY convey the SAME meaning as idea_vi (an accurate translation, NOT a different idea).
   - Band 8.0+: natural and accurate; keep it a clear, fairly simple topic sentence.

4) "support_en" — the English version of support_vi.
   - It MUST FAITHFULLY convey the SAME meaning as support_vi.
   - Band 8.0+: ONE complex sentence with sophisticated, varied grammar (relative clauses,
     participle clauses, cause-effect connectors such as "thereby", "which in turn", "as a result",
     "enabling ... to").

5) "vocab" — 3 to 5 high-band words / collocations.
   - CRITICAL: every item MUST be a word or phrase that ACTUALLY APPEARS, verbatim, inside idea_en
     or support_en of THIS idea. Do NOT invent vocabulary that is not used in those two sentences.
   - Each item: {"en": "the exact phrase as used", "vi": "nghĩa tiếng Việt ngắn gọn"}.
   - Choose the most useful Band 8+ lexis (prefer natural collocations and less common but correct words).

RULES ACROSS ALL 5 IDEAS:
- Every English sentence MUST stay faithful in meaning to its Vietnamese counterpart.
- Maximize paraphrasing: do NOT reuse the same vocabulary, collocations, or grammatical structures
  across different ideas or supporting ideas. Each of the 5 must showcase DIFFERENT lexis and
  DIFFERENT structures so the learner sees real variety.
- Keep all English idiomatic and accurate (no awkward or rare-for-the-sake-of-rare words).

Also provide:
- "topic_en", "topic_vi": the topic in BOTH languages.
- "essay_type": best-guess Task 2 type, in Vietnamese, e.g. "Nêu ý kiến (Opinion)",
  "Thảo luận hai quan điểm (Discussion)", "Lợi ích & hạn chế (Advantages/Disadvantages)",
  "Nguyên nhân & giải pháp (Problem/Solution)".

Output ONLY valid JSON (no markdown, no code fences, no commentary) with this exact shape:
{
  "topic_en": "string",
  "topic_vi": "string",
  "essay_type": "string",
  "ideas": [
    { "idea_vi": "string", "support_vi": "string", "idea_en": "string", "support_en": "string",
      "vocab": [ { "en": "string", "vi": "string" } ] }
  ]
}`;

exports.handler = async (event) => {
  // Chỉ chấp nhận phương thức POST
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return json(500, {
      error: "Chưa cấu hình ANTHROPIC_API_KEY trên Netlify. Xem bước 4 trong HUONG-DAN.md.",
    });
  }

  // Đọc chủ đề người dùng gửi lên
  let topic = "";
  try {
    const body = JSON.parse(event.body || "{}");
    topic = (body.topic || "").toString().trim();
  } catch (e) {
    return json(400, { error: "Dữ liệu gửi lên không hợp lệ." });
  }

  if (!topic) return json(400, { error: "Vui lòng nhập một chủ đề." });
  if (topic.length > 300) {
    return json(400, { error: "Chủ đề quá dài (tối đa 300 ký tự)." });
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: "Chủ đề / Topic: " + topic }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      // 401 = sai API key; 429 = hết hạn mức / quá nhiều request
      let friendly = "Lỗi khi gọi AI.";
      if (resp.status === 401) friendly = "API key không đúng. Kiểm tra lại ANTHROPIC_API_KEY trên Netlify.";
      else if (resp.status === 429) friendly = "Đang quá tải hoặc đã hết hạn mức. Thử lại sau ít phút.";
      return json(502, { error: friendly, status: resp.status, detail: detail.slice(0, 500) });
    }

    const data = await resp.json();
    let text = (data.content && data.content[0] && data.content[0].text) || "";

    // Bỏ code fence nếu model lỡ thêm vào
    text = text.trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "")
      .trim();

    try {
      const parsed = JSON.parse(text);
      return json(200, parsed);
    } catch (e) {
      // Dự phòng: nếu không phải JSON, trả văn bản thô để website vẫn hiển thị được
      return json(200, { raw: text });
    }
  } catch (e) {
    return json(500, { error: "Lỗi không xác định: " + (e.message || e) });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}
