export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-start justify-center max-w-3xl mx-auto px-8 py-24">
      <h1 className="text-5xl font-medium tracking-tight" style={{fontFamily: "var(--font-display)"}}>
        DarkOdds
      </h1>
      <p
        className="mt-4 text-sm uppercase tracking-widest"
        style={{fontFamily: "var(--font-mono)", color: "var(--fg-mute)"}}
      >
        Phase F1 skeleton — empty rooms, doors hung
      </p>
    </main>
  );
}
