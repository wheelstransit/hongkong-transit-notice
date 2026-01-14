export interface Notice {
  id: string;
  pdfUrl: string;
  route: string;
  discoveredAt: Date;
  isActive: boolean;
  lastSeenAt?: Date;
}

export interface CompanyMetadata {
  name: string;
  code: 'KMB' | 'CTB' | 'NWFB';
}

export interface Route {
  route: string;
  bound?: number;
}
