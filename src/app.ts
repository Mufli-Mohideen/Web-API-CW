import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { requireJsonAccept, requireJsonBody } from './middleware/contentNegotiation';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

const openApiDocument = YAML.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'docs', 'openapi.yaml'), 'utf8'),
);

export const app = express();

app.set('trust proxy', 1);
app.set('etag', 'strong');

// Documentation surface (HTML), mounted before the JSON-only API guards.
app.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.get('/', (_req, res) => {
  res.redirect('/docs');
});

app.use('/api/v1', helmet(), cors(), requireJsonAccept, requireJsonBody, express.json({ limit: '100kb' }), apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
