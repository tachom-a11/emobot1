export const BATTERY_EMPTY_VOLTS = 6.5;
export const BATTERY_FULL_VOLTS = 8.4;

export const batteryPercentFromVolts = (volts) => {
  if (!Number.isFinite(volts)) return null;
  const p = (volts - BATTERY_EMPTY_VOLTS) / (BATTERY_FULL_VOLTS - BATTERY_EMPTY_VOLTS);
  return Math.max(0, Math.min(1, p));
};

