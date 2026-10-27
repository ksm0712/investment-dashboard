export default function Loading() {
  return (
    <main className="loading-page" aria-live="polite" aria-busy="true">
      <img className="system-state-mark loading" src="/icon.svg" alt="" />
      <span>Preparing your portfolio</span>
    </main>
  );
}
