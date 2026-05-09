# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of codex-opensource-provider
- Responses API to Chat Completions protocol conversion proxy
- Smart model family detection (Qwen, DeepSeek, Kimi, GPT-OSS)
- Automatic thinking mode control per model family
- SSE streaming support
- CORS enabled for local development
- PM2 deployment configuration
- Comprehensive deployment guide
- Environment variable configuration (PROXY_PORT, VLLM_URL)
- Manual thinking override via request body

### Supported Models
- Qwen3/3.5/3.6 (auto-disable thinking)
- DeepSeek-R1 series (dual output)
- Kimi K2 Thinking (dual output)
- GPT-OSS-120B (dual output)

## [1.0.0] - 2026-05-09

### Added
- Initial release
- Core proxy server (`codex-proxy.js`)
- Model family detection system
- Protocol conversion (Responses API ↔ Chat Completions)
- Role mapping (developer → system)
- Event conversion (response.done → response.completed)
- Documentation (README, deployment guide)
- MIT License
- PM2 deployment scripts
