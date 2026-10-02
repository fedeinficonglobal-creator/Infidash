import { Component, type ErrorInfo, type ReactNode } from 'react';

interface LazyBoundaryProps {
  children: ReactNode;
}

interface LazyBoundaryState {
  failed: boolean;
}

/** Catches chunk-load failures (e.g. stale hashes after a deploy) in the lazy area. */
export class LazyBoundary extends Component<LazyBoundaryProps, LazyBoundaryState> {
  declare readonly props: LazyBoundaryProps;
  state: LazyBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Lazy section failed to load', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-sm font-medium text-slate-600">No se pudo cargar esta sección. Recarga la página.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-bold text-white"
        >
          Recargar
        </button>
      </div>
    );
  }
}
