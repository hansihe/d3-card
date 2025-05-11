export interface Hass {
  states: HassState;
  callWS: (config: any) => Promise<any>;
  // Simplified
}

export interface HassState {
  [key: string]: HassEntityState;
}

export interface HassEntityState {
  entity_id: string;
  last_changed: string;
  last_updated: string;
  state: string;
  attributes: Record<string, string>;
  context: any;
}
