// Adapted from https://github.com/thomasloven/lovelace-auto-entities (MIT)

import { FilterEntry } from "../types-config";
import { Hass, HassEntityState } from "../types-hass";
import { getAreas, getDevices, getEntities, getLabels } from "./hass";

const ago_suffix_regex = /([mhd])\s+ago\s*$/i;
const default_ago_suffix = "m ago";

const RULES: Record<
  string,
  (hass: Hass, value: any) => Promise<(entity: HassEntityState) => boolean>
> = {
  domain: async (_hass, value) => {
    const match = await matcher(value);
    return (entity) => match(entity.entity_id.split(".")[0]);
  },
  entity_id: async (_hass, value) => {
    const match = await matcher(value);
    return (entity) => match(entity.entity_id);
  },
  state: async (_hass, value) => {
    const match = await matcher(value);
    return (entity) => match(entity.state);
  },
  name: async (_hass, value) => {
    const match = await matcher(value);
    return (entity) => match(entity.attributes?.friendly_name);
  },
  group: async (hass, value) => (entity) => {
    return hass.states[value]?.attributes?.entity_id?.includes(
      entity.entity_id,
    );
  },
  attributes: async (_hass, value) => {
    value as Record<string, any>;
    const matchers = await Promise.all(
      Object.entries(value).map(async ([k, v]) => {
        const attr = k.split(" ")[0];
        const prepare = (obj) => attr.split(":").reduce((a, x) => a?.[x], obj);
        const match = await matcher(v);
        return { prepare, match };
      }),
    );

    return (entity) =>
      matchers.every(({ prepare, match }) => match(prepare(entity.attributes)));
  },
  not: async (hass, value) => {
    const filter = await getFilter(hass, value);
    return (entity) => !filter(entity.entity_id);
  },
  and: async (hass, value) => {
    const filters = await Promise.all(value.map((v) => getFilter(hass, v)));
    return (entity) => filters.every((x) => x(entity.entity_id));
  },
  or: async (hass, value) => {
    const filters = await Promise.all(value.map((v) => getFilter(hass, v)));
    return (entity) => filters.some((x) => x(entity.entity_id));
  },
  device: async (hass, value) => {
    const [match, entities, devices] = await Promise.all([
      matcher(value),
      getEntities(hass),
      getDevices(hass),
    ]);

    return (entity) => {
      const ent = entities.find((e) => e.entity_id === entity.entity_id);
      if (!ent) return false;
      const dev = devices.find((d) => d.id === ent.device_id);
      if (!dev) return false;
      return match(dev.name_by_user) || match(dev.name);
    };
  },
  device_manufacturer: async (hass, value) => {
    const [match, entities, devices] = await Promise.all([
      matcher(value),
      getEntities(hass),
      getDevices(hass),
    ]);

    return (entity) => {
      const ent = entities.find((e) => e.entity_id === entity.entity_id);
      if (!ent) return false;
      const dev = devices.find((d) => d.id === ent.device_id);
      if (!dev) return false;
      return match(dev.manufacturer);
    };
  },
  device_model: async (hass, value) => {
    const [match, entities, devices] = await Promise.all([
      matcher(value),
      getEntities(hass),
      getDevices(hass),
    ]);
    return (entity) => {
      const ent = entities.find((e) => e.entity_id === entity.entity_id);
      if (!ent) return false;
      const dev = devices.find((d) => d.id === ent.device_id);
      if (!dev) return false;
      return match(dev.model);
    };
  },
  area: async (hass, value) => {
    const [match, entities, devices, areas] = await Promise.all([
      matcher(value),
      getEntities(hass),
      getDevices(hass),
      getAreas(hass),
    ]);

    return (entity) => {
      const ent = entities.find((e) => e.entity_id === entity.entity_id);
      if (!ent) return false;
      let area = areas.find((a) => a.area_id === ent.area_id);
      if (area) return match(area.name) || match(area.area_id);
      const dev = devices.find((d) => d.id === ent.device_id);
      if (!dev) return false;
      area = areas.find((a) => a.area_id === dev.area_id);
      if (!area) return false;
      return match(area.name) || match(area.area_id);
    };
  },
  entity_category: async (hass, value) => {
    const [match, entities] = await Promise.all([
      matcher(value),
      getEntities(hass),
    ]);

    return (entity) => {
      const ent = entities.find((e) => e.entity_id === entity.entity_id);
      if (!ent) return false;
      return match(ent.entity_category);
    };
  },
  last_changed: async (_hass, value) => {
    if (!ago_suffix_regex.test(value)) value = value + default_ago_suffix;
    const match = await matcher(value);
    return (entity) => match(entity.last_changed);
  },
  last_updated: async (_hass, value) => {
    if (!ago_suffix_regex.test(value)) value = value + default_ago_suffix;
    const match = await matcher(value);
    return (entity) => match(entity.last_updated);
  },
  last_triggered: async (_hass, value) => {
    if (!ago_suffix_regex.test(value)) value = value + default_ago_suffix;
    const match = await matcher(value);
    return (entity) => match(entity.attributes.last_triggered);
  },
  integration: async (hass, value) => {
    const [match, entities] = await Promise.all([
      matcher(value),
      getEntities(hass),
    ]);

    return (entity) => {
      const ent = entities.find((e) => e.entity_id === entity.entity_id);
      if (!ent) return false;
      return match(ent.platform);
    };
  },
  hidden_by: async (hass, value) => {
    const [match, entities] = await Promise.all([
      matcher(value),
      getEntities(hass),
    ]);

    return (entity) => {
      const ent = entities.find((e) => e.entity_id === entity.entity_id);
      if (!ent) return false;
      return match(ent.hidden_by);
    };
  },
  label: async (hass, value) => {
    const [match, entities, devices, labels] = await Promise.all([
      matcher(value),
      getEntities(hass),
      getDevices(hass),
      getLabels(hass),
    ]);

    const match_label = (lbl) => {
      if (match(lbl)) return true;
      const label = labels.find((l) => l.label_id === lbl);
      return match(label?.name);
    };

    return (entity) => {
      const ent = entities.find((e) => e.entity_id === entity.entity_id);

      if (!ent) return false;
      if (!ent.labels) return false;
      if (ent.labels.some(match_label)) return true;

      const dev = devices.find((d) => d.id === ent.device_id);
      if (!dev) return false;
      return dev.labels.some(match_label);
    };
  },
};

export async function getFilter(
  hass: Hass,
  filter: FilterEntry,
): Promise<(entity: string) => boolean> {
  const rules = (
    await Promise.all(
      Object.entries(filter).map(([rule, value]) => {
        rule = rule.trim().split(" ")[0].trim();
        return RULES[rule]?.(hass, value);
      }),
    )
  ).filter(Boolean);

  return (entity: string) => {
    if (!rules.length) return false;
    //if (typeof entity !== "string") entity = entity.entity;
    if (!entity) return false;
    const hass_entity = hass?.states?.[entity];
    if (!hass_entity) return false;
    return rules.every((x) => x(hass_entity));
  };
}

export async function matcher(pattern: any): Promise<(value: any) => boolean> {
  const matchers: Function[] = [];
  const transforms: Function[] = [];

  if (typeof pattern === "string") {
    if (pattern.startsWith("$$")) {
      pattern = pattern.substring(2);
      transforms.push(JSON.stringify);
    }

    // Regular expression match
    if (
      (pattern.startsWith("/") && pattern.endsWith("/")) ||
      pattern.indexOf("*") !== -1
    ) {
      // Convert globs to regex
      if (!pattern.startsWith("/")) {
        pattern = pattern.replace(/\./g, ".").replace(/\*/g, ".*");
        pattern = `/^${pattern}$/`;
      }

      const regex = new RegExp(pattern.slice(1, -1));
      matchers.push((value) =>
        typeof value === "string" ? regex.test(value) : false,
      );
    }

    // Convert timestamps if pattern ends with "X ago"
    const time_match = ago_suffix_regex.exec(pattern);
    if (time_match) {
      pattern = pattern.replace(time_match[0], "");
      const now = new Date().getTime();
      transforms.push((value) => {
        const updated = new Date(value).getTime();
        const diff = (now - updated) / 60000; // minutes
        const period = time_match[1];
        if (period === "h") {
          return diff / 60;
        } else if (period === "d") {
          return diff / 60 / 24;
        }
        return diff;
      });
    }

    if (pattern.startsWith("<=")) {
      const parameter = parseFloat(pattern.substring(2));
      matchers.push((value) => parseFloat(value) <= parameter);
    }
    if (pattern.startsWith(">=")) {
      const parameter = parseFloat(pattern.substring(2));
      matchers.push((value) => parseFloat(value) >= parameter);
    }
    if (pattern.startsWith("==")) {
      const parameter = parseFloat(pattern.substring(2));
      matchers.push((value) => parseFloat(value) == parameter);
    }
    if (pattern.startsWith("!=")) {
      const parameter = parseFloat(pattern.substring(2));
      matchers.push((value) => parseFloat(value) != parameter);
    }
    if (pattern.startsWith("<")) {
      const parameter = parseFloat(pattern.substring(1));
      matchers.push((value) => parseFloat(value) < parameter);
    }
    if (pattern.startsWith(">")) {
      const parameter = parseFloat(pattern.substring(1));
      matchers.push((value) => parseFloat(value) > parameter);
    }
    if (pattern.startsWith("!")) {
      const parameter = parseFloat(pattern.substring(1));
      matchers.push((value) => parseFloat(value) != parameter);
    }
    if (pattern.startsWith("=")) {
      const parameter = parseFloat(pattern.substring(1));
      matchers.push((value) => parseFloat(value) == parameter);
    }

    matchers.push((value) => value === pattern);
  } else {
    matchers.push((value) => value === pattern);
  }

  return (value: any) => {
    const transformed = transforms.reduce((a, x) => x(a), value);
    if (transformed === undefined) return false;
    // if (transformed === null) return false;
    return matchers.some((x) => x(transformed));
  };
}
