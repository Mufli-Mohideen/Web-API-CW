import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { JSON_BODY_TYPES, requireJsonAccept, requireJsonBody } from './middleware/contentNegotiation';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

const openApiDocument = YAML.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'docs', 'openapi.yaml'), 'utf8'));

export const app = express();

app.set('trust proxy', 1); // behind the hosting platform's HTTPS proxy: req.protocol is https
app.set('etag', false); // ETags are computed explicitly (see http/conditional.ts)
app.set('x-powered-by', false);

// Documentation surface (HTML), mounted before the JSON-only API guards.
app.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: 'SLSEA Solar API' }));
app.get('/', (_req, res) => {
  res.redirect('/docs');
});

app.use(
  '/api/v1',
  helmet(),
  cors({ exposedHeaders: ['Location', 'ETag', 'Last-Modified', 'Link', 'X-Total-Count'] }),
  requireJsonAccept,
  requireJsonBody,
  express.json({ limit: '100kb', type: JSON_BODY_TYPES }),
  apiRouter,
);

app.use(notFoundHandler);
app.use(errorHandler);
