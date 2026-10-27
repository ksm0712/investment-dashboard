import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="load-error-page">
      <div className="load-error-card">
        <img className="system-state-mark" src="/icon.svg" alt="" />
        <div className="eyebrow">Page not found</div>
        <h1>This page is not part of the workspace.</h1>
        <p>The address may be outdated. Return to the portfolio without changing any saved positions.</p>
        <Link className="primary-btn system-state-link" href="/"><ArrowLeft size={15} /> Return to portfolio</Link>
      </div>
    </main>
  );
}
