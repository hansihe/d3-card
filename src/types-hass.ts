// Define a basic type for Home Assistant object
export interface Hass {
  states: HassState;
  callWS: (config: any) => Promise<any>;
}

// Define a basic type for Home Assistant state object
export interface HassState {
  [key: string]: any; // Simplified, consider using more specific types from HA
}
