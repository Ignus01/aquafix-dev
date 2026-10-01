import { Header, SkeletonList } from "./ui";

// Shown while any /m screen's data loads, so taps respond instantly.
export default function Loading() {
  return (
    <>
      <Header title="Loading…" />
      <SkeletonList />
    </>
  );
}
