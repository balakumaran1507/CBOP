// Next.js renders this automatically as the Suspense fallback while the
// landing page's server component (app/page.tsx) awaits the session check.
// The app's own loading screen, distinct from CBOP's - per the original ask,
// this needs to feel like its own product, not a page inside the dashboard.
export default function Loading() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-border border-t-blue animate-spin" />
        <p className="font-display font-semibold text-sm text-text2">CBOP Accounting</p>
      </div>
    </main>
  )
}
