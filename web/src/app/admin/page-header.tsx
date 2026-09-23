export function PageHeader({
  breadcrumb,
  title,
  actions,
}: {
  breadcrumb: string;
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-6 pb-2 md:px-8 md:pt-8">
      <div className="flex flex-col gap-1">
        <div className="text-[13px] text-muted">{breadcrumb}</div>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-ink">
          {title}
        </h1>
      </div>
      {actions && <div className="flex gap-2.5">{actions}</div>}
    </div>
  );
}
