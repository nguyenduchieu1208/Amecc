function translateSql(source) {
  const input = String(source).replace(
    /(\b[\w.]+)\s*=\s*\?\s+COLLATE\s+NOCASE/gi,
    'LOWER($1) = LOWER(?)',
  );
  let output = '';
  let parameter = 0;
  let quote = '';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      output += character;
      if (character === quote) {
        if (input[index + 1] === quote) output += input[++index];
        else quote = '';
      } else if (character === '\\' && quote === "'" && index + 1 < input.length) {
        output += input[++index];
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === '?') {
      output += `$${++parameter}`;
    } else {
      output += character;
    }
  }
  return output;
}

function normalizeResult(rows) {
  const jsonSafeRows = Array.from(rows, (row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint' && Number.isSafeInteger(Number(value)) ? Number(value) : value,
    ]),
  ));
  return {
    results: jsonSafeRows,
    success: true,
    meta: { changes: Number(rows.count || 0), last_row_id: 0 },
  };
}

class PostgresD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new PostgresD1Statement(this.database, this.sql, values);
  }

  async execute(connection = this.database.client) {
    const rows = await connection.unsafe(translateSql(this.sql), this.values);
    return normalizeResult(rows);
  }

  async first() {
    const result = await this.execute();
    return result.results[0] ?? null;
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }
}

export class PostgresD1Adapter {
  constructor(client) {
    this.client = client;
    this.maxBindParameters = 60000;
    this.materialImportChunkSize = 2000;
    this.materialCommitBatchSize = 5000;
  }

  prepare(sql) {
    return new PostgresD1Statement(this, sql);
  }

  async batch(statements) {
    return this.client.begin(async (transaction) => Promise.all(
      statements.map((statement) => statement.execute(transaction)),
    ));
  }
}

export const __postgresAdapterTest__ = { translateSql };
