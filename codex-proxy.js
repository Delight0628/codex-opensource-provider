import http from 'http';
import { URL } from 'url';

const PORT = parseInt(process.env.PROXY_PORT || '8001', 10);
const VLLM_URL = process.env.VLLM_URL || 'http://10.0.83.100:8000';
const vllmParsed = new URL(VLLM_URL);

// ── Model family detection ──────────────────────────────────────────────────
// Different open-source reasoning models handle reasoning/content differently:
//   Qwen:     thinking mode → 100% in `reasoning`, `content` always empty
//   DeepSeek: thinking mode → `reasoning` (steps) + `content` (final answer)
//   Kimi:     thinking mode → `reasoning` (steps) + `content` (final answer)
//   GPT-OSS:  thinking mode → `reasoning` (steps) + `content` (final answer)
function detectModelFamily(modelName) {
    const name = (modelName || '').toLowerCase();
    if (name.includes('qwen'))   return 'qwen';
    if (name.includes('deepseek')) return 'deepseek';
    if (name.includes('kimi'))   return 'kimi';
    if (name.includes('gpt-oss')) return 'gpt-oss';
    return 'generic';
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

function generateId(prefix) {
    return prefix + '_' + Math.random().toString(36).substring(2, 15);
}

// ── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    const url   = new URL(req.url, `http://localhost:${PORT}`);
    const path  = url.pathname;
    const reqId = generateId('req');

    log(`${reqId} -> ${req.method} ${path}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (path !== '/v1/responses') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        try {
            const codexReq = JSON.parse(body);

            // ── Step 1: Convert Responses API input → Chat Completions messages ──
            const messages = [];
            const input = codexReq.input;
            log(`${reqId} INPUT: ${Array.isArray(input) ? input.length + ' items' : typeof input}`);

            // Desktop sends nested message format:
            // [{type:"message", role:"developer"/"user", content:[{type:"input_text", text:"..."}]}]
            const roleMap = { developer: 'system', user: 'user', assistant: 'assistant', system: 'system' };
            if (Array.isArray(input)) {
                for (const item of input) {
                    if (item.type === 'message' && Array.isArray(item.content)) {
                        let text = '';
                        for (const c of item.content) {
                            if (c.type === 'input_text')  text += c.text;
                            if (c.type === 'output_text') text += c.text;
                        }
                        if (text) messages.push({ role: roleMap[item.role] || item.role, content: text });
                    }
                }
            } else if (typeof input === 'string') {
                messages.push({ role: 'user', content: input });
            }
            if (codexReq.system_prompt) messages.unshift({ role: 'system', content: codexReq.system_prompt });

            const model  = codexReq.model || 'Qwen/Qwen3.6-35B-A3B-FP8';
            const family = detectModelFamily(model);

            // ── Step 2: Build vLLM request body ──
            const vllmBody = {
                model, messages,
                max_tokens:   codexReq.max_output_tokens || 4096,
                stream:       true,
                temperature:  codexReq.temperature || 0.7
            };

            // ── Step 3: Per-model thinking control ──
            //   Qwen:   content always empty in thinking mode → force disable
            //   Others: both reasoning+content available → keep default
            let thinkingEnabled = true;
            if (family === 'qwen') {
                // Allow user override: codexReq.thinking = true/false
                const thinking = codexReq.thinking !== undefined ? codexReq.thinking : false;
                if (!thinking) {
                    vllmBody.chat_template_kwargs = { enable_thinking: false };
                    thinkingEnabled = false;
                }
                log(`${reqId} MODEL_DETECT: family=qwen, thinking=${thinking}`);
            } else if (family === 'deepseek') {
                log(`${reqId} MODEL_DETECT: family=deepseek (reasoning+content dual output)`);
            } else {
                log(`${reqId} MODEL_DETECT: family=${family}`);
            }

            const vllmBodyStr = JSON.stringify(vllmBody);
            log(`${reqId} VLLM_BODY: ${JSON.stringify({ model, family, thinking: thinkingEnabled, msgs: messages.length })}`);

            // ── Step 4: Forward to vLLM ──
            const proxyReq = http.request({
                hostname: vllmParsed.hostname, port: vllmParsed.port,
                path: '/v1/chat/completions', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer empty' }
            }, proxyRes => {
                let buf     = '';
                let textBuf = '';
                const respId  = generateId('resp');
                const itemId  = generateId('item');

                function sendSSE(data) {
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                }

                // === Send Responses API init events ===
                sendSSE({
                    type: 'response.created',
                    response: { id: respId, object: 'response',
                                created_at: Math.floor(Date.now()/1000),
                                status: 'in_progress', model, output: [] }
                });
                sendSSE({ type: 'response.output_item.added', output_index: 0,
                           item: { type: 'message', role: 'assistant',
                                   content: [], status: 'in_progress', id: itemId } });
                sendSSE({ type: 'response.content_part.added', output_index: 0,
                           part: { type: 'output_text', text: '' } });

                // === Stream vLLM SSE → Responses API SSE ===
                proxyRes.on('data', chunk => {
                    buf += chunk.toString('utf-8');
                    const parts = buf.split('\n\n');
                    buf = parts.pop() || '';

                    for (const part of parts) {
                        if (!part.trim()) continue;
                        for (const line of part.split('\n')) {
                            if (!line.startsWith('data: ')) continue;
                            const ds = line.slice(6).trim();
                            if (ds === '[DONE]') continue;

                            try {
                                const d = JSON.parse(ds);
                                if (!d.choices || !d.choices[0]) continue;
                                const delta = d.choices[0].delta;
                                if (!delta) continue;

                                // Extract from BOTH reasoning AND content fields
                                // This works for ALL models:
                                //   - Qwen (thinking off):   content has answer
                                //   - Qwen (thinking on):    reasoning has full output
                                //   - DeepSeek/Kimi/GPT-OSS: both fields populated
                                let t = '';
                                if (delta.content)   t += delta.content;
                                if (delta.reasoning) t += delta.reasoning;

                                if (t) {
                                    textBuf += t;
                                    sendSSE({
                                        type: 'response.output_text.delta',
                                        output_index: 0, item_id: itemId, delta: t
                                    });
                                }
                            } catch (_) {}
                        }
                    }
                });

                // === Stream end → send Responses API termination events ===
                proxyRes.on('end', () => {
                    log(`${reqId} <- 200 from vLLM (${textBuf.length} chars)`);

                    sendSSE({ type: 'response.content_part.done', output_index: 0, item_id: itemId,
                               part: { type: 'output_text', text: textBuf } });
                    sendSSE({ type: 'response.output_item.done', output_index: 0,
                               item: { type: 'message', role: 'assistant',
                                       content: [{ type: 'output_text', text: textBuf }],
                                       status: 'completed', id: itemId } });
                    sendSSE({ type: 'response.completed',
                               response: { id: respId, status: 'completed', output: [] } });
                    res.end();
                });
            });

            proxyReq.on('error', err => {
                log(`${reqId} ERROR: ${err.message}`);
                res.writeHead(502);
                res.end(JSON.stringify({ error: err.message }));
            });

            proxyReq.write(vllmBodyStr);
            proxyReq.end();

        } catch (e) {
            log(`${reqId} PARSE ERR: ${e.message}`);
            res.writeHead(400);
            res.end(JSON.stringify({ error: e.message }));
        }
    });
});

server.listen(PORT, () => {
    log(`Codex proxy listening on :${PORT} -> ${VLLM_URL}`);
    log('Models: Qwen (auto-disable-thinking) | DeepSeek/Kimi/GPT-OSS (dual output)');
    log('Override: send "thinking":true/false in request body per-model');
    log(`Config via env: PROXY_PORT=${PORT}, VLLM_URL=${VLLM_URL}`);
});
