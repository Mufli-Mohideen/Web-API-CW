import type { Request, Response } from 'express';

export interface PageRequest {
  page: number;
  page_size: number;
}

export interface PagedBody<T> {
  data: T[];
  pagination: { page: number; page_size: number; total_items: number; total_pages: number };
  links: { self: string; first: string; last: string; prev: string | null; next: string | null };
}

function pageUrl(req: Request, page: number, pageSize: number): string {
  const url = new URL(`${req.protocol}://${req.get('host')}${req.originalUrl}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(pageSize));
  return url.toString();
}

/**
 * Builds the paginated collection envelope: the page of items, the total count, and links
 * to the first/last/previous/next chunks (also mirrored in the Link and X-Total-Count headers).
 */
export function paginate<T>(req: Request, res: Response, items: T[], totalItems: number, { page, page_size: pageSize }: PageRequest): PagedBody<T> {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const links = {
    self: pageUrl(req, page, pageSize),
    first: pageUrl(req, 1, pageSize),
    last: pageUrl(req, totalPages, pageSize),
    prev: page > 1 ? pageUrl(req, Math.min(page - 1, totalPages), pageSize) : null,
    next: page < totalPages ? pageUrl(req, page + 1, pageSize) : null,
  };

  const linkHeader = (['first', 'prev', 'next', 'last'] as const)
    .filter((rel) => links[rel])
    .map((rel) => `<${links[rel]}>; rel="${rel}"`)
    .join(', ');
  res.set('Link', linkHeader);
  res.set('X-Total-Count', String(totalItems));

  return { data: items, pagination: { page, page_size: pageSize, total_items: totalItems, total_pages: totalPages }, links };
}
