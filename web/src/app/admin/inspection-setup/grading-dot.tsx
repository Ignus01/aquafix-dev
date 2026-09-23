// Colour badge for a Grading (the source app's Masterdata.SNIP_Grading).
export function GradingDot({ colour }: { colour: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 shrink-0 rounded-full border border-black/10"
      style={{ background: colour ?? "transparent" }}
    />
  );
}
