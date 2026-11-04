// The PWA's palette and sizes (web/src/app/m/ui.tsx), so the app looks like
// the /m pages field users know.
export const colors = {
  brand: "#3a3cd6",
  brandLight: "#4547e0",
  ink: "#0b1426",
  muted: "#5b6480",
  subtle: "#7a8190",
  line: "#e6e8f0",
  border: "#d5d9e4",
  page: "#f4f5fa",
  white: "#ffffff",
  green: "#2fa43f",
  done: "#3bb54a",
  blue: "#0b86d8",
  grey: "#6b7280",
  red: "#d92d20",
  redSoft: "#fdedec",
  redText: "#b42318",
  off: "#e5384b",
  amber: "#a4570a",
  orange: "#d97706",
  pressed: "#eef0fb",
  disabledBg: "#f0f1f4",
};

export const STATUS_COLOURS: Record<string, string> = {
  new: colors.grey,
  in_progress: colors.blue,
  completed: colors.done,
};

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  in_progress: "In Progress",
  completed: "Completed",
};
