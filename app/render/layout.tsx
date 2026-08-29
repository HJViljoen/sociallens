// The export renderer's frame: fonts and tokens come from the root layout;
// none of the dashboard chrome (sidebar, session, access banner) — this is
// what headless Chrome sees, never a person.
export default function RenderLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
