# Luật nội dung cho AI (bản gốc) — IELTS Idea Generator

File này là **bản gốc, dễ đọc** ghi lại toàn bộ quy tắc về nội dung mà AI phải tuân theo mỗi khi học viên nhập một chủ đề.

> **Quan trọng — AI thật sự "đọc" luật ở đâu?**
> AI trong web không đọc file `.md` này khi chạy. Bộ luật mà AI **thực sự tuân theo mỗi lần** nằm trong biến `SYSTEM_PROMPT` ở file `netlify/functions/generate-ideas.js`. Vì luật được nhúng thẳng vào mỗi lệnh gọi, AI **không bao giờ quên**.
>
> File `.md` này đóng vai trò **tài liệu gốc** để bạn (và tôi) dễ đọc, dễ sửa. **Quy ước:** khi muốn đổi luật, sửa ở đây trước cho rõ, rồi cập nhật y hệt vào `SYSTEM_PROMPT`. Bạn chỉ cần nhắn tôi "đồng bộ luật nội dung", tôi sẽ chép các thay đổi vào prompt giúp.

---

## 1. Mục tiêu tổng quát

- Mỗi chủ đề trả về **đúng 5 ý tưởng (ideas)**, khác biệt rõ ràng, không trùng lặp.
- Toàn bộ phần tiếng Anh phải đạt chuẩn **IELTS Writing Band 8.0+**: tự nhiên, chính xác, từ vựng và ngữ pháp đa dạng.
- Chủ đề nhập vào có thể bằng **tiếng Việt hoặc tiếng Anh** đều được.

## 2. Mỗi ý tưởng gồm 5 phần

### a) Idea (câu Idea) — tiếng Việt + tiếng Anh
- Là **câu đơn** (một mệnh đề), **ngắn gọn, chung chung, đi thẳng** vào việc giới thiệu luận điểm liên quan tới chủ đề (như câu chủ đề mở đầu).
- **Bắt buộc chứa từ khoá của chủ đề.**
- *Ví dụ (chủ đề "Lợi ích của robots"):* `Robots giúp con người làm việc an toàn hơn.`

### b) Supporting Idea (câu Supporting Idea) — tiếng Việt + tiếng Anh
- Là **một câu duy nhất** nhưng là **câu phức**: dài hơn, chi tiết hơn, ngữ pháp phức tạp hơn câu Idea (mệnh đề quan hệ / phụ thuộc / phân từ…).
- Phải **làm rõ** cho câu Idea, theo logic **nguyên nhân → kết quả** ("từ đó", "nhờ vậy", "do đó") để vế sau được suy ra từ vế trước, tăng tính liên kết.
- *Ví dụ:* `Robots được lập trình để vận hành hoàn toàn tự động mà không cần sự can thiệp của con người và được chế tạo từ những vật liệu bền hơn cơ thể người, từ đó chúng có thể làm việc trong môi trường hoá chất độc hại hay những nơi khắc nghiệt như đáy biển và ngoài không gian.`

### c) Bản tiếng Anh (idea_en + support_en)
- Là bản dịch của hai câu trên, **phải sát nghĩa** với bản tiếng Việt (không bịa ý khác).
- `idea_en`: giữ dạng câu chủ đề rõ ràng, tương đối đơn giản.
- `support_en`: **một câu phức** với ngữ pháp cao cấp, đa dạng (mệnh đề quan hệ, phân từ, liên từ nhân–quả như *thereby, which in turn, as a result, enabling … to*).

### d) Từ vựng band cao (vocab)
- 3–5 từ/cụm từ.
- **Bắt buộc:** mỗi từ/cụm phải **thực sự xuất hiện nguyên văn** trong `idea_en` hoặc `support_en` của chính ý tưởng đó (không liệt kê từ không dùng trong câu).
- Mỗi mục gồm từ tiếng Anh + nghĩa tiếng Việt ngắn gọn. Ưu tiên collocation và từ ít phổ thông nhưng chính xác.

## 3. Quy tắc xuyên suốt cả 5 ý tưởng

- **Tiếng Anh luôn sát nghĩa tiếng Việt.**
- **Tối đa hoá paraphrase:** không lặp lại từ vựng, collocation hay cấu trúc ngữ pháp giữa các ý tưởng / supporting idea. Mỗi ý tưởng phải khoe **bộ từ vựng và cấu trúc khác nhau** để học viên thấy sự đa dạng.
- Tiếng Anh phải tự nhiên, đúng (không dùng từ hiếm chỉ để cho "kêu").

## 4. Thông tin kèm theo
- `topic_en`, `topic_vi`: chủ đề ở cả hai ngôn ngữ.
- `essay_type`: đoán dạng bài Task 2, ghi bằng tiếng Việt (Nêu ý kiến / Thảo luận hai quan điểm / Lợi ích & hạn chế / Nguyên nhân & giải pháp).

## 5. Định dạng đầu ra (JSON)
AI chỉ trả về JSON thuần (không markdown, không ```), theo cấu trúc:

```json
{
  "topic_en": "...",
  "topic_vi": "...",
  "essay_type": "...",
  "ideas": [
    {
      "idea_vi": "...",
      "support_vi": "...",
      "idea_en": "...",
      "support_en": "...",
      "vocab": [ { "en": "...", "vi": "..." } ]
    }
  ]
}
```

---

## Muốn chỉnh luật?
Sửa nội dung mục 1–4 ở trên cho rõ ý bạn muốn, rồi nhắn tôi **"đồng bộ luật nội dung vào prompt"**. Tôi sẽ cập nhật `SYSTEM_PROMPT` trong `generate-ideas.js` cho khớp, và bạn đẩy lại lên GitHub là Netlify tự cập nhật.
