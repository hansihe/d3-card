export function parseHistorySpanToMs(spanString: string): number {
  const durationParts = spanString.match(/(\d+)([smhdwySMHDWY]|mo|MO)/);
  if (!durationParts) {
    console.error(`Invalid history span format: ${spanString}`);
    return 0; // Or throw error
  }

  let secondsToGoBack = parseInt(durationParts[1], 10);
  const unit = durationParts[2].toLowerCase();
  switch (unit) {
    case "s":
      break;
    case "m":
      secondsToGoBack *= 60;
      break;
    case "h":
      secondsToGoBack *= 3600;
      break;
    case "d":
      secondsToGoBack *= 86400;
      break;
    case "w":
      secondsToGoBack *= 604800;
      break;
    case "mo":
      secondsToGoBack *= 86400 * 30;
      break; // Approximation for month
    case "y":
      secondsToGoBack *= 86400 * 365;
      break; // Approximation for year
    default:
      console.error(`Unknown history span unit: ${unit} in ${spanString}`);
      return 0; // Or throw error
  }
  return secondsToGoBack * 1000;
}
