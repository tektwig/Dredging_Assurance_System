import type { ReactNode } from 'react';

export function StatusPage({ title, children, busy = false }: { title: string; children?: ReactNode; busy?: boolean }) {
  return <main className="centered-page">
    <section className="card status-card" aria-busy={busy}>
      <p className="eyebrow">Dredging Assurance</p>
      <h1>{title}</h1>
      <div role={busy ? 'status' : undefined}>{children}</div>
    </section>
  </main>;
}