import React, { Component, ReactNode } from 'react';
import { Button, Result } from 'antd';
import i18n from '../../i18n';
import { createLogger } from '../../store/logger';

const logger = createLogger('ErrorBoundary');

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('Caught error', { error: error.message, stack: errorInfo.componentStack });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const t = i18n.t.bind(i18n);
      return (
        <div className="flex items-center justify-center h-screen bg-bg-app">
          <Result
            status="error"
            title={t('common.error')}
            subTitle={this.state.error?.message || t('error.unknown')}
            extra={[
              <Button key="reload" type="primary" onClick={this.handleReload}>
                {t('common.refresh')}
              </Button>,
              <Button key="retry" onClick={this.handleReset}>
                {t('common.retry')}
              </Button>,
            ]}
          />
        </div>
      );
    }

    return this.props.children;
  }
}
