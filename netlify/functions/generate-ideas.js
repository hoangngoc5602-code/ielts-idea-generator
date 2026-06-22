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

const SYSTEM_PROMPT = `You are an expert IELTS Writing Task 2 coach for Vietnamese learners.
Given a topic (it may be written in Vietnamese OR English), brainstorm strong, exam-relevant ideas
the student can use in an argumentative / discussion essay.

Rules:
- Work for ANY Task 2 topic. Infer the most likely essay angle.
- Provide exactly 5 ideas (key points / arguments) that are varied and do NOT overlap.
- For EACH idea provide:
  - "idea_vi": the idea explained clearly in natural Vietnamese (1 sentence).
  - "idea_en": the SAME idea written as ONE polished, essay-ready English sentence at Band 7.0-8.0
     level (natural, accurate, not too long, no rare/obscure words).
  - "develop_vi": a short Vietnamese hint (1 sentence) on how to develop/support it
     (a reason, an example, or a consequence).
  - "vocab": 3-4 useful English words/collocations relevant to THIS idea, each as
     {"en": "...", "vi": "nghĩa tiếng Việt ngắn gọn"}. Prefer topic-specific collocations
     over basic vocabulary.
- "topic_en" and "topic_vi": give the topic in BOTH languages.
- "essay_type": best-guess Task 2 type, written in Vietnamese, e.g.
  "Nêu ý kiến (Opinion)", "Thảo luận hai quan điểm (Discussion)",
  "Lợi ích & hạn chế (Advantages/Disadvantages)", "Nguyên nhân & giải pháp (Problem/Solution)".

Output ONLY valid JSON (no markdown, no code fences, no commentary) with this exact shape:
{
  "topic_en": "string",
  "topic_vi": "string",
  "essay_type": "string",
  "ideas": [
    { "idea_vi": "string", "idea_en": "string", "develop_vi": "string",
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
        max_tokens: 3000,
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
