# Codex Desktop 配置开源推理模型完整指南

## 架构概览

```
Codex Desktop (Responses API)
       ↕ POST /v1/responses
   codex-proxy.js (localhost:8001)
       ↕ POST /v1/chat/completions (SSE streaming)
   vLLM (10.0.83.100:8000)
       ↕
   Qwen3.6 / DeepSeek-R1 / Kimi K2 / GPT-OSS (推理模型)
```

**核心问题：** Codex Desktop 使用 OpenAI **Responses API**（新协议），不支持旧的 `chat/completions`。而 vLLM 只暴露 `chat/completions` 端点。因此需要一个代理层进行协议转换。

---

## 步骤 1：部署代理脚本

### 创建代理文件

将 `codex-proxy.js` 复制到目标路径（如 `D:\codex\codex-proxy.js`）。

### 代理工作原理

代理完成三项核心转换：

| 方向 | 输入 | 输出 |
|------|------|------|
| **请求体** | Responses API (`input`, `model`, `max_output_tokens`) | Chat Completions (`messages`, `model`, `max_tokens`, `stream: true`) |
| **消息格式** | `[{type:"message", role:"developer"/"user", content:[{type:"input_text", text:"..."}]}]` | `[{role:"system"/"user", content:"..."}]` |
| **响应流** | SSE `data: {...}` Chat Completions chunks | SSE `data: {...}` Responses API events |

**关键映射处理：**

- `role: "developer"` → `role: "system"`（vLLM 不识别 developer 角色）
- 拒绝事件 `response.done` → `response.completed`（Desktop 只认这个）
- 不同模型思考模式自动处理：
  - **Qwen**：自动注入 `chat_template_kwargs: { enable_thinking: false }` 关闭思考
  - **DeepSeek**：保持默认，同时输出 reasoning + content
  - **Kimi**：保持默认，同时输出 reasoning + content
- 可通过请求体 `thinking: true/false` 手动覆盖自动检测
- 可通过环境变量 `PROXY_PORT` / `VLLM_URL` 修改配置

### 安装 PM2（守护进程管理）

```powershell
npm install -g pm2
```

### 启动代理

```powershell
pm2 start D:\codex\codex-proxy.js --name "codex-proxy" --cwd D:\codex
pm2 save
```

### 验证代理运行

```powershell
# 检查进程状态
pm2 list

# 查看日志
pm2 logs codex-proxy --lines 20 --nostream
```

### 设置开机自启

```powershell
pm2 startup  # 按提示执行生成的命令
pm2 save
```

### 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PROXY_PORT` | `8001` | 代理监听端口 |
| `VLLM_URL` | `http://10.0.83.100:8000` | vLLM 服务地址 |

```powershell
# 用自定义配置重启
$env:PROXY_PORT = "8002"
$env:VLLM_URL = "http://another-server:8000"
pm2 restart codex-proxy --update-env
```

---

## 步骤 2：验证代理功能

直接用 curl/PowerShell 测试代理：

```powershell
# 测试 Qwen 模型
$body = '{"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"你好"}]}],"model":"Qwen/Qwen3.6-35B-A3B-FP8"}' | ConvertFrom-Json | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "http://localhost:8001/v1/responses" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 | Format-List

# 测试 DeepSeek 模型
$body = '{"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"你好"}]}],"model":"deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"}' | ConvertFrom-Json | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "http://localhost:8001/v1/responses" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 | Format-List
```

成功时输出应包含 `response.created` → `response.output_text.delta` → `response.completed` 事件序列。

---

## 步骤 3：配置 Codex Desktop

### 方式 A：CC-Switch（推荐）

1. 打开 Codex Desktop
2. 点击模型切换 → CC-Switch
3. 配置自定义 provider：
   - **名称:** local-model
   - **Base URL:** `http://localhost:8001/v1`
   - **API Key:** 任意值（留空或填 `empty`）
   - **模型:** 选择对应模型（如 `Qwen/Qwen3.6-35B-A3B-FP8`）
4. 选择此 provider 并确认

### 方式 B：手动编辑 config.toml

文件路径：`C:\Users\<用户名>\.codex\config.toml`

```toml
[profiles]
active = "local-qwen"

[profiles.local-qwen]
base_url = "http://localhost:8001/v1"
api_key = "empty"
model = "Qwen/Qwen3.6-35B-A3B-FP8"
wire_api = "responses"

[profiles.local-deepseek]
base_url = "http://localhost:8001/v1"
api_key = "empty"
model = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
wire_api = "responses"
```

**切换模型：** 只需修改 `active` 字段指向对应的 profile。

---

## 步骤 4：管理代理

### 常用命令

```powershell
# 重启
pm2 restart codex-proxy

# 停止
pm2 stop codex-proxy

# 删除
pm2 delete codex-proxy

# 查看日志（实时）
pm2 logs codex-proxy
```

### 修改后重载

修改 `codex-proxy.js` 后：

```powershell
pm2 restart codex-proxy
```

---

## 故障排除

### 症状 1：Desktop 显示 "Reconnecting..."

**原因：** 代理未发送正确的 `response.completed` 终止事件。

**检查：** 查看日志中是否包含 `<- 200 from vLLM (N chars)`。

**修复：** 确保代理在流结束时发送 `response.completed` 事件（而非 `response.done`）。

### 症状 2：回复为空或显示 "Unexpected message role"

**原因：** vLLM 不识别 `developer` 角色。

**修复：** 代理必须将 `developer` 映射为 `system`。

### 症状 3：回复包含思考过程（reasoning）

**原因：** 不同模型对思考模式的处理不同。

**Qwen 系列（推荐方案）：**
- 在代理请求中添加 `chat_template_kwargs: { enable_thinking: false }`
- 模型会直接输出到 `content`，干净且无思考过程

**DeepSeek/Kimi：**
- 默认同时输出 `reasoning`（思考步骤）和 `content`（最终答案）
- 代理会自动提取两者并拼接，用户会看到思考过程
- 如只想看最终答案，修改代理代码只提取 `delta.content`

### 症状 4：日志显示 "0 chars"

**原因：** 代理未从 vLLM 响应中提取到任何文本。

**检查：** 查看日志查找 `RAW CHUNK` 或 `ERROR`。

**常见原因：**
- Role 映射错误（developer → system）
- SSE 解析格式不匹配
- vLLM 返回了 400/500 错误

### 症状 5：Desktop 显示 "stream disconnected before completion"

**原因：** 代理在发送 `response.completed` 事件之前关闭了 HTTP 连接。

**修复：** 确保 `proxyRes.on('end')` 中先发送所有完成事件，再调用 `res.end()`。

---

## 多模型切换指南

### 切换模型步骤

1. **确认 vLLM 上已加载新模型：**
   ```powershell
   Invoke-RestMethod -Uri "http://10.0.83.100:8000/v1/models" | ConvertFrom-Json | Select-Object -ExpandProperty data | Select-Object id
   ```

2. **修改 config.toml：**
   ```toml
   [profiles]
   active = "local-deepseek"  # 指向新 profile
   
   [profiles.local-deepseek]
   base_url = "http://localhost:8001/v1"
   api_key = "empty"
   model = "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
   wire_api = "responses"
   ```

3. **重启 Desktop：** 完全退出后重新打开，选择新模型。

### 推荐模型组合

| 场景 | 推荐模型 | 原因 |
|------|----------|------|
| **代码生成/分析** | Qwen3.6-35B-A3B-FP8 | 参数量小，速度快，关闭 thinking 后输出干净 |
| **深度推理/数学** | DeepSeek-R1-Distill-Qwen-1.5B | 蒸馏自 R1-0528，推理能力强 |
| **Agent/规划** | Kimi K2 Thinking | 256K 上下文，适合长链任务规划 |
| **边缘部署** | GPT-OSS-20B | 仅需 16GB 显存，消费级 GPU 友好 |
