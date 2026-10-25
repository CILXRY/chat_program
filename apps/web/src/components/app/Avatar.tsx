import type { User } from '../../lib/types';

interface Props {
  user: Pick<User, 'display_name' | 'avatar_color'>;
  size?: number;
  online?: boolean;
  className?: string;
}

export default function Avatar({ user, size = 36, online, className = '' }: Props) {
  const initial =
    Array.from(user.display_name.trim())[0]?.toUpperCase() || '?';
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center rounded-full border font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.38)),
        color: user.avatar_color,
        borderColor: `${user.avatar_color}44`,
        background: `linear-gradient(145deg, ${user.avatar_color}2e, ${user.avatar_color}0d)`,
      }}
      title={user.display_name}
      aria-hidden="true"
    >
      {initial}
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-base-900 ${
            online ? 'bg-mint-400' : 'bg-mist-600'
          }`}
          style={{ width: Math.max(9, Math.round(size * 0.28)), height: Math.max(9, Math.round(size * 0.28)) }}
        />
      )}
    </span>
  );
}
