export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(404).send('Static asset not found. Reload the application to fetch the current release.');
}
