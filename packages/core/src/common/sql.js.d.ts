declare module "sql.js" {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }
  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }
  interface Database {
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string, params?: unknown[]): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }
  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}
