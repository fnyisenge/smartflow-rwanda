// Turn-by-turn directions along real roads, using the free OSRM routing service
// (OpenStreetMap road data). SmartFlow picks WHICH corridors to use (based on live
// and predicted congestion); OSRM draws the exact road path and the turns.
// If the service cannot be reached, the app falls back to the straight-line route.

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving/";
const cache = new Map();

const ARROWS = {
  left: "←", "slight left": "↖", "sharp left": "↰",
  right: "→", "slight right": "↗", "sharp right": "↱",
  straight: "↑", uturn: "↶",
};
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

export function formatDistance(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function roadName(step) {
  return step.name || step.ref || "";
}

function describe(step) {
  const { type, modifier, bearing_after: bearing, exit } = step.maneuver;
  const name = roadName(step);
  const onto = name ? ` onto ${name}` : "";
  const on = name ? ` on ${name}` : "";
  const turn = { "slight left": "slightly left", "slight right": "slightly right" }[modifier] || modifier || "";
  switch (type) {
    case "depart":
      return { icon: "↑", text: `Head ${COMPASS[Math.round(((bearing ?? 0) % 360) / 45) % 8]}${on}` };
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      return { icon: "⟳", text: `At the roundabout, take the ${ordinal(exit || 1)} exit${onto}` };
    case "fork":
      return { icon: ARROWS[modifier] || "↑", text: `Keep ${modifier?.includes("left") ? "left" : "right"} at the fork${onto}` };
    case "merge":
      return { icon: ARROWS[modifier] || "↑", text: `Merge${onto}` };
    case "on ramp":
    case "off ramp":
      return { icon: ARROWS[modifier] || "↑", text: `Take the ramp${onto}` };
    case "new name":
    case "continue":
      if (modifier && modifier !== "straight") return { icon: ARROWS[modifier] || "↑", text: `Bear ${modifier.replace("slight ", "")}${onto}` };
      return { icon: "↑", text: `Continue${onto}` };
    case "end of road":
      return { icon: ARROWS[modifier] || "↑", text: `At the end of the road, turn ${turn}${onto}` };
    case "turn":
    default:
      if (modifier === "uturn") return { icon: "↶", text: `Make a U-turn${onto}` };
      if (modifier === "straight") return { icon: "↑", text: `Continue straight${onto}` };
      return { icon: ARROWS[modifier] || "↑", text: `Turn ${turn}${onto}` };
  }
}

function ordinal(n) {
  return ["first", "second", "third", "fourth", "fifth", "sixth"][n - 1] || `${n}th`;
}

/**
 * Get the road path and directions for a SmartFlow route.
 * route.coordinates = [[lat, lng], ...] of the places it passes through; route.via = their names.
 * Returns { line: [[lat, lng]...], distance_m, steps: [{icon, text, distance}], source: "osrm" | "straight" }
 */
export async function getDirections(route) {
  const key = route.coordinates.map((c) => c.join(",")).join(";");
  if (cache.has(key)) return cache.get(key);

  const lonLat = route.coordinates.map(([lat, lng]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${OSRM_URL}${lonLat}?overview=full&geometries=geojson&steps=true`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) throw new Error(data.code || "No route");

    const osrm = data.routes[0];
    const steps = [];
    const legs = osrm.legs;
    legs.forEach((leg, li) => {
      leg.steps.forEach((step, si) => {
        const type = step.maneuver.type;
        const firstLeg = li === 0, lastLeg = li === legs.length - 1;
        if (type === "depart" && !firstLeg) return; // joins the previous leg
        if (type === "arrive") {
          if (lastLeg) steps.push({ icon: "⚑", text: `Arrive at ${route.via[route.via.length - 1]}`, distance: 0 });
          else steps.push({ icon: "•", text: `Pass through ${route.via[li + 1]}`, distance: 0, waypoint: true });
          return;
        }
        if (step.distance < 1 && si > 0) return; // ignore zero-length steps
        const d = describe(step);
        const prev = steps[steps.length - 1];
        // Merge "continue on the same road" into the previous step
        if (prev && !prev.waypoint && d.icon === "↑" && type !== "depart" && prev.road === roadName(step)) {
          prev.distance += step.distance;
          return;
        }
        steps.push({ ...d, distance: step.distance, road: roadName(step) });
      });
    });

    const result = {
      line: osrm.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      distance_m: osrm.distance,
      steps,
      source: "osrm",
    };
    cache.set(key, result);
    return result;
  } catch {
    // Fallback: straight lines between the places, one step per place
    return {
      line: route.coordinates,
      distance_m: route.distance_km * 1000,
      steps: [
        ...route.via.slice(1, -1).map((name) => ({ icon: "•", text: `Go towards ${name}`, distance: 0, waypoint: true })),
        { icon: "⚑", text: `Arrive at ${route.via[route.via.length - 1]}`, distance: 0 },
      ],
      source: "straight",
    };
  }
}