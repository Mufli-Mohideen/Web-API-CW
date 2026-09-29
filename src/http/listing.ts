import type { Request, Response } from 'express';
import type { Collection, Document, Filter, Sort } from 'mongodb';
import { latestDate, sendRepresentation } from './conditional';
import { paginate, type PageRequest } from './pagination';

interface ListOptions<TDoc extends Document, TOut> {
  filter: Filter<TDoc>;
  sort: Sort;
  page: PageRequest;
  toJson: (doc: TDoc) => TOut;
  modifiedAt: (doc: TDoc) => Date | null;
  projection?: Document;
}

/** Runs a paginated, filtered, sorted query and sends the collection envelope (with validators). */
export async function sendPage<TDoc extends Document, TOut>(
  req: Request,
  res: Response,
  collection: Collection<TDoc>,
  { filter, sort, page, toJson, modifiedAt, projection }: ListOptions<TDoc, TOut>,
): Promise<void> {
  const [docs, total] = await Promise.all([
    collection
      .find(filter, { projection })
      .sort(sort)
      .skip((page.page - 1) * page.page_size)
      .limit(page.page_size)
      .toArray() as Promise<TDoc[]>,
    collection.countDocuments(filter),
  ]);
  const body = paginate(req, res, docs.map(toJson), total, page);
  sendRepresentation(req, res, body, { lastModified: latestDate(docs.map(modifiedAt)) });
}
