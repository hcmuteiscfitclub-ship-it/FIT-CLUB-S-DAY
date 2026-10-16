function apiError(message, status) { const error = new Error(message); error.status = status; throw error; }
function numeric(value, fallback, minimum, maximum) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < minimum || n > maximum) throw new Error('Cấu hình giới hạn chatbot không hợp lệ.');
  return n;
}

export class LLMClient {
  constructor({ endpoint = process.env.CHAT_API_URL || '', apiKey = process.env.CHAT_API_KEY || '', model = process.env.CHAT_MODEL || '', authMode = process.env.CHAT_AUTH_MODE || 'bearer', tokenField = process.env.CHAT_TOKEN_FIELD || 'max_completion_tokens', maxTokens = process.env.CHAT_MAX_OUTPUT_TOKENS, timeoutMs = process.env.CHAT_TIMEOUT_MS } = {}) {
    this.endpoint = endpoint.trim(); this.apiKey = apiKey.trim(); this.model = model.trim();
    this.authMode = authMode; this.tokenField = tokenField;
    this.maxTokens = numeric(maxTokens, 1024, 64, 8192); this.timeoutMs = numeric(timeoutMs, 30000, 50, 120000);
    if (!['bearer', 'none'].includes(authMode) || !['max_tokens', 'max_completion_tokens'].includes(tokenField)) throw new Error('Cấu hình giao thức chatbot không hợp lệ.');
    if (this.endpoint) {
      const url = new URL(this.endpoint);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('CHAT_API_URL phải là URL HTTP(S) đầy đủ, không chứa thông tin đăng nhập.');
    }
  }
  get ready() { return !!(this.endpoint && this.model && (this.apiKey || this.authMode === 'none')); }
  async complete({ system, history, message }) {
    if (!this.ready) apiError('Kênh hội thoại chưa sẵn sàng. Vui lòng liên hệ ban tổ chức.', 503);
    const recent = []; let characters = 0;
    for (let i = history.length - 2; i >= 0 && recent.length < 24; i -= 2) {
      const pair = history.slice(i, i + 2);
      if (pair[0].role !== 'user' || pair[1].role !== 'assistant') continue;
      const size = pair[0].text.length + pair[1].text.length;
      if (characters + size > 12000) break;
      recent.unshift(...pair.map(m => ({ role: m.role, content: m.text }))); characters += size;
    }
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', ...(this.authMode === 'bearer' ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.model, messages: [{ role: 'system', content: system }, ...recent, { role: 'user', content: message }], stream: false, [this.tokenField]: this.maxTokens })
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) apiError('Kênh hội thoại chưa sẵn sàng. Vui lòng liên hệ ban tổ chức.', 503);
        if (response.status === 429) apiError('Dịch vụ AI đang giới hạn yêu cầu hoặc hết hạn mức. Hãy thử lại sau.', 429);
        apiError('Dịch vụ AI chưa phản hồi hợp lệ. Vui lòng thử lại sau.', 502);
      }
      let size = 0; const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 131072) apiError('Phản hồi AI vượt quá giới hạn cho phép. Hãy thử câu hỏi ngắn hơn.', 502);
        chunks.push(Buffer.from(chunk));
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { apiError('Dịch vụ AI trả về dữ liệu không hợp lệ. Vui lòng thử lại.', 502); }
      const reply = data.choices?.[0]?.message?.content;
      if (typeof reply !== 'string' || !reply.trim() || reply.length > 16000) apiError('Dịch vụ AI trả về nội dung trống hoặc quá dài. Vui lòng thử lại.', 502);
      return reply.trim();
    } catch (error) {
      if (error.status) throw error;
      if (signal.aborted) apiError('Dịch vụ AI phản hồi quá lâu. Tin nhắn chưa được lưu; bạn có thể gửi lại.', 504);
      apiError('Không thể kết nối dịch vụ AI. Vui lòng thử lại sau.', 502);
    }
  }
}
