import type { ReactNode } from 'react';

type ListResultStateProps =
  | { status: 'loading'; children?: never }
  | { status: 'empty'; message?: string; children?: never }
  | { status: 'error'; message: string; onRetry: () => void; children?: never }
  | { status: 'ready'; children: ReactNode };

export function ListResultState(props: ListResultStateProps) {
  if (props.status === 'loading') return <p className="list-state" role="status" aria-live="polite">Loading results…</p>;
  if (props.status === 'empty') return <p className="list-state" role="status">{props.message ?? 'No results found.'}</p>;
  if (props.status === 'error') return <div className="list-state list-state-error" role="alert">
    <p>{props.message}</p>
    <button className="button secondary" type="button" onClick={props.onRetry}>Retry</button>
  </div>;
  return <>{props.children}</>;
}
