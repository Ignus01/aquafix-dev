// Solid glyphs for the field app (24x24, currentColor).
type P = { className?: string };

function Svg({ className, children }: P & { children: React.ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const HomeIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 2.5 1.5 11.6h3V21h5.7v-6h3.6v6h5.7v-9.4h3L12 2.5Z" />
  </Svg>
);
export const SearchIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="m15 15 6 6" />
  </svg>
);
export const WarningIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 2.5c.7 0 1.4.4 1.8 1l8.3 14.5c.8 1.4-.2 3-1.8 3H3.7c-1.6 0-2.6-1.6-1.8-3L10.2 3.5c.4-.6 1.1-1 1.8-1Zm-1.2 6.2.4 5.6h1.6l.4-5.6h-2.4Zm1.2 7.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z" />
  </Svg>
);
export const ClipboardCheckIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M9 2h6v2h2.5A2.5 2.5 0 0 1 20 6.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-13A2.5 2.5 0 0 1 6.5 4H9V2Zm1.8 1.6v1.8h2.4V3.6h-2.4Zm4.9 8-1.1-1.1-3.4 3.4-1.6-1.6-1.1 1.1 2.7 2.7 4.5-4.5Z" fillRule="evenodd" />
  </Svg>
);
export const ClipboardListIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M9 2h6v2h2.5A2.5 2.5 0 0 1 20 6.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-13A2.5 2.5 0 0 1 6.5 4H9V2Zm1.8 1.6v1.8h2.4V3.6h-2.4ZM8 11a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 8 11Zm3 .2v1.6h5v-1.6h-5ZM8 15.6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm3 .2v1.6h5v-1.6h-5Z" fillRule="evenodd" />
  </Svg>
);
export const WrenchIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M21.4 5.6 18 9l-3-.4-.4-3 3.4-3.4a5.5 5.5 0 0 0-6.9 7L2.7 17.3a2.4 2.4 0 0 0 3.4 3.4l8.1-8.1a5.5 5.5 0 0 0 7.2-7Z" />
  </Svg>
);
export const BuildingShieldIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M2 21V3.5C2 2.7 2.7 2 3.5 2h10c.8 0 1.5.7 1.5 1.5V12h-1v-1.5H11V21H2Zm3-15v2h2V6H5Zm4 0v2h2V6H9ZM5 10v2h2v-2H5Zm0 4v2h2v-2H5Zm10.5-1.5 4.5 1.8v3.9c0 2.6-1.8 4.3-4.5 5.3-2.7-1-4.5-2.7-4.5-5.3v-3.9l4.5-1.8Z" />
  </Svg>
);
export const BoxIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M2 6.5 4.2 3h6.3v6H2V6.5ZM13.5 3h6.3L22 6.5V9h-8.5V3ZM2 11h20v7.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5V11Z" />
  </Svg>
);
export const FilePlusIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H13v6.5A1.5 1.5 0 0 0 14.5 10H18v3.1a6 6 0 0 0-6.6 8.9H6.5A2.5 2.5 0 0 1 4 19.5v-15ZM14.5 2.4 17.6 8h-3.1V2.4ZM17 14a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm-.7 2v1.5h-1.5v1.4h1.5v1.5h1.4v-1.5h1.5v-1.4h-1.5V16h-1.4Z" fillRule="evenodd" />
  </Svg>
);
export const TruckIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M7 4h9v3h3l3 4v5h-2.1a3 3 0 0 0-5.8 0H10.9a3 3 0 0 0-5.8 0H3V8h4V4Zm10 4.5V11h3.2L18.5 8.5H17ZM8 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM1 5h4v1.6H1V5Zm0 3.4h3v1.6H1V8.4Z" fillRule="evenodd" />
  </Svg>
);
export const CalculatorIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M6.5 2h11A2.5 2.5 0 0 1 20 4.5v15a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2ZM7 5v4h10V5H7Zm1 6.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm4 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm4 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM8 15a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 8 15Zm4 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm4 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z" fillRule="evenodd" />
  </Svg>
);
export const PinIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 1.5a7 7 0 0 1 7 7c0 4.7-5.2 11.1-6.2 12.3a1 1 0 0 1-1.6 0C10.2 19.6 5 13.2 5 8.5a7 7 0 0 1 7-7Zm0 4.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z" fillRule="evenodd" />
  </Svg>
);
export const FileIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H14v6.5A1.5 1.5 0 0 0 15.5 10H20v9.5a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 5 19.5v-15ZM15.5 2.4 19.6 8h-4.1V2.4Z" />
  </Svg>
);
export const UserIcon = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="7" r="4.5" />
    <path d="M3.5 21c0-4.5 3.8-7 8.5-7s8.5 2.5 8.5 7H3.5Z" />
  </Svg>
);
export const CommentIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M4.5 3h15A2.5 2.5 0 0 1 22 5.5v9a2.5 2.5 0 0 1-2.5 2.5H11l-5 4v-4H4.5A2.5 2.5 0 0 1 2 14.5v-9A2.5 2.5 0 0 1 4.5 3Z" />
  </Svg>
);
export const ClockIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.5l3.5 2" />
  </svg>
);
export const TagsIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h6c.4 0 .8.2 1.1.4l8.5 8.5c.6.6.6 1.6 0 2.2l-5.5 5.5c-.6.6-1.6.6-2.2 0L2.9 11c-.3-.3-.4-.7-.4-1.1v-5.4ZM7 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm9.3-3 6.1 6.1c.6.6.6 1.6 0 2.2l-4.7 4.7-.9-.9 4.2-4.2c.4-.4.4-1 0-1.4L14.5 3h1.8Z" fillRule="evenodd" />
  </Svg>
);
export const CameraIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M8.5 3 7 5H4.5A2.5 2.5 0 0 0 2 7.5v11A2.5 2.5 0 0 0 4.5 21h15a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 19.5 5H17l-1.5-2h-7ZM12 8.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" fillRule="evenodd" />
  </Svg>
);
export const InfoIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 4.5a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8ZM10.5 11v1.6h1v4.8h-1V19h3.8v-1.6h-1V11h-2.8Z" fillRule="evenodd" />
  </Svg>
);
export const PlusIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M12 4v16M4 12h16" />
  </svg>
);
export const BanIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </svg>
);
export const ChevronLeftIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="m15 4-8 8 8 8" />
  </svg>
);
export const ChevronRightIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="m9 4 8 8-8 8" />
  </svg>
);
export const XIcon = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M5 5l14 14M19 5 5 19" />
  </svg>
);
