export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const SERVER_PAGE_TIE_BREAKER = 'id' as const;

export type ListFilters = {
  search: string;
  status: string;
  dateFrom: string;
  dateTo: string;
};

export type ServerPageRequest = {
  page: number;
  pageSize: number;
  filters: ListFilters;
};

export type ServerPageResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasNext: boolean;
};

export function normalizePageRequest(page: number, pageSize = DEFAULT_PAGE_SIZE) {
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isSafeInteger(pageSize) && pageSize > 0
      ? Math.min(pageSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE,
  };
}
