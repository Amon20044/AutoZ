/**
 * @module engine/core/part-taxonomy
 * Canonical car part definitions with comprehensive naming patterns
 * for fuzzy/regex hybrid detection.
 *
 * Each entry contains:
 *   - typeKey: dot-notation identifier
 *   - label: human-friendly name
 *   - category: grouping (body, door, light, wheel, glass, etc.)
 *   - exactTokens: exact word matches (case-insensitive)
 *   - regexPatterns: compiled RegExp patterns
 *   - fuzzyTokens: n-gram / partial match tokens
 *   - defaultInteraction: what this part does
 *   - defaultAxis: hinge rotation axis [x,y,z]
 *   - defaultOpenAngle: degrees
 *   - weight: detection priority weight (higher = prefer this match)
 */

/** @typedef {typeof PART_TAXONOMY[number]} PartDefinition */

export const PART_CATEGORIES = Object.freeze([
  'body', 'door', 'bonnet', 'trunk', 'light', 'wheel', 'rim',
  'mirror', 'glass', 'roof', 'cap', 'spoiler', 'interior', 'bumper', 'grille',
])

export const PART_TAXONOMY = Object.freeze([
  // ─── Body ────────────────────────────────────────────────────
  {
    typeKey: 'body',
    label: 'Body Shell',
    category: 'body',
    exactTokens: ['body', 'shell', 'chassis', 'frame', 'exterior', 'paint', 'bodywork', 'karosserie', 'carrosserie', 'coque', 'bodyshell', 'carbody'],
    regexPatterns: [/\bbod(y|ie)/i, /\bshell/i, /\bchassis/i, /\bpaint/i, /\bexterior/i, /\bkaross/i, /\bcoque/i],
    fuzzyTokens: ['body', 'shell', 'chassis', 'paint', 'exterior'],
    defaultInteraction: 'color_change',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.0,
  },

  // ─── Doors ───────────────────────────────────────────────────
  {
    typeKey: 'door.front.left',
    label: 'Front Left Door',
    category: 'door',
    exactTokens: ['door_fl', 'doorfl', 'door_front_left', 'frontleftdoor', 'driver_door', 'fl_door', 'door_lf', 'tuer_vl', 'porte_avg'],
    regexPatterns: [
      /\bdoor[_.\s-]?f[_.\s-]?l\b/i, /\bdoor[_.\s-]?l[_.\s-]?f\b/i,
      /\bfront[_.\s-]?left[_.\s-]?door/i, /\bleft[_.\s-]?front[_.\s-]?door/i,
      /\bdriver[_.\s-]?door/i, /\bdoor[_.\s-]?driver/i,
      /\bf[_.\s-]?l[_.\s-]?door/i, /\btuer.*v.*l/i,
    ],
    fuzzyTokens: ['door', 'front', 'left', 'driver', 'fl'],
    defaultInteraction: 'hinge_open_close',
    defaultAxis: [0, 1, 0],
    defaultOpenAngle: 65,
    weight: 1.5,
  },
  {
    typeKey: 'door.front.right',
    label: 'Front Right Door',
    category: 'door',
    exactTokens: ['door_fr', 'doorfr', 'door_front_right', 'frontrightdoor', 'passenger_door', 'fr_door', 'door_rf', 'tuer_vr', 'porte_avd'],
    regexPatterns: [
      /\bdoor[_.\s-]?f[_.\s-]?r\b/i, /\bdoor[_.\s-]?r[_.\s-]?f\b/i,
      /\bfront[_.\s-]?right[_.\s-]?door/i, /\bright[_.\s-]?front[_.\s-]?door/i,
      /\bpassenger[_.\s-]?door/i, /\bf[_.\s-]?r[_.\s-]?door/i,
    ],
    fuzzyTokens: ['door', 'front', 'right', 'passenger', 'fr'],
    defaultInteraction: 'hinge_open_close',
    defaultAxis: [0, -1, 0],
    defaultOpenAngle: 65,
    weight: 1.5,
  },
  {
    typeKey: 'door.rear.left',
    label: 'Rear Left Door',
    category: 'door',
    exactTokens: ['door_rl', 'doorrl', 'door_rear_left', 'rearleftdoor', 'rl_door', 'door_lr', 'tuer_hl', 'porte_arg'],
    regexPatterns: [
      /\bdoor[_.\s-]?r[_.\s-]?l\b/i, /\bdoor[_.\s-]?l[_.\s-]?r\b/i,
      /\brear[_.\s-]?left[_.\s-]?door/i, /\bleft[_.\s-]?rear[_.\s-]?door/i,
      /\br[_.\s-]?l[_.\s-]?door/i,
    ],
    fuzzyTokens: ['door', 'rear', 'left', 'rl', 'back'],
    defaultInteraction: 'hinge_open_close',
    defaultAxis: [0, 1, 0],
    defaultOpenAngle: 65,
    weight: 1.5,
  },
  {
    typeKey: 'door.rear.right',
    label: 'Rear Right Door',
    category: 'door',
    exactTokens: ['door_rr', 'doorrr', 'door_rear_right', 'rearrightdoor', 'rr_door', 'tuer_hr', 'porte_ard'],
    regexPatterns: [
      /\bdoor[_.\s-]?r[_.\s-]?r\b/i,
      /\brear[_.\s-]?right[_.\s-]?door/i, /\bright[_.\s-]?rear[_.\s-]?door/i,
      /\br[_.\s-]?r[_.\s-]?door/i,
    ],
    fuzzyTokens: ['door', 'rear', 'right', 'rr', 'back'],
    defaultInteraction: 'hinge_open_close',
    defaultAxis: [0, -1, 0],
    defaultOpenAngle: 65,
    weight: 1.5,
  },

  // ─── Bonnet / Hood ───────────────────────────────────────────
  {
    typeKey: 'bonnet.front',
    label: 'Bonnet / Hood',
    category: 'bonnet',
    exactTokens: ['bonnet', 'hood', 'motorhaube', 'capot', 'engine_cover', 'front_hood', 'front_bonnet'],
    regexPatterns: [/\bbonnet/i, /\bhood\b/i, /\bmotorhaube/i, /\bcapot\b/i, /\bengine[_.\s-]?cover/i],
    fuzzyTokens: ['bonnet', 'hood', 'engine', 'cover', 'capot'],
    defaultInteraction: 'hinge_open_close',
    defaultAxis: [1, 0, 0],
    defaultOpenAngle: -65,
    weight: 1.3,
  },

  // ─── Trunk / Tailgate ────────────────────────────────────────
  {
    typeKey: 'bonnet.rear',
    label: 'Trunk / Tailgate',
    category: 'trunk',
    exactTokens: ['trunk', 'tailgate', 'boot', 'hatch', 'kofferraum', 'coffre', 'rear_lid', 'trunk_lid', 'decklid', 'liftgate'],
    regexPatterns: [/\btrunk/i, /\btailgate/i, /\bboot\b/i, /\bhatch\b/i, /\bkofferraum/i, /\bcoffre/i, /\bdecklid/i, /\bliftgate/i],
    fuzzyTokens: ['trunk', 'tailgate', 'boot', 'hatch', 'rear', 'lid'],
    defaultInteraction: 'hinge_open_close',
    defaultAxis: [1, 0, 0],
    defaultOpenAngle: 60,
    weight: 1.3,
  },

  // ─── Headlights ──────────────────────────────────────────────
  {
    typeKey: 'light.head.front.left',
    label: 'Left Headlight',
    category: 'light',
    exactTokens: ['headlight_l', 'headlight_left', 'hl_left', 'head_light_l', 'scheinwerfer_l', 'phare_g'],
    regexPatterns: [/\bhead[_.\s-]?light[_.\s-]?l/i, /\bl[_.\s-]?head[_.\s-]?light/i, /\bhl[_.\s-]?l/i, /\bleft[_.\s-]?head/i, /\bscheinwerfer.*l/i],
    fuzzyTokens: ['headlight', 'head', 'light', 'left', 'front'],
    defaultInteraction: 'toggle',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.2,
  },
  {
    typeKey: 'light.head.front.right',
    label: 'Right Headlight',
    category: 'light',
    exactTokens: ['headlight_r', 'headlight_right', 'hl_right', 'head_light_r', 'scheinwerfer_r', 'phare_d'],
    regexPatterns: [/\bhead[_.\s-]?light[_.\s-]?r/i, /\br[_.\s-]?head[_.\s-]?light/i, /\bhl[_.\s-]?r/i, /\bright[_.\s-]?head/i, /\bscheinwerfer.*r/i],
    fuzzyTokens: ['headlight', 'head', 'light', 'right', 'front'],
    defaultInteraction: 'toggle',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.2,
  },

  // ─── Taillights ──────────────────────────────────────────────
  {
    typeKey: 'light.tail.rear.left',
    label: 'Left Taillight',
    category: 'light',
    exactTokens: ['taillight_l', 'tail_light_left', 'tl_left', 'rearlight_l', 'ruecklicht_l', 'feu_arriere_g'],
    regexPatterns: [/\btail[_.\s-]?light[_.\s-]?l/i, /\bl[_.\s-]?tail/i, /\brear[_.\s-]?light[_.\s-]?l/i, /\bruecklicht.*l/i, /\bbrake[_.\s-]?l/i],
    fuzzyTokens: ['tail', 'light', 'left', 'rear', 'brake'],
    defaultInteraction: 'toggle',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.2,
  },
  {
    typeKey: 'light.tail.rear.right',
    label: 'Right Taillight',
    category: 'light',
    exactTokens: ['taillight_r', 'tail_light_right', 'tl_right', 'rearlight_r', 'ruecklicht_r', 'feu_arriere_d'],
    regexPatterns: [/\btail[_.\s-]?light[_.\s-]?r/i, /\br[_.\s-]?tail/i, /\brear[_.\s-]?light[_.\s-]?r/i, /\bruecklicht.*r/i, /\bbrake[_.\s-]?r/i],
    fuzzyTokens: ['tail', 'light', 'right', 'rear', 'brake'],
    defaultInteraction: 'toggle',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.2,
  },

  // ─── Indicators ──────────────────────────────────────────────
  {
    typeKey: 'light.indicator.front.left',
    label: 'Front Left Indicator',
    category: 'light',
    exactTokens: ['indicator_fl', 'turn_signal_fl', 'blinker_fl', 'blinker_vl'],
    regexPatterns: [/\b(indicator|turn[_.\s-]?signal|blinker)[_.\s-]?f[_.\s-]?l/i, /\bf[_.\s-]?l[_.\s-]?(indicator|blinker|signal)/i],
    fuzzyTokens: ['indicator', 'turn', 'signal', 'blinker', 'front', 'left'],
    defaultInteraction: 'blink',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.1,
  },
  {
    typeKey: 'light.indicator.front.right',
    label: 'Front Right Indicator',
    category: 'light',
    exactTokens: ['indicator_fr', 'turn_signal_fr', 'blinker_fr', 'blinker_vr'],
    regexPatterns: [/\b(indicator|turn[_.\s-]?signal|blinker)[_.\s-]?f[_.\s-]?r/i, /\bf[_.\s-]?r[_.\s-]?(indicator|blinker|signal)/i],
    fuzzyTokens: ['indicator', 'turn', 'signal', 'blinker', 'front', 'right'],
    defaultInteraction: 'blink',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.1,
  },

  // ─── Wheels ──────────────────────────────────────────────────
  {
    typeKey: 'wheel.front.left',
    label: 'Front Left Wheel',
    category: 'wheel',
    exactTokens: ['wheel_fl', 'tire_fl', 'tyre_fl', 'rad_vl', 'roue_avg'],
    regexPatterns: [/\bwheel[_.\s-]?f[_.\s-]?l/i, /\bf[_.\s-]?l[_.\s-]?wheel/i, /\btire[_.\s-]?f[_.\s-]?l/i, /\bfront[_.\s-]?left[_.\s-]?wheel/i],
    fuzzyTokens: ['wheel', 'tire', 'tyre', 'front', 'left'],
    defaultInteraction: 'spin',
    defaultAxis: [1, 0, 0],
    defaultOpenAngle: 0,
    weight: 1.2,
  },
  {
    typeKey: 'wheel.front.right',
    label: 'Front Right Wheel',
    category: 'wheel',
    exactTokens: ['wheel_fr', 'tire_fr', 'tyre_fr', 'rad_vr', 'roue_avd'],
    regexPatterns: [/\bwheel[_.\s-]?f[_.\s-]?r/i, /\bf[_.\s-]?r[_.\s-]?wheel/i, /\btire[_.\s-]?f[_.\s-]?r/i, /\bfront[_.\s-]?right[_.\s-]?wheel/i],
    fuzzyTokens: ['wheel', 'tire', 'tyre', 'front', 'right'],
    defaultInteraction: 'spin',
    defaultAxis: [1, 0, 0],
    defaultOpenAngle: 0,
    weight: 1.2,
  },
  {
    typeKey: 'wheel.rear.left',
    label: 'Rear Left Wheel',
    category: 'wheel',
    exactTokens: ['wheel_rl', 'tire_rl', 'tyre_rl', 'rad_hl', 'roue_arg'],
    regexPatterns: [/\bwheel[_.\s-]?r[_.\s-]?l/i, /\br[_.\s-]?l[_.\s-]?wheel/i, /\btire[_.\s-]?r[_.\s-]?l/i, /\brear[_.\s-]?left[_.\s-]?wheel/i],
    fuzzyTokens: ['wheel', 'tire', 'tyre', 'rear', 'left'],
    defaultInteraction: 'spin',
    defaultAxis: [1, 0, 0],
    defaultOpenAngle: 0,
    weight: 1.2,
  },
  {
    typeKey: 'wheel.rear.right',
    label: 'Rear Right Wheel',
    category: 'wheel',
    exactTokens: ['wheel_rr', 'tire_rr', 'tyre_rr', 'rad_hr', 'roue_ard'],
    regexPatterns: [/\bwheel[_.\s-]?r[_.\s-]?r/i, /\br[_.\s-]?r[_.\s-]?wheel/i, /\btire[_.\s-]?r[_.\s-]?r/i, /\brear[_.\s-]?right[_.\s-]?wheel/i],
    fuzzyTokens: ['wheel', 'tire', 'tyre', 'rear', 'right'],
    defaultInteraction: 'spin',
    defaultAxis: [1, 0, 0],
    defaultOpenAngle: 0,
    weight: 1.2,
  },

  // ─── Rims ────────────────────────────────────────────────────
  {
    typeKey: 'rim.front.left',
    label: 'Front Left Rim',
    category: 'rim',
    exactTokens: ['rim_fl', 'hubcap_fl', 'felge_vl'],
    regexPatterns: [/\brim[_.\s-]?f[_.\s-]?l/i, /\bf[_.\s-]?l[_.\s-]?rim/i],
    fuzzyTokens: ['rim', 'hub', 'alloy', 'front', 'left'],
    defaultInteraction: 'color_change',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.0,
  },

  // ─── Mirrors ─────────────────────────────────────────────────
  {
    typeKey: 'mirror.left',
    label: 'Left Mirror',
    category: 'mirror',
    exactTokens: ['mirror_l', 'mirror_left', 'side_mirror_l', 'wing_mirror_l', 'spiegel_l', 'retroviseur_g'],
    regexPatterns: [/\bmirror[_.\s-]?l/i, /\bl[_.\s-]?mirror/i, /\bleft[_.\s-]?(side[_.\s-]?)?mirror/i, /\bwing[_.\s-]?mirror[_.\s-]?l/i],
    fuzzyTokens: ['mirror', 'side', 'wing', 'left'],
    defaultInteraction: 'fold',
    defaultAxis: [0, 1, 0],
    defaultOpenAngle: -80,
    weight: 1.1,
  },
  {
    typeKey: 'mirror.right',
    label: 'Right Mirror',
    category: 'mirror',
    exactTokens: ['mirror_r', 'mirror_right', 'side_mirror_r', 'wing_mirror_r', 'spiegel_r', 'retroviseur_d'],
    regexPatterns: [/\bmirror[_.\s-]?r/i, /\br[_.\s-]?mirror/i, /\bright[_.\s-]?(side[_.\s-]?)?mirror/i, /\bwing[_.\s-]?mirror[_.\s-]?r/i],
    fuzzyTokens: ['mirror', 'side', 'wing', 'right'],
    defaultInteraction: 'fold',
    defaultAxis: [0, -1, 0],
    defaultOpenAngle: 80,
    weight: 1.1,
  },

  // ─── Glass / Windows ────────────────────────────────────────
  {
    typeKey: 'glass.windshield',
    label: 'Windshield',
    category: 'glass',
    exactTokens: ['windshield', 'windscreen', 'frontglass', 'front_glass', 'windschutzscheibe', 'pare_brise'],
    regexPatterns: [/\bwindshi?eld/i, /\bwindscreen/i, /\bfront[_.\s-]?glass/i],
    fuzzyTokens: ['windshield', 'windscreen', 'front', 'glass'],
    defaultInteraction: 'tint',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.0,
  },
  {
    typeKey: 'glass.rear',
    label: 'Rear Window',
    category: 'glass',
    exactTokens: ['rear_glass', 'rear_window', 'back_glass', 'heckscheibe', 'lunette_arriere'],
    regexPatterns: [/\brear[_.\s-]?(glass|window)/i, /\bback[_.\s-]?(glass|window)/i, /\bheckscheibe/i],
    fuzzyTokens: ['rear', 'window', 'glass', 'back'],
    defaultInteraction: 'tint',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 1.0,
  },
  {
    typeKey: 'glass.side',
    label: 'Side Windows',
    category: 'glass',
    exactTokens: ['side_glass', 'side_window', 'window_glass', 'seitenscheibe'],
    regexPatterns: [/\bside[_.\s-]?(glass|window)/i, /\bwindow[_.\s-]?glass/i, /\bglass\b/i],
    fuzzyTokens: ['side', 'window', 'glass'],
    defaultInteraction: 'tint',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 0.8, // lower weight — "glass" is generic
  },

  // ─── Roof / Sunroof ─────────────────────────────────────────
  {
    typeKey: 'roof.sunroof',
    label: 'Sunroof',
    category: 'roof',
    exactTokens: ['sunroof', 'moonroof', 'panoramic_roof', 'schiebedach', 'toit_ouvrant'],
    regexPatterns: [/\bsun[_.\s-]?roof/i, /\bmoon[_.\s-]?roof/i, /\bpanoramic/i, /\bschiebedach/i],
    fuzzyTokens: ['sunroof', 'moonroof', 'panoramic', 'roof', 'open'],
    defaultInteraction: 'slide',
    defaultAxis: [0, 0, 1],
    defaultOpenAngle: 0,
    weight: 1.0,
  },

  // ─── Fuel / Charge Caps ──────────────────────────────────────
  {
    typeKey: 'cap.fuel',
    label: 'Fuel Cap',
    category: 'cap',
    exactTokens: ['fuel_cap', 'gas_cap', 'filler_cap', 'fuel_door', 'gas_door', 'tankdeckel', 'trappe_essence'],
    regexPatterns: [/\bfuel[_.\s-]?(cap|door|lid)/i, /\bgas[_.\s-]?(cap|door|lid)/i, /\bfiller/i, /\btankdeckel/i],
    fuzzyTokens: ['fuel', 'gas', 'cap', 'filler', 'tank'],
    defaultInteraction: 'hinge_open_close',
    defaultAxis: [0, 1, 0],
    defaultOpenAngle: 90,
    weight: 1.0,
  },
  {
    typeKey: 'cap.charge',
    label: 'Charging Port',
    category: 'cap',
    exactTokens: ['charge_port', 'charging_port', 'ev_port', 'charge_cap', 'charge_door', 'ladeklappe'],
    regexPatterns: [/\bcharg(e|ing)[_.\s-]?(port|cap|door|lid)/i, /\bev[_.\s-]?port/i, /\bladeklappe/i],
    fuzzyTokens: ['charge', 'charging', 'port', 'ev', 'electric'],
    defaultInteraction: 'hinge_open_close',
    defaultAxis: [0, 1, 0],
    defaultOpenAngle: 90,
    weight: 1.0,
  },

  // ─── Spoiler ─────────────────────────────────────────────────
  {
    typeKey: 'spoiler',
    label: 'Spoiler',
    category: 'spoiler',
    exactTokens: ['spoiler', 'rear_wing', 'wing', 'heckspoiler', 'becquet', 'rear_spoiler'],
    regexPatterns: [/\bspoiler/i, /\brear[_.\s-]?wing/i, /\bheckspoiler/i, /\bbecquet/i],
    fuzzyTokens: ['spoiler', 'wing', 'rear'],
    defaultInteraction: 'extend',
    defaultAxis: [1, 0, 0],
    defaultOpenAngle: 25,
    weight: 1.0,
  },

  // ─── Bumpers ─────────────────────────────────────────────────
  {
    typeKey: 'bumper.front',
    label: 'Front Bumper',
    category: 'bumper',
    exactTokens: ['front_bumper', 'bumper_front', 'stossstange_vorne', 'pare_chocs_avant'],
    regexPatterns: [/\bfront[_.\s-]?bumper/i, /\bbumper[_.\s-]?front/i],
    fuzzyTokens: ['bumper', 'front'],
    defaultInteraction: 'none',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 0.8,
  },
  {
    typeKey: 'bumper.rear',
    label: 'Rear Bumper',
    category: 'bumper',
    exactTokens: ['rear_bumper', 'bumper_rear', 'stossstange_hinten', 'pare_chocs_arriere'],
    regexPatterns: [/\brear[_.\s-]?bumper/i, /\bbumper[_.\s-]?rear/i],
    fuzzyTokens: ['bumper', 'rear', 'back'],
    defaultInteraction: 'none',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 0.8,
  },

  // ─── Grille ──────────────────────────────────────────────────
  {
    typeKey: 'grille',
    label: 'Grille',
    category: 'grille',
    exactTokens: ['grille', 'grill', 'front_grille', 'kuehlergrill', 'calandre', 'radiator_grille'],
    regexPatterns: [/\bgrill(e)?\b/i, /\bkuehlergrill/i, /\bcalandre/i, /\bradiator/i],
    fuzzyTokens: ['grille', 'grill', 'radiator', 'front'],
    defaultInteraction: 'none',
    defaultAxis: null,
    defaultOpenAngle: 0,
    weight: 0.8,
  },
])

/**
 * Build a lookup map from typeKey → PartDefinition for O(1) access.
 * @returns {Map<string, PartDefinition>}
 */
export function buildTaxonomyMap() {
  const map = new Map()
  for (const def of PART_TAXONOMY) {
    map.set(def.typeKey, def)
  }
  return map
}

/** Get all part definitions for a given category */
export function getPartsByCategory(category) {
  return PART_TAXONOMY.filter((p) => p.category === category)
}
