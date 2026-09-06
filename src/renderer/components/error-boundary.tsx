import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps { children: ReactNode }
interface ErrorBoundaryState { error: Error | undefined }

export class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Desktop renderer recovered from an uncaught UI error.', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    return <main role="alert" className="app-error-boundary"><h1>Something went wrong</h1><p>The workspace interface could not render this view.</p><button type="button" onClick={() => window.location.reload()}>Reload workspace</button></main>;
  }
}
