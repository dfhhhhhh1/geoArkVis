export interface Dataset {
  id: string;
  title: string;
  description: string;
  source: string;
  fields: string[];
  tags: string[];
  fileSize: string;
  lastUpdated: string;
  coverage: {
    geographic: string;
    temporal: string;
  };
  coordinates: {
    lat: number;
    lng: number;
  };
  boundingBox: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  downloadUrl: string;
  previewUrl?: string;
}

export interface CartItem {
  dataset: Dataset;
  quantity: number;
  addedAt: Date;
}

export interface SearchFilters {
  dataType?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  geographicArea?: string;
  fileFormat?: string[];
}