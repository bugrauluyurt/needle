import type { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

export type DatabaseColumn = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

export type DatabaseIndex = {
  name: string;
  unique: number;
};

export type DatabaseIndexColumn = {
  name: string;
};
