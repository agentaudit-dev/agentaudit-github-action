<div align="center">

# 🛡️ AgentAudit GitHub Action

**Automated security scanning for AI packages in your CI/CD pipeline**

Scan MCP servers, AI skills, and npm/pip packages against the [AgentAudit Trust Registry](https://agentaudit.dev) on every push and pull request. Fail builds when risky packages are detected.

[![AgentAudit](https://www.agentaudit.dev/api/badge/agentaudit-github-action)](https://www.agentaudit.dev/packages/agentaudit-github-action)
[![Trust Registry](https://img.shields.io/badge/Trust_Registry-Live-00C853?style=for-the-badge)](https://agentaudit.dev)
[![License](https://img.shields.io/badge/License-AGPL_3.0-F9A825?style=for-the-badge)](LICENSE)

</div>

---

## Why?

AI agents install packages on your behalf. MCP servers, skills, and tools often get pulled in without any security review. AgentAudit catches risky packages before they reach your production environment.

This GitHub Action integrates the [AgentAudit Trust Registry](https://agentaudit.dev) into your CI/CD pipeline, giving you automated security gates with zero configuration.

---

## 🚀 Quick Start

```yaml
name: Security Scan
on: [push, pull_request]

jobs:
  agentaudit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: AgentAudit Security Scan
        uses: agentaudit-dev/agentaudit-github-action@v1
        with:
          packages: 'mcp-server-fetch,desktop-commander'
          fail-on: 'unsafe'
```

That's it. The action queries the registry, generates a summary table, and fails the build if any package exceeds your risk threshold.

---

## 📋 Usage

### Scan specific packages

```yaml
- uses: agentaudit-dev/agentaudit-github-action@v1
  with:
    packages: 'mcp-server-fetch,desktop-commander,fastmcp'
    fail-on: 'unsafe'
```

### Auto-detect from project files

Automatically discovers packages from `package.json` dependencies and `requirements.txt`:

```yaml
- uses: agentaudit-dev/agentaudit-github-action@v1
  with:
    scan-config: 'true'
    fail-on: 'caution'
```

### Combined (explicit + auto-detect)

```yaml
- uses: agentaudit-dev/agentaudit-github-action@v1
  with:
    packages: 'custom-mcp-server'
    scan-config: 'true'
    fail-on: 'unsafe'
```

### Full workflow example

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: AgentAudit Security Scan
        id: audit
        uses: agentaudit-dev/agentaudit-github-action@v1
        with:
          packages: 'mcp-server-fetch,supabase-mcp'
          scan-config: 'true'
          fail-on: 'caution'

      # Use outputs in subsequent steps
      - name: Check results
        if: steps.audit.outputs.has-issues == 'true'
        run: echo "Security issues detected!"
```

---

## ⚙️ Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `packages` | Comma-separated package slugs to scan | No | `''` |
| `scan-config` | Auto-detect packages from `package.json` / `requirements.txt` | No | `'false'` |
| `fail-on` | Risk threshold to fail the build: `unsafe`, `caution`, or `any` | No | `'unsafe'` |
| `api-url` | AgentAudit API base URL | No | `https://www.agentaudit.dev` |

### `fail-on` thresholds

| Value | Fails when... |
|-------|--------------|
| `unsafe` | Any package is rated 🚨 **unsafe** |
| `caution` | Any package is rated ⚠️ **caution** or worse |
| `any` | Any package is not ✅ **safe** (including ❓ unknown) |

---

## 📤 Outputs

| Output | Description | Example |
|--------|-------------|---------|
| `results` | JSON array of scan results per package | `[{"slug":"mcp-server-fetch","rating":"safe",...}]` |
| `has-issues` | `'true'` if any package exceeds the threshold | `'true'` / `'false'` |

---

## 🚦 Risk Levels

| Level | Trust Score | Meaning |
|-------|-------------|---------|
| ✅ **safe** | ≥ 70 | No known security issues |
| ⚠️ **caution** | 40-69 | Minor concerns found, review recommended |
| 🚨 **unsafe** | < 40 | Significant security risks detected |
| ❓ **unknown** | -- | Package not yet in the AgentAudit database |

---

## 📊 Workflow Summary

The action automatically writes a markdown summary table to your GitHub Actions workflow run:

| Package | Rating | Score | Status |
|---------|--------|-------|--------|
| [mcp-server-fetch](https://agentaudit.dev/packages/mcp-server-fetch) | ✅ safe | 92 | Pass |
| [desktop-commander](https://agentaudit.dev/packages/desktop-commander) | ⚠️ caution | 55 | ❌ Exceeds threshold |
| [unknown-pkg](https://agentaudit.dev/packages/unknown-pkg) | ❓ unknown | -- | ❌ Exceeds threshold |

This appears in your PR checks and workflow run details, giving reviewers instant visibility into package security.

---

## 🔍 How It Works

```
Push / PR triggers workflow
        │
        ▼
┌──────────────────┐
│  Collect Packages │  ← from `packages` input + auto-detect
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Query Registry   │  ← agentaudit.dev/api/findings
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
  Found    Not Found
    │         │
    ▼         ▼
 Get risk   Mark as
 level      "unknown"
    │         │
    └────┬────┘
         ▼
┌──────────────────┐
│  Generate Summary │  ← Markdown table in workflow run
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Check Threshold  │  ← fail-on: unsafe/caution/any
└────────┬─────────┘
    ┌────┴────┐
    ▼         ▼
  Pass      Fail
   ✅        ❌
```

### Auto-detection

When `scan-config: 'true'`, the action scans:

| File | What it reads |
|------|--------------|
| `package.json` | `dependencies` + `devDependencies` keys |
| `requirements.txt` | Package names (ignores comments, version specifiers) |

---

## 🎯 What AgentAudit Detects

The trust registry contains audit results from LLM-powered 3-pass security analysis covering:

<table>
<tr>
<td>

**Core Security**

![Command Injection](https://img.shields.io/badge/-Command_Injection-E53935?style=flat-square)
![Credential Theft](https://img.shields.io/badge/-Credential_Theft-E53935?style=flat-square)
![Data Exfiltration](https://img.shields.io/badge/-Data_Exfiltration-E53935?style=flat-square)
![Path Traversal](https://img.shields.io/badge/-Path_Traversal-E53935?style=flat-square)

</td>
<td>

**AI-Specific**

![Prompt Injection](https://img.shields.io/badge/-Prompt_Injection-7B1FA2?style=flat-square)
![Jailbreak](https://img.shields.io/badge/-Jailbreak-7B1FA2?style=flat-square)
![Capability Escalation](https://img.shields.io/badge/-Capability_Escalation-7B1FA2?style=flat-square)
![Tool Poisoning](https://img.shields.io/badge/-Tool_Poisoning-7B1FA2?style=flat-square)

</td>
</tr>
<tr>
<td>

**MCP-Specific**

![Desc Injection](https://img.shields.io/badge/-Desc_Injection-FF6F00?style=flat-square)
![Resource Traversal](https://img.shields.io/badge/-Resource_Traversal-FF6F00?style=flat-square)
![Unpinned npx](https://img.shields.io/badge/-Unpinned_npx-FF6F00?style=flat-square)

</td>
<td>

**Persistence & Obfuscation**

![Crontab Mod](https://img.shields.io/badge/-Crontab_Mod-455A64?style=flat-square)
![Base64 Exec](https://img.shields.io/badge/-Base64_Exec-455A64?style=flat-square)
![Zero-Width Chars](https://img.shields.io/badge/-Zero--Width_Chars-455A64?style=flat-square)

</td>
</tr>
</table>

50+ detection patterns across 8 categories. See the [full pattern list](https://github.com/agentaudit-dev/agentaudit-skill#-what-it-catches).

---

## 💡 Tips

### Protect your main branch

```yaml
# Only scan on PRs to main
on:
  pull_request:
    branches: [main]
```

### Use strict mode for production

```yaml
# Fail on anything that's not explicitly safe
- uses: agentaudit-dev/agentaudit-github-action@v1
  with:
    scan-config: 'true'
    fail-on: 'any'  # strictest setting
```

### Combine with other security tools

AgentAudit focuses on AI-specific threats. Pair it with traditional tools for full coverage:

| Tool | Focus |
|------|-------|
| **AgentAudit** | AI/MCP-specific attacks, prompt injection, tool poisoning |
| **Dependabot / Snyk** | Known CVEs, outdated dependencies |
| **CodeQL / Semgrep** | General code patterns, bugs |

---

## 🔗 Related

| | Project | Description |
|---|---------|-------------|
| 🌐 | [agentaudit.dev](https://agentaudit.dev) | Trust Registry -- browse packages, findings, leaderboard |
| 📦 | [agentaudit (npm)](https://www.npmjs.com/package/agentaudit) | CLI + MCP Server -- `npx agentaudit audit <url>` |
| 🛡️ | [agentaudit-skill](https://github.com/agentaudit-dev/agentaudit-skill) | Agent Skill -- pre-install security gate for Claude Code, Cursor, Windsurf |
| 📚 | [agentaudit-cli](https://github.com/agentaudit-dev/agentaudit-cli) | Source repo for CLI + MCP server |

---

## 📄 License

[AGPL-3.0](LICENSE) -- Free for open source use. Commercial license available for proprietary integrations.

---

<div align="center">

**Secure your AI stack in CI/CD. Scan before you ship.**

[Trust Registry](https://agentaudit.dev) · [Leaderboard](https://agentaudit.dev/leaderboard) · [Report Issues](https://github.com/agentaudit-dev/agentaudit-github-action/issues)

</div>
