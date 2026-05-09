export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type PaginatedResult<T> = {
  data: T[];
  meta: PaginationMeta;
};

export function resolvePagination(input?: { page?: number; limit?: number }) {
  const page = Math.max(Number(input?.page || 1), 1);
  const limit = Math.min(Math.max(Number(input?.limit || 20), 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip, take: limit };
}

export function buildPaginatedResult<T>(
  data: T[],
  metaInput: { page?: number; limit?: number; total: number },
): PaginatedResult<T> {
  const page = Math.max(Number(metaInput.page || 1), 1);
  const limit = Math.min(Math.max(Number(metaInput.limit || 20), 1), 100);
  const total = Math.max(Number(metaInput.total || 0), 0);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && totalPages > 0,
    },
  };
}
