import { createContext, useContext, type ReactNode } from 'react';
import type { DataSource } from './source';

const DataContext = createContext<DataSource | null>(null);

export function DataProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  return <DataContext.Provider value={source}>{children}</DataContext.Provider>;
}

export function useDataSource(): DataSource {
  const source = useContext(DataContext);
  if (!source) throw new Error('useDataSource must be used inside DataProvider');
  return source;
}
