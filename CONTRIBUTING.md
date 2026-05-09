# Contributing

Thank you for your interest in contributing to **Codex Open-Source Provider**!

This project helps Codex Desktop connect to local open-source reasoning models through a lightweight proxy gateway.

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, please include:

- A clear title and summary
- As much detail as possible (error messages, logs, screenshots)
- Steps to reproduce the issue
- Your environment (OS, Node.js version, vLLM version)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement request, please include:

- A clear title and summary
- Describe the feature you'd like
- Explain why this feature would be useful
- Provide examples if applicable

### Contributing Code

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Test your changes**
5. **Commit using Conventional Commits format**:
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation changes
   - `style:` - Code style changes
   - `refactor:` - Code refactoring
   - `test:` - Tests
   - `chore:` - Maintenance tasks
6. **Push to your fork**: `git push origin feature/amazing-feature`
7. **Create a Pull Request**

## Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/codex-opensource-provider.git
cd codex-opensource-provider

# Start in development mode
npm run dev
```

## Code Style

- Use ES Modules (`type: "module"` in package.json)
- Node.js 18+ compatibility
- Follow existing code patterns
- Add comments for complex logic

## Project Structure

```
codex-opensource-provider/
├── codex-proxy.js      # Main proxy server
├── package.json        # Project configuration
├── README.md           # Documentation
├── LICENSE             # MIT License
├── CHANGELOG.md        # Version history
├── CONTRIBUTING.md     # This file
├── .gitignore          # Git ignore rules
└── docs/
    └── deployment-guide.md  # Deployment documentation
```

## Questions?

If you have questions, please create a GitHub issue with the "question" label.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
