interface Props {
  size?: number;
  className?: string;
}

export default function BrandGlyph({ size = 40, className = '' }: Props) {
  return (
    <span
      className={`relative grid place-items-center rounded-2xl bg-gradient-to-br from-accent-400 via-accent-500 to-[#4b37c6] shadow-[0_10px_30px_-12px_rgba(139,124,255,0.9)] ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3.2" fill="white" stroke="none" />
        <ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-28 12 12)" opacity="0.9" />
        <circle cx="19" cy="6.6" r="1.15" fill="white" stroke="none" />
      </svg>
    </span>
  );
}
