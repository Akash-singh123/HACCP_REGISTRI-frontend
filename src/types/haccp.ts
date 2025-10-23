export interface HaccpRecord {
    id: string;
    date: string; // YYYY-MM-DD format
    temperatures: {
      freezer: number; // -18 to -22°C
      fridge1: number; // 0 to 4°C
      fridge2: number; // 0 to 4°C
    };
    cleaning: {
      equipment: boolean;
      surfaces: boolean;
      utensils: boolean;
      floors: boolean;
      refrigerators: boolean;
      walls: boolean;
      lighting: boolean;
      doors: boolean;
      shelves: boolean;
      toilets: boolean;
      wasteContainers: boolean;
      ovens: boolean;
    };
    notes?: string;
    signature?: string; // base64 image
    createdAt: string;
    updatedAt: string;
  }
  
  export interface CompanyInfo {
    name: string;
    piva: string;
    address?: string;
  }
  
  export interface HaccpSettings {
    company: CompanyInfo;
    defaultSignature?: string;
  }
  
  export interface GenerationRequest {
    startDate: string;
    endDate: string;
    signature: string;
    company: CompanyInfo;
  }