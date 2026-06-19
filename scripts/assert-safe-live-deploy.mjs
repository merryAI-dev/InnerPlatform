const EXPECTED_CANONICAL_HOST = 'myscube.myscguard.app';
const EXPECTED_REF = 'refs/heads/main';

function fail(message) {
  console.error(`[live-deploy-guard] ${message}`);
  process.exit(1);
}

if (process.env.GITHUB_ACTIONS !== 'true') {
  fail('Production deploy and alias promotion must run through GitHub Actions Production workflow.');
}

if (!process.env.GITHUB_SHA) {
  fail('missing GITHUB_SHA; production deployments must be tied to a Git commit.');
}

const ref = process.env.GITHUB_REF || process.env.GITHUB_REF_NAME || '';
if (ref !== EXPECTED_REF && process.env.GITHUB_REF_NAME !== 'main') {
  fail(`Production deploy requires ${EXPECTED_REF}; current ref: ${ref || process.env.GITHUB_REF_NAME || 'unknown'}`);
}

const canonicalHost = process.env.VERCEL_CANONICAL_PRODUCTION_HOST || EXPECTED_CANONICAL_HOST;
if (canonicalHost !== EXPECTED_CANONICAL_HOST) {
  fail(`invalid production canonical host ${canonicalHost}; expected ${EXPECTED_CANONICAL_HOST}`);
}

if (!process.env.VERCEL_TOKEN) {
  fail('missing VERCEL_TOKEN for Production workflow');
}

console.log('[live-deploy-guard] GitHub Actions production deploy confirmed.');
console.log(`[live-deploy-guard] canonical host: ${canonicalHost}`);
console.log(`[live-deploy-guard] commit: ${process.env.GITHUB_SHA}`);
console.log(`[live-deploy-guard] ref: ${ref || process.env.GITHUB_REF_NAME}`);
