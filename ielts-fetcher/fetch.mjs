// ============================================================
//  IELTS Exam Question Fetcher
//  GitHub Actions chạy mỗi thứ Hai — fetch 11 nguồn IELTS,
//  dùng Claude Haiku extract đề Writing Task 2,
//  ghi vào Google Sheet qua Apps Script Web App.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

// ── CONFIG: 11 nguồn ────────────────────────────────────────
// ⚠ Các URL có chú thích "Verify" → bạn cần mở trang đó,
//   kiểm tra URL thật chứa đề thi, rồi cập nhật vào đây.
const SOURCES = [
  // ─── QUỐC TẾ (blog tĩnh, fetch thẳng OK) ─────────────────
  {
    name: "IELTS Simon",
    url: "https://www.ielts-simon.com/ielts-help-and-english-pro/task-2-essays/",
  },
  {
    name: "Laokaoya",
    // Trang tổng hợp đáp án sau mỗi kỳ thi — có Task 2 topic
    url: "https://www.laokaoya.com/category/tests",
  },
  {
    name: "IELTS Advantage",
    url: "https://www.ieltsadvantage.com/writing-task-2/",
  },
  {
    name: "IELTS Bro",
    url: "https://ieltsbro.com/ielts-writing-task-2/", // ⚠ Verify
  },

  // ─── VIỆT NAM (server-rendered, fetch thẳng OK) ──────────
  {
    name: "ZIM",
    url: "https://zim.vn/de-thi-ielts-writing-2026", // ✅ Confirmed
  },
  {
    name: "Vietop",
    url: "https://vietop.edu.vn/blog/tong-hop-de-thi-ielts-writing-2025/", // ✅ Confirmed
  },
  {
    name: "The IELTS Workshop",
    url: "https://theieltsworkshop.vn/de-thi-ielts-writing/", // ⚠ Verify
  },
  {
    name: "IELTS Fighter",
    url: "https://ieltsfighter.com.vn/de-thi-ielts/", // ⚠ Verify
  },
  {
    name: "STUDY4",
    url: "https://study4.vn/bai-viet/de-thi-ielts-writing/", // ⚠ Verify
  },
  {
    name: "TalkFirst",
    url: "https://talkfirst.vn/de-thi-ielts/", // ⚠ Verify
  },
  {
    name: "IELTS CITY",
    url: "https://ieltscity.vn/de-thi-ielts-writing/", // ⚠ Verify
  },
];

// ── Dùng Haiku — đủ cho extraction, rẻ hơn Sonnet 6x ───────
const MODEL = "claude-haiku-4-5-20251001";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SHEET_WEBAPP_URL  = process.env.SHEET_WEBAPP_URL;

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

/** Fetch URL, strip HTML → plain text (max 8000 ký tự) */
async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; IELTS-Idea-Generator/1.0; +https://ielts-idea-generator.netlify.app)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{3,}/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .trim();

  return text.slice(0, 8000);
}

/** Dùng Claude Haiku để extract danh sách đề Task 2 từ text */
async function extractQuestions(pageText, sourceName) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `Source: ${sourceName}

Extract all IELTS Writing Task 2 exam questions from the text below.
Return ONLY valid JSON array (no explanation, no markdown fence), each item:
{
  "question": "full Task 2 question prompt in English",
  "date": "YYYY-MM or YYYY-MM-DD if mentioned, else null",
  "essay_type": "Opinion" | "Discussion" | "Advantages-Disadvantages" | "Problem-Solution" | "Two-part question" | "Unknown"
}

Rules:
- Only include real exam questions, NOT practice prompts, grammar tips, vocabulary articles.
- If source is Vietnamese or Chinese, translate the question to English.
- If no Task 2 questions found on the page, return: []

Text:
${pageText}`,
      },
    ],
  });

  const raw = (resp.content[0]?.text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "");

  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    console.warn(`  ⚠ JSON parse failed — raw: ${raw.slice(0, 200)}`);
    return [];
  }
}

/** Gửi questions lên Google Sheet qua Apps Script Web App */
async function sendToSheet(questions, sourceName) {
  if (!SHEET_WEBAPP_URL) {
    console.log("  ℹ SHEET_WEBAPP_URL chưa set — bỏ qua ghi Sheet");
    return 0;
  }

  const res = await fetch(SHEET_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: sourceName, questions }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Sheet write failed: HTTP ${res.status}`);

  const result = await res.json();
  return result.added ?? 0;
}

// ────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────
async function main() {
  if (!ANTHROPIC_API_KEY) {
    console.error("Thieu ANTHROPIC_API_KEY");
    process.exit(1);
  }

  console.log(`\nIELTS Exam Fetcher — ${new Date().toISOString()}\n`);

  const results = [];

  for (const source of SOURCES) {
    console.log(`\n[${source.name}]`);
    console.log(`  ${source.url}`);

    try {
      const text = await fetchText(source.url);
      console.log(`  HTML -> ${text.length} ky tu`);

      const questions = await extractQuestions(text, source.name);
      console.log(`  Claude extract: ${questions.length} cau hoi`);

      let added = 0;
      if (questions.length > 0) {
        added = await sendToSheet(questions, source.name);
        console.log(`  Sheet: them moi ${added}`);
      }

      results.push({ source: source.name, found: questions.length, added });
    } catch (err) {
      console.error(`  LOI: ${err.message}`);
      results.push({ source: source.name, found: 0, added: 0, error: err.message });
    }

    // Delay giua cac request
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\n== KET QUA ==");
  for (const r of results) {
    if (r.error) {
      console.log(`  FAIL ${r.source}: ${r.error}`);
    } else {
      console.log(`  OK   ${r.source}: tim ${r.found}, moi ${r.added}`);
    }
  }
  const totalAdded = results.reduce((s, r) => s + (r.added || 0), 0);
  console.log(`\nTong them moi: ${totalAdded} cau hoi.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
