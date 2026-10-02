/** Accessible placeholder shown while a lazily loaded section downloads. */
export function TabSkeleton() {
  return (
    <div role="status" aria-label="Cargando…" className="animate-pulse space-y-6">
      <div className="h-8 w-1/3 rounded-xl bg-slate-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-28 rounded-2xl bg-slate-200" />
        ))}
      </div>
      <div className="h-72 rounded-2xl bg-slate-200" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
