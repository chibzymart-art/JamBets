import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Oddsbanta ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/dashboard';
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            minHeight: '100vh',
            width: '100%',
            backgroundColor: '#0b0f17',
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              backgroundColor: '#111827',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: '16px',
              padding: '32px',
              boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 0 30px rgba(16, 185, 129, 0.1)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px auto',
                fontSize: '28px',
              }}
            >
              ⚽
            </div>

            <h1
              style={{
                fontSize: '22px',
                fontWeight: 700,
                color: '#ffffff',
                marginBottom: '8px',
                letterSpacing: '-0.02em',
              }}
            >
              Refreshing Prediction Feed
            </h1>

            <p
              style={{
                fontSize: '14px',
                color: '#94a3b8',
                lineHeight: 1.6,
                marginBottom: '24px',
              }}
            >
              Your session state has updated. Tap below to reload your high-probability predictions and active edges.
            </p>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  width: '100%',
                  padding: '14px 20px',
                  backgroundColor: '#10b981',
                  color: '#064e3b',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                }}
              >
                ⚡ Reload Predictions
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#94a3b8',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                Return to Dashboard
              </button>
            </div>

            {import.meta.env.DEV && this.state.error && (
              <details
                style={{
                  marginTop: '24px',
                  textAlign: 'left',
                  backgroundColor: 'rgba(0,0,0,0.4)',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#f87171',
                  maxHeight: '140px',
                  overflowY: 'auto',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#fca5a5' }}>
                  Technical Details
                </summary>
                <pre style={{ marginTop: '8px', whiteSpace: 'pre-wrap' }}>
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
