import { clamp, toNumber } from "./numbers";

export function totalPages(totalItems: unknown, pageSize: unknown): number {
  const size = toNumber(pageSize);
  if (size <= 0) return 0;
  return Math.ceil(toNumber(totalItems) / size);
}

export function normalizePage(page: unknown, totalItems: unknown, pageSize: unknown): number {
  const pages = totalPages(totalItems, pageSize);
  if (pages === 0) return 1;
  return clamp(Math.trunc(toNumber(page, 1)) || 1, 1, pages);
}

export function paginate<T>(items: T[] = [], page = 1, pageSize = 10): T[] {
  const size = toNumber(pageSize);
  if (size <= 0) return [];
  const current = normalizePage(page, items.length, size);
  const start = (current - 1) * size;
  return items.slice(start, start + size);
}

export function pageRange(page: unknown, totalItems: unknown, pageSize: unknown): number[] {
  const pages = totalPages(totalItems, pageSize);
  if (pages === 0) return [];
  const current = normalizePage(page, totalItems, pageSize);
  const start = Math.max(1, current - 2);
  const end = Math.min(pages, start + 4);
  const adjustedStart = Math.max(1, end - 4);
  const range: number[] = [];
  for (let i = adjustedStart; i <= end; i += 1) range.push(i);
  return range;
}
