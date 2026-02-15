import { createBffApp } from './app.mjs';
import { resolveProjectId } from './firestore.mjs';

const port = Number.parseInt(process.env.BFF_PORT || '8787', 10);
const host = process.env.BFF_HOST || '127.0.0.1';
const projectId = resolveProjectId();

const app = createBffApp({ projectId });

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`[bff] listening on http://${host}:${port} (project=${projectId})`);
});
