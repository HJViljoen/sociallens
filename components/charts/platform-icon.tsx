// Tiny stroke glyphs for the platforms we track — inline SVG, 16-unit grid,
// recolour with currentColor. Not brand marks: just enough shape to scan.

const PATHS: Record<string, string> = {
  tiktok: '<path d="M14 3v10.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3a5 5 0 0 0 5 5"/>',
  youtube: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><path d="M16.5 7.5h.01"/>',
  reddit: '<circle cx="12" cy="13" r="7"/><circle cx="9.5" cy="13" r=".8"/><circle cx="14.5" cy="13" r=".8"/><path d="M9.5 16c1.5 1 3.5 1 5 0"/><path d="M12 6l1.5-3 3 1"/>',
}

export function PlatformIcon({ platform, size = 12, className }: { platform: string; size?: number; className?: string }) {
  const d = PATHS[platform]
  if (!d) return <span className="inline-block size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} className={className}
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: d }}
    />
  )
}
