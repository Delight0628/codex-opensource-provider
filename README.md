# Codex Open-Source Provider

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6-orange.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

> Configure Codex Desktop to connect to local open-source reasoning models (vLLM) through a lightweight Node.js proxy gateway.

## Overview

This project implements a protocol conversion proxy that enables **Codex Desktop** to use local open-source reasoning models via vLLM. The proxy performs **Responses API → Chat Completions** protocol conversion, allowing Desktop to work with models that only expose the Chat Completions endpoint.

### Supported Models

| Model | Thinking Mode | Output Format | Auto-Config |
|-------|---------------|---------------|-------------|
| **Qwen3/3.5/3.6** | Enabled by default | `reasoning` only, `content` empty | Auto-disable thinking |
| **DeepSeek-R1 Series** | Enabled by default | `reasoning` + `content` dual output | Keep default |
| **Kimi K2 Thinking** | Enabled by default | `reasoning` + `content` dual output | Keep default |
| **GPT-OSS-120B** | Enabled by default | `reasoning` + `content` dual output | Keep default |

## Architecture

```
Codex Desktop (Responses API)
       ↕ POST /v1/responses
  codex-proxy.js (localhost:8001)
       ↕ POST /v1/chat/completions (SSE streaming)
  vLLM (your-server:8000)
       ↕
  Qwen3.6 / DeepSeek-R1 / Kimi K2 / GPT-OSS
```

The proxy performs three core conversions:

| Direction | Input (Desktop sends) | Output (Proxy forwards to vLLM) |
|-----------|----------------------|--------------------------------|
| **Message Format** | `{input: [{type:"message", role:"developer", content:[{type:"input_text", text:"..."}]}]}` | `{messages: [{role:"system", content:"..."}]}` |
| **Role Mapping** | `developer` | `system` (vLLM doesn't recognize developer) |
| **Response Events** | `response.completed` (Desktop termination event) | vLLM SSE `data: [DONE]` |

## Features

- 🔄 **Protocol Conversion**: Responses API ↔ Chat Completions
- 🤖 **Multi-Model Support**: Qwen, DeepSeek, Kimi, GPT-OSS
- 🧠 **Smart Thinking Control**: Auto-detects model family and applies optimal thinking settings
- ⚡ **SSE Streaming**: Real-time streaming responses
- 🔧 **Configurable**: Environment variables for port and vLLM URL
- 🛡️ **CORS Enabled**: Cross-origin requests supported

## Prerequisites

- Node.js 18+
- npm (included with Node.js)
- PM2 (recommended for production): `npm install -g pm2`
- vLLM service running (default: `http://localhost:8000`)
- Codex Desktop installed

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/Delight0628/codex-opensource-provider.git
cd codex-opensource-provider
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the proxy

```bash
# Development mode
node codex-proxy.js

# Production mode with PM2
pm2 start codex-proxy.js --name "codex-proxy"
pm2 save
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXY_PORT` | `8001` | Proxy listening port |
| `VLLM_URL` | `http://localhost:8000` | vLLM service URL |

```powershell
# Custom configuration
$env:PROXY_PORT = "8002"
$env:VLLM_URL = "http://another-server:8000"
pm2 restart codex-proxy --update-env
```

### Codex Desktop Configuration

Edit `~/.codex/config.toml`:

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

## Usage

### Testing the Proxy

```powershell
# Test Qwen model
$body = '{"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}],"model":"Qwen/Qwen3.6-35B-A3B-FP8"}' | ConvertFrom-Json | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "http://localhost:8001/v1/responses" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30

# Test DeepSeek model
$body = '{"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}],"model":"deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"}' | ConvertFrom-Json | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "http://localhost:8001/v1/responses" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30
```

### Manual Thinking Override

Send `thinking: true/false` in the request body to override auto-detection:

```json
{
  "input": [...],
  "model": "Qwen/Qwen3.6-35B-A3B-FP8",
  "thinking": true,
  "max_output_tokens": 4096
}
```

## PM2 Management

```powershell
# Start
pm2 start codex-proxy.js --name "codex-proxy"
pm2 save

# Restart
pm2 restart codex-proxy

# Stop
pm2 stop codex-proxy

# Delete
pm2 delete codex-proxy

# Logs
pm2 logs codex-proxy

# Startup
pm2 startup
```

## Model Switching Guide

### Step 1: Verify model is loaded in vLLM

```powershell
Invoke-RestMethod -Uri "http://localhost:8000/v1/models" | ConvertFrom-Json | Select-Object -ExpandProperty data | Select-Object id
```

### Step 2: Update config.toml

```toml
[profiles]
active = "local-deepseek"  # Switch to desired profile
```

### Step 3: Restart Codex Desktop

Fully quit and reopen Codex Desktop, then select the new model.

## Troubleshooting

### "Reconnecting..." in Desktop

**Cause:** Proxy not sending correct `response.completed` termination event.

**Fix:** Check proxy logs for `<- 200 from vLLM (N chars)` message.

### "Unexpected message role" response

**Cause:** vLLM doesn't recognize `developer` role.

**Fix:** Proxy maps `developer` → `system` automatically.

### Output contains thinking process

**Qwen models:** The proxy automatically disables thinking (`enable_thinking: false`). If you want to see thinking, send `"thinking": true` in the request.

**DeepSeek/Kimi:** Both `reasoning` and `content` are extracted and concatenated. To see only the final answer, modify the proxy to extract only `delta.content`.

### "0 chars" in logs

**Cause:** Proxy didn't extract text from vLLM response.

**Common causes:**
- SSE delimiter mismatch (`\n\n` vs `\n`)
- vLLM returned 400/500 error
- Role mapping error

### "stream disconnected before completion"

**Cause:** Proxy closed HTTP connection before sending `response.completed`.

**Fix:** Ensure all completion events are sent before `res.end()`.

## Project Structure

```
codex-opensource-provider/
├── codex-proxy.js      # Main proxy server
├── package.json        # Node.js dependencies
├── README.md           # This file
├── LICENSE             # MIT License
├── .gitignore          # Git ignore rules
└── docs/
    └── deployment-guide.md  # Detailed deployment guide
```

## Security

- No API keys or secrets in code
- CORS enabled for local development
- Authorization header set to `Bearer empty` (configure for production)
- Input validation on request parsing

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
