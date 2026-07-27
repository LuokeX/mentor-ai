/**
 * 并行执行数据查询和计数查询，统一返回标准分页结构。
 *
 * 使用时将 db.select() 的调用结果传入（不带 .limit/.offset），
 * 本函数负责 Promise.all 并行、偏移计算和返回整形。
 *
 * 使用方式：
 *   const result = await paginateResult({
 *     dataQuery: db.select({...}).from(schema.X).where(...).orderBy(...).limit(pageSize).offset(offsetFrom(page, pageSize)),
 *     countQuery: db.select({ value: countSql }).from(schema.X).where(...),
 *     page,
 *     pageSize,
 *   })
 */
export async function paginateResult<T>(opts: {
  dataQuery: Promise<T[]>
  countQuery: Promise<{ value: number }[]>
  page: number
  pageSize: number
}): Promise<{ rows: T[]; page: number; pageSize: number; total: number }> {
  const [rows, countRows] = await Promise.all([opts.dataQuery, opts.countQuery])
  return {
    rows,
    page: opts.page,
    pageSize: opts.pageSize,
    total: countRows[0]?.value ?? 0,
  }
}