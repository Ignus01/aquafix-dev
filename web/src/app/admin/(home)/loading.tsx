import { PageHeader } from "../page-header";
import { AttentionSkeleton, BodySkeleton, KeyFiguresSkeleton } from "../dashboard/overview";

// Shown the moment the home page is opened, while the role check runs. In a
// route group so it covers only this page, not the pages under /admin.
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Home" title="Overview" />
      <div className="mx-4 h-[43px] border-b border-border md:mx-8" />
      <div className="h-[57px]" />
      <div className="flex flex-col gap-4 px-4 pt-3 pb-10 md:px-8">
        <AttentionSkeleton />
        <KeyFiguresSkeleton />
        <BodySkeleton />
      </div>
    </div>
  );
}
