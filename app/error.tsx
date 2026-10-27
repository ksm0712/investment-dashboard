"use client";

import { useEffect } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("Thesis workspace render failed", error);
  }, [error]);

  return (
    <main className="load-error-page">
      <div className="load-error-card">
        <img className="system-state-mark" src="/icon.svg" alt="" />
        <CircleAlert size={22} />
        <div className="eyebrow">Workspace interrupted</div>
        <h1>Something stopped this view.</h1>
        <p>Your saved portfolio was not changed. Retry the workspace; if the problem continues, refresh the browser.</p>
        <button className="primary-btn" onClick={retry}><RotateCcw size={15} /> Retry workspace</button>
      </div>
    </main>
  );
}
