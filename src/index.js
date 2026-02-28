const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const https = require('https');

const RISK_LEVELS = { safe: 0, caution: 1, unsafe: 2, unknown: -1 };
const VALID_FAIL_ON_VALUES = ['unsafe', 'caution', 'any'];

function httpsGet(url, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects (max 5)'));
  }
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'AgentAudit-GitHubAction/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, redirectCount + 1).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function detectPackagesFromConfig(workspacePath) {
  const packages = new Set();
  
  // Check package.json
  const pkgPath = path.join(workspacePath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      for (const deps of [pkg.dependencies, pkg.devDependencies]) {
        if (deps) Object.keys(deps).forEach(d => packages.add(d));
      }
    } catch (e) { core.warning(`Failed to parse package.json: ${e.message}`); }
  }

  // Check requirements.txt
  const reqPath = path.join(workspacePath, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    try {
      const lines = fs.readFileSync(reqPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const name = trimmed.split(/[=<>!~\[]/)[0].trim();
          if (name) packages.add(name);
        }
      }
    } catch (e) { core.warning(`Failed to parse requirements.txt: ${e.message}`); }
  }

  return [...packages];
}

function riskEmoji(rating) {
  if (rating === 'safe') return '✅';
  if (rating === 'caution') return '⚠️';
  if (rating === 'unsafe') return '🚨';
  return '❓';
}

function exceedsThreshold(rating, failOn) {
  if (failOn === 'any' && rating !== 'safe') return true;
  if (failOn === 'caution' && RISK_LEVELS[rating] >= RISK_LEVELS.caution) return true;
  if (failOn === 'unsafe' && rating === 'unsafe') return true;
  return false;
}

async function run() {
  try {
    const apiUrl = core.getInput('api-url') || 'https://www.agentaudit.dev';
    const rawFailOn = core.getInput('fail-on') || 'unsafe';
    let failOn;
    if (VALID_FAIL_ON_VALUES.includes(rawFailOn)) {
      failOn = rawFailOn;
    } else {
      core.warning(`Invalid 'fail-on' value: "${rawFailOn}". Must be one of: ${VALID_FAIL_ON_VALUES.join(', ')}. Falling back to "unsafe".`);
      failOn = 'unsafe';
    }
    const scanConfig = core.getInput('scan-config') === 'true';
    const verify = core.getInput('verify') || '';
    const timeout = core.getInput('timeout') || '';
    let packageInput = core.getInput('packages') || '';

    // Collect package slugs
    let slugs = packageInput.split(',').map(s => s.trim()).filter(Boolean);

    if (scanConfig) {
      const workspace = process.env.GITHUB_WORKSPACE || '.';
      const detected = detectPackagesFromConfig(workspace);
      core.info(`Auto-detected ${detected.length} packages from config files`);
      slugs = [...new Set([...slugs, ...detected])];
    }

    if (slugs.length === 0) {
      core.warning('No packages to scan. Provide `packages` input or enable `scan-config`.');
      core.setOutput('results', '[]');
      core.setOutput('has-issues', 'false');
      return;
    }

    // Build CLI flags for logging / future CLI invocation
    const cliFlags = [];
    if (verify) {
      cliFlags.push('--verify', verify);
      core.info(`Verification mode: ${verify}`);
    }
    if (timeout) {
      cliFlags.push('--timeout', timeout);
      core.info(`Timeout: ${timeout}s`);
    }

    core.info(`Scanning ${slugs.length} packages against AgentAudit...`);

    // Fetch all packages from API
    const queryParams = new URLSearchParams();
    if (verify) queryParams.set('verify', verify);
    if (timeout) queryParams.set('timeout', timeout);
    const qs = queryParams.toString();
    const endpoint = `${apiUrl}/api/packages${qs ? '?' + qs : ''}`;
    core.info(`Fetching packages from ${endpoint}`);
    const response = await httpsGet(endpoint);
    
    // Handle response format - could be array or { packages: [...] }
    const allSkills = Array.isArray(response) ? response : (response.packages || response.skills || response.data || []);
    core.info(`Retrieved ${allSkills.length} packages from AgentAudit`);

    // Match requested packages
    const results = [];
    let hasIssues = false;

    for (const slug of slugs) {
      const skill = allSkills.find(s => 
        s.slug === slug || 
        s.name?.toLowerCase() === slug.toLowerCase() ||
        s.package_name === slug
      );

      if (!skill) {
        results.push({ slug, found: false, rating: 'unknown', reason: 'Not found in AgentAudit database' });
        continue;
      }

      // Derive rating from trust_score + latest_result
      let rating = (skill.latest_result || 'unknown').toLowerCase();
      if (rating === 'none' || !['safe', 'caution', 'unsafe'].includes(rating)) {
        // Fallback: derive from trust_score
        const trust = skill.trust_score ?? 100;
        rating = trust >= 80 ? 'safe' : trust >= 50 ? 'caution' : 'unsafe';
      }
      const exceeds = exceedsThreshold(rating, failOn);
      if (exceeds) hasIssues = true;

      results.push({
        slug,
        found: true,
        name: skill.display_name || skill.name || slug,
        rating,
        trust_score: skill.trust_score,
        total_findings: skill.total_findings || 0,
        description: skill.description || '',
        exceeds,
        url: skill.url || `${apiUrl}/packages/${skill.slug || slug}`,
      });
    }

    // Build summary table
    let summary = '## 🛡️ AgentAudit Security Scan Results\n\n';
    summary += '| Package | Rating | Status |\n';
    summary += '|---------|--------|--------|\n';

    for (const r of results) {
      const emoji = riskEmoji(r.rating);
      const status = !r.found ? '❓ Not in database' : (r.exceeds ? '❌ Exceeds threshold' : '✅ OK');
      const link = r.found ? `[${r.name || r.slug}](${r.url})` : r.slug;
      summary += `| ${link} | ${emoji} ${r.rating} | ${status} |\n`;
    }

    summary += `\n**Threshold:** fail on \`${failOn}\` | **Scanned:** ${results.length} packages\n`;

    if (hasIssues) {
      summary += '\n> ⚠️ **Some packages exceed the configured risk threshold!**\n';
    }

    // Write summary
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      fs.appendFileSync(summaryFile, summary);
    } else {
      core.info(summary);
    }

    // Set outputs
    core.setOutput('results', JSON.stringify(results));
    core.setOutput('has-issues', String(hasIssues));

    if (hasIssues) {
      core.setFailed(`AgentAudit: packages exceed "${failOn}" risk threshold`);
    } else {
      core.info('✅ All packages passed AgentAudit security scan');
    }

  } catch (error) {
    core.setFailed(`AgentAudit scan failed: ${error.message}`);
  }
}

run();
