import type { Hass } from "../types-hass";

(window as any).d3_card_entity_cache =
  (window as any).d3_card_entity_cache ?? {};
const cache = (window as any).d3_card_entity_cache;

export async function getAreas(hass: Hass) {
  cache.areas =
    cache.areas ?? hass.callWS({ type: "config/area_registry/list" });
  return cache.areas;
}

export function cached_areas() {
  return cache.areas;
}

export async function getDevices(hass: Hass) {
  cache.devices =
    cache.devices ?? hass.callWS({ type: "config/device_registry/list" });
  return cache.devices;
}

export function cached_devices() {
  return cache.devices;
}

export async function getEntities(hass: Hass) {
  cache.entities =
    cache.entities ?? hass.callWS({ type: "config/entity_registry/list" });
  return cache.entities;
}

export function cached_entities() {
  return cache.entities;
}

export async function getLabels(hass: Hass) {
  cache.labels =
    cache.labels ?? hass.callWS({ type: "config/label_registry/list" });
  return cache.labels;
}
