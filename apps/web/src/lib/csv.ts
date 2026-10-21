export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header || header.every((value) => value.trim() === "")) {
    throw new Error("The CSV needs a header row");
  }
  const keys = header.map((value) => value.trim());
  return rows
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values) => {
      const record: CsvRow = {};
      keys.forEach((key, index) => {
        if (!key) return;
        record[key] = values[index] ?? "";
      });
      return record;
    });
}

export function column(row: CsvRow, name: string) {
  const match = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? row[match] ?? "" : "";
}

export function hasColumn(rows: CsvRow[], name: string) {
  return rows.some((row) =>
    Object.keys(row).some((key) => key.toLowerCase() === name.toLowerCase()),
  );
}
