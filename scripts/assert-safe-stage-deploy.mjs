function fail(message) {
  console.error(`[stage-deploy-guard] ${message}`);
  process.exit(1);
}

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const canonicalHost = 'inner-platform-internal-stage-merryai-devs-projects.vercel.app';

if (!isGitHubActions) {
  fail(
    `stage deploys and aliases for ${canonicalHost} must run through the GitHub Actions "Stage Deploy" workflow. Local Vercel preview promotion is not allowed.`,
  );
}

if (!process.env.GITHUB_SHA) {
  fail('missing GITHUB_SHA; stage deployments must be tied to a Git commit.');
}

if (!process.env.GITHUB_REF_NAME && !process.env.GITHUB_HEAD_REF) {
  fail('missing Git ref metadata; stage deployments must be tied to a Git ref.');
}

if (!process.env.VERCEL_DEPLOY_TOKEN_STAGE && !process.env.VERCEL_TOKEN) {
  fail('missing VERCEL_DEPLOY_TOKEN_STAGE/VERCEL_TOKEN for the Stage environment.');
}

console.log(`[stage-deploy-guard] GitHub Actions deploy confirmed for ${canonicalHost}.`);
console.log(`[stage-deploy-guard] commit: ${process.env.GITHUB_SHA}`);
console.log(`[stage-deploy-guard] ref: ${process.env.GITHUB_REF_NAME || process.env.GITHUB_HEAD_REF}`);
