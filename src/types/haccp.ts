export type EquipmentKind = 'freezer' | 'fridge';

/** Attrezzatura di conservazione dell'azienda (frigorifero o congelatore). */
export interface Equipment {
  id: string;
  kind: EquipmentKind;
  name: string;
  position: number;
}

/** Esito di una voce del piano di sanificazione nella checklist di una giornata. */
export interface CleaningCheck {
  itemId: string;
  area: string;
  activity: string;
  done: boolean;
}

export interface HaccpRecord {
    id: string;
    date: string; // YYYY-MM-DD format
    /**
     * Sede a cui appartiene il registro. Con più sedi l'identità del registro
     * giornaliero è (sede, data); le aziende a sede unica usano la predefinita.
     */
    locationId?: string;
    /**
     * Mappa dinamica delle temperature rilevate: chiave = id attrezzatura,
     * valore = temperatura in °C. I registri storici usano le chiavi
     * {freezer, fridge1, fridge2}, mantenute come id delle attrezzature di default.
     */
    temperatures: Record<string, number>;
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
    /**
     * Esito della checklist guidata del piano di sanificazione (opzionale:
     * assente nei registri storici, che restano leggibili).
     */
    cleaningPlan?: CleaningCheck[];
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