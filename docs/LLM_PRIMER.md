# LLM — ghi chú ngắn (để xem lại)

> Không cần học hết một lúc. Đủ để hiểu chatbot trong project pipeline này.

---

## 1. LLM là gì (1 câu)

**Autocomplete siêu mạnh** — đoán từ/cụm từ tiếp theo, lặp lại → thành câu trả lời.

Không phải “suy nghĩ” như người; không tự biết DB shop trừ khi **bạn đưa số vào**.

---

## 2. Ba thứ cần nhớ

| Khái niệm | Ý nghĩa |
|-----------|---------|
| **Prompt** | Câu lệnh + vai trò (“bạn là analyst…”) + **dữ liệu** (số KPI, insight). |
| **RAG / DB** | Lấy fact từ Postgres / Qdrant rồi nhét vào prompt. Không có → model **đoán** (hallucination). |
| **Temperature** | Thấp (0.1–0.3) = ổn, ít bịa. Cao (0.8+) = sáng tạo, dễ sai số. |

---

## 3. Luồng chat trong project này

```text
User hỏi (dashboard /shop/chat)
    → dashboard-api: intent + query Postgres (số thật)
    → (tuỳ chọn) Qdrant: insight ngữ cảnh
    → build prompt (prompt.js)
    → Ollama trong k3s: http://ollama:11434
    → câu trả lời tiếng Việt
```

**File nên đọc khi rảnh:**

| File | Việc |
|------|------|
| `services/dashboard-api/src/lib/chat/prompt.js` | System prompt + block dữ liệu |
| `services/dashboard-api/src/lib/chat/chat.service.js` | RAG, gọi Ollama |
| `services/dashboard-api/src/lib/chat/ollama.js` | HTTP `/api/generate` |
| `infra/k8s/apps/ollama/` | Ollama chạy k3s, PVC `ollama-data` |

---

## 4. Pretrain vs RAG vs fine-tune

| Cách | Ai làm | Project này |
|------|--------|----------------|
| **Pretrain** | Công ty lớn, GPU khổng lồ | Không — dùng model có sẵn (`qwen2.5:3b`) |
| **RAG** | Dev — đưa dữ liệu lúc hỏi | **Có** — Postgres + Qdrant |
| **Fine-tune** | Train thêm trên dataset riêng | Chưa — phase sau nếu cần |

---

## 5. Từ vựng (học dần, không gấp)

| Từ | Gợi ý |
|----|--------|
| **Token** | Câu bị cắt mảnh; model xử lý token, không phải “câu”. |
| **Context window** | Giới hạn độ dài nhớ trong 1 lần chat (vd. 4k/8k token). |
| **Hallucination** | Trả lời trôi chảy nhưng **sai fact** → giảm bằng số từ DB. |
| **Transformer / Attention** | Kiến trúc bên trong — đọc sau khi đã quen prompt + RAG. |

---

## 6. Ollama trên k3s (setup hiện tại)

- Service: `http://ollama:11434` (trong cluster).
- Model: `qwen2.5:3b` — lưu PVC `ollama-data` (10Gi).
- Pod restart **không** mất model (đã pull xong).
- Windows Ollama: **đã bỏ** — chỉ dùng k3s.

```bash
# Kiểm tra nhanh
k3s kubectl -n realtime get pods -l app=ollama
k3s kubectl -n realtime exec deploy/ollama -- ollama list
k3s kubectl -n realtime exec deploy/dashboard-api -- wget -qO- http://ollama:11434/api/tags
```

---

## 7. Tự kiểm tra “đã hiểu đủ chưa”

Trả lời được 5 câu (không cần thuộc công thức):

1. Vì sao chat cần query Postgres trước khi gọi Ollama?
2. Qdrant dùng để làm gì (khác Postgres thế nào)?
3. Đổi prompt trong `prompt.js` sẽ đổi gì?
4. Hallucination là gì, giảm bằng cách nào trong project?
5. `temperature` cao/thấp khác nhau thế nào?

---

## 8. Học thêm (tuỳ chọn, từng tuần)

| Tuần | Nội dung |
|------|----------|
| 1 | Chơi Ollama + đổi prompt / temperature trên Chat |
| 2 | [Hugging Face LLM Course](https://huggingface.co/learn/llm-course) ch.1–2 |
| 3 | [Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/) |
| 4 | Đọc sâu `chat.service.js` + thử câu hỏi intent khác |

---

## 9. Liên quan doc khác

- Runtime k3s: [`RUNTIME.md`](RUNTIME.md)
- Ports / k3s: [`infra/PORTS.md`](../infra/PORTS.md)
- Deploy k3s: [`infra/k8s/README.md`](../infra/k8s/README.md)
- Spec project: [`PROJECT.md`](PROJECT.md)
