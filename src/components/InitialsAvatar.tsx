import { useState } from 'react';
import { clientColor, clientInitials, clientLogoUrl } from '../lib/clientAvatar.js';
import { cn } from '../lib/utils.js';

interface InitialsAvatarProps {
  name: string;
  /** Stable key for the colour (defaults to the name). */
  seed?: string;
  /** Logo URL; empty, null or a legacy generated-placeholder URL renders the local initials instead. */
  logo?: string | null;
  /** True when the name is already shown next to the avatar (hides it from assistive technology). */
  decorative?: boolean;
  /** Size, shape and text size; defaults fill the parent and inherit its radius. */
  className?: string;
}

/** Logo image, or a local coloured square with the client's initials. Never requests a third-party host. */
export function InitialsAvatar({ name, seed, logo, decorative = false, className }: InitialsAvatarProps) {
  const logoUrl = clientLogoUrl(logo);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': name };

  if (logoUrl && failedUrl !== logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={decorative ? '' : name}
        className={cn('size-full rounded-[inherit] object-cover bg-white', className)}
        onError={() => setFailedUrl(logoUrl)}
      />
    );
  }
  return (
    <span
      {...a11y}
      style={{ backgroundColor: clientColor(seed ?? name), color: '#ffffff' }}
      className={cn(
        'size-full rounded-[inherit] flex items-center justify-center text-xs font-bold tracking-wide select-none',
        className,
      )}
    >
      {clientInitials(name)}
    </span>
  );
}
