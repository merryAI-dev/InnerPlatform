import { describe, expect, it } from 'vitest';
import { evaluateVercelEdgeRoutePolicy } from '../scripts/assert_vercel_edge_route_policy.mjs';

const baseRedirectHosts = [
  'inner-platform.vercel.app',
  'inner-platform-h799435np-merryai-devs-projects.vercel.app',
  'inner-platform-dsk6wdc3e-merryai-devs-projects.vercel.app',
  'inner-platform-gq6813nqh-merryai-devs-projects.vercel.app',
  'inner-platform-k2x121b33-merryai-devs-projects.vercel.app',
];

function vercelConfig(hosts: string[]) {
  return {
    redirects: hosts.map((host) => ({
      source: '/:path*',
      has: [{ type: 'host', value: host }],
      destination: 'https://myscube.myscguard.app/:path*',
      permanent: false,
    })),
  };
}

function smokeScript(hosts: string[]) {
  return `const defaultDirectHosts = [\n${hosts.map((host) => `  "${host}",`).join('\n')}\n];`;
}

const stageWorkflow = `
env:
  STAGE_CANONICAL_HOST: inner-platform-internal-stage-merryai-devs-projects.vercel.app
steps:
  - name: Verify stage surface
    run: curl "https://\${STAGE_CANONICAL_HOST}/"
`;

describe('Vercel edge route policy', () => {
  it('accepts production direct-origin redirects while keeping stage outside the production security domain', () => {
    const result = evaluateVercelEdgeRoutePolicy({
      vercelConfig: vercelConfig(baseRedirectHosts),
      stageWorkflowText: stageWorkflow,
      smokeScriptText: smokeScript([
        ...baseRedirectHosts,
        'inner-platform-f52434-routes-merryai-devs-projects.vercel.app',
      ]),
    });

    expect(result).toMatchObject({ ok: true, failures: [] });
  });

  it('blocks internal stage alias redirects to the production security domain', () => {
    const result = evaluateVercelEdgeRoutePolicy({
      vercelConfig: vercelConfig([
        ...baseRedirectHosts,
        'inner-platform-internal-stage-merryai-devs-projects.vercel.app',
      ]),
      stageWorkflowText: stageWorkflow,
      smokeScriptText: smokeScript([
        ...baseRedirectHosts,
        'inner-platform-f52434-routes-merryai-devs-projects.vercel.app',
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('Stage hosts must not redirect');
  });

  it('keeps the strict smoke host list aligned with production direct-origin redirects', () => {
    const result = evaluateVercelEdgeRoutePolicy({
      vercelConfig: vercelConfig(baseRedirectHosts),
      stageWorkflowText: stageWorkflow,
      smokeScriptText: smokeScript([
        ...baseRedirectHosts.filter((host) => host !== 'inner-platform-k2x121b33-merryai-devs-projects.vercel.app'),
        'inner-platform-f52434-routes-merryai-devs-projects.vercel.app',
      ]),
    });

    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('Missing production direct-origin smoke hosts');
  });
});
