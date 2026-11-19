import React, { useEffect, useState } from "react";

// Animated loading screen shown while the session is checked (and while a sleeping server wakes up).
export default function Splash({ error = false, onRetry }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="splash" role="status" aria-live="polite">
      <div className="splash-logo" aria-hidden="true">
        <span className="splash-ring" />
        <span className="splash-ring splash-ring-2" />
        <span className="splash-mark">
          <svg viewBox="0 0 32 32" width="34" height="34">
            <path d="M16 6l2.6 7.4L26 16l-7.4 2.6L16 26l-2.6-7.4L6 16l7.4-2.6z" fill="currentColor" />
          </svg>
        </span>
      </div>
      <h1 className="splash-name">Nemotron<span> Workbench</span></h1>
      {error ? (
        <>
          <p className="splash-text">Can&rsquo;t reach the server right now.</p>
          <button type="button" className="btn primary splash-retry" onClick={onRetry}>Try again</button>
        </>
      ) : (
        <>
          <div className="splash-bar" aria-hidden="true"><i /></div>
          <p className="splash-text">
            {slow ? "Waking up the server… the first start can take up to a minute." : "Getting things ready…"}
          </p>
        </>
      )}
    </main>
  );
}
